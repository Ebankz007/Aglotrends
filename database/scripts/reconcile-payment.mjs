#!/usr/bin/env node
/**
 * Reconcile our payment ledger against the gateway's own record of it.
 *
 * WHY THIS EXISTS
 * Two failures, one lesson.
 *
 * 1. The callback endpoint answered 401 to every real Pay2Crypto delivery
 *    (it demanded a shared-secret header the gateway does not send), so a
 *    confirmed payment sat in the ledger as PENDING and the member's dashboard
 *    stayed inactive. The callback is now fixed.
 * 2. But the callback is not a mechanism you can build a member's activation
 *    on: between 14:32 and 18:38 the gateway delivered twice, both 401, and
 *    NOT AT ALL for the one payment that actually mattered - the $25 bep20
 *    request the gateway itself records as paid. The vendor publishes no
 *    signing recipe and exposes no API for its own webhook state, so a dead
 *    webhook is invisible from our side and would silently strand members
 *    forever.
 *
 * So the callback is the FAST PATH and this is the GROUND TRUTH PATH. Every
 * reconcile cycle asks the gateway what it says about OUR references and acts
 * only on its explicit word:
 *   - gateway says PAID, and the amount, network and settlement agree with
 *     the invoice we issued -> settle through `confirmPaymentManually`, the
 *     same path the callback uses (same idempotency, same fee record, same
 *     wallet credit, same registration compensation);
 *   - gateway says EXPIRED/CANCELLED/FAILED with no money attached -> release
 *     the invoice so the member can start a fresh one;
 *   - anything ambiguous -> touch nothing and ask a human.
 *
 * It never invents a settlement: no gateway confirmation, no write. It also
 * never trusts a missing record: absence is not proof, so a PENDING payment
 * the gateway does not list stays PENDING.
 *
 * Usage:
 *   node database/scripts/reconcile-payment.mjs                        # read only
 *   node database/scripts/reconcile-payment.mjs --ref=AGL-xxxx --apply # settle
 *   node database/scripts/reconcile-payment.mjs --apply --throttle-min=10
 */

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createDecipheriv } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const API_ENV = resolve(REPO, 'apps', 'api', '.env');
const DB_ENV = resolve(REPO, 'database', '.env');
const API_DIST = resolve(REPO, 'apps', 'api', 'dist', 'services', 'payment-service.js');
const RULES_DIST = resolve(REPO, 'apps', 'api', 'dist', 'services', 'reconcile-rules.js');

const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');
const REF_ARG = (() => {
  const hit = process.argv.find((a) => a.startsWith('--ref='));
  return hit ? hit.slice('--ref='.length).trim() : '';
})();
/** Minutes to wait between runs. 0 = run every time. */
const THROTTLE_MIN = (() => {
  const hit = process.argv.find((a) => a.startsWith('--throttle-min='));
  const n = hit ? Number(hit.slice('--throttle-min='.length)) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
})();
const THROTTLE_FILE = '/tmp/aglotrends-reconcile-last.txt';
/** Pay2Crypto payment requests live for one hour. */
const CHECKOUT_WINDOW_MIN = 60;
/** Extra slack before a request that the gateway never knew is written off. */
const ABSENCE_MARGIN_MIN = 30;

const out = (line) => process.stdout.write(`${line}\n`);

function parseEnv(file) {
  const result = {};
  let text = '';
  try {
    text = readFileSync(file, 'utf-8');
  } catch {
    return result;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) result[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return result;
}

function decryptSecret(stored, key) {
  if (!stored) return '';
  if (!stored.startsWith('v1:')) return stored;
  const [, ivB64, tagB64, dataB64] = stored.split(':');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  d.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([d.update(Buffer.from(dataB64, 'base64')), d.final()]).toString('utf-8');
}

/**
 * Ask the gateway about ONE reference, directly.
 *
 * The list endpoint is not guaranteed to hold every request, so when a
 * reference is missing from it, the reference is looked up on its own. The
 * gateway's filter parameter is not documented, so the plausible spellings are
 * tried until one answers with a record that actually matches.
 */
async function lookupGatewayRecord(apiUrl, headers, reference, gatewayTxid) {
  const attempts = [];
  if (reference) attempts.push(['reference', reference]);
  if (gatewayTxid) {
    attempts.push(['token', gatewayTxid]);
    attempts.push(['id', gatewayTxid]);
  }
  for (const [key, value] of attempts) {
    try {
      const res = await fetch(
        `${apiUrl}/v1/payment-requests?${key}=${encodeURIComponent(value)}`,
        { headers, signal: AbortSignal.timeout(12_000) },
      );
      if (!res.ok) continue;
      const parsed = await res.json().catch(() => null);
      const data = Array.isArray(parsed?.data) ? parsed.data : Array.isArray(parsed) ? parsed : [];
      const hit = data.find((r) => r?.reference === reference) ?? data[0] ?? null;
      if (hit && typeof hit === 'object') {
        return hit.reference ? hit : { ...hit, reference };
      }
    } catch {
      /* try the next spelling */
    }
  }
  return null;
}


async function main() {
  // The decision rules live in the API package (apps/api/src/services/reconcile-rules.ts)
  // so they are unit-tested with the rest of the system. This script imports
  // the COMPILED copy - one source of truth, so the rules that decide a
  // settlement can never drift from the rules that are tested.
  let rules;
  try {
    rules = await import(pathToFileURL(RULES_DIST).href);
  } catch {
    // The rules live in the API package, so this script needs the API build.
    // On the cycle that introduces them the build has not happened yet - the
    // next cycle (two minutes later) has it. Skipping is safe: it settles
    // nothing, and it says so.
    out(`SKIPPED: ${RULES_DIST} is not there yet - the API build is not current. Nothing was written.`);
    return;
  }
  const { gatewaySaysConfirmed, gatewaySaysDead, gatewayHasMoney, gatewayAgreesWithInvoice } = rules;

  // The throttle: this job now runs on every deploy cycle, so it must not
  // hammer the gateway. The window is the only thing standing between a
  // reconciliation loop and a rate-limited API.
  if (THROTTLE_MIN > 0) {
    let last = 0;
    try {
      last = Number(readFileSync(THROTTLE_FILE, 'utf-8').trim()) || 0;
    } catch {
      last = 0;
    }
    const waited = (Date.now() - last) / 60_000;
    if (last > 0 && waited < THROTTLE_MIN) {
      out(`throttled - last reconcile was ${waited.toFixed(1)} min ago, window is ${THROTTLE_MIN} min.`);
      return;
    }
  }
  const markThrottled = () => {
    if (THROTTLE_MIN > 0) {
      try {
        writeFileSync(THROTTLE_FILE, String(Date.now()));
      } catch {
        /* a missing stamp only costs an extra call */
      }
    }
  };

  const apiEnv = parseEnv(API_ENV);
  const dbEnv = parseEnv(DB_ENV);

  // The API's own modules read their configuration from the environment at
  // import time, so the environment is loaded BEFORE the service is imported.
  for (const [k, v] of Object.entries(apiEnv)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
  process.env.NODE_ENV = process.env.NODE_ENV || 'production';

  const dbUrl = dbEnv.DATABASE_URL || process.env.DATABASE_URL;
  if (!dbUrl) {
    out('FATAL: no DATABASE_URL');
    process.exitCode = 2;
    return;
  }

  const client = new pg.Client({
    connectionString: dbUrl,
    connectionTimeoutMillis: 10_000,
    query_timeout: 20_000,
  });
  await client.connect();

  const params = [`select p.id, p.user_id, p.purpose, p.status, p.amount_cents, p.currency,
                          p.network, p.payment_ref, p.gateway_txid, p.created_at,
                          u.email, u.is_active_member
                     from payments p join users u on u.id = p.user_id
                    where p.status = 'PENDING'`];
  if (REF_ARG) params.push(`and p.payment_ref = $1`);
  const { rows: pending } = await client.query(params.join(' '), REF_ARG ? [REF_ARG] : []);
  await client.end();

  if (pending.length === 0) {
    out('No PENDING payment to reconcile.');
    return;
  }
  out(`== ${pending.length} PENDING payment(s) ==`);
  for (const p of pending) {
    out(
      `  ${p.payment_ref.slice(0, 24)} ${p.purpose} $${(p.amount_cents / 100).toFixed(2)} ` +
        `${p.network} member=${p.email} active=${p.is_active_member} gwId=${p.gateway_txid ?? '-'}`,
    );
  }

  // The gateway's credential, straight from the console.
  const rawKey = apiEnv.SECRET_ENCRYPTION_KEY ?? '';
  if (!rawKey) {
    out('FATAL: SECRET_ENCRYPTION_KEY not set');
    process.exitCode = 2;
    return;
  }
  const key = /^[0-9a-fA-F]{64}$/.test(rawKey) ? Buffer.from(rawKey, 'hex') : Buffer.from(rawKey, 'base64');
  const conn = new pg.Client({ connectionString: dbUrl, connectionTimeoutMillis: 10_000 });
  await conn.connect();
  const { rows: cfgRows } = await conn.query("select value from app_config where key = 'payment.gateway'");
  await conn.end();
  const gw = cfgRows[0]?.value ?? {};
  const token = decryptSecret(String(gw.token ?? ''), key);
  const apiUrl = (gw.apiUrl || 'https://api.pay2crypto.com').replace(/\/+$/, '');
  if (!token) {
    out('FATAL: no gateway token');
    process.exitCode = 2;
    return;
  }
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  // What does the gateway say about each of our references?
  let gatewayRecords = [];
  let listComplete = true;
  try {
    const seen = new Map();
    let fetched = 0;
    let expected = null;
    let firstRef = null;
    let paginationIgnored = false;
    for (let page = 1; page <= 10; page += 1) {
      const url = `${apiUrl}/v1/payment-requests?limit=200&page=${page}`;
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        // A rejected credential is NOT an empty list. Treating it as one would
        // make this job look healthy while doing nothing, forever. Fail loud.
        const body = (await res.text().catch(() => '')).slice(0, 200).replace(/\s+/g, ' ');
        out(`FATAL: the gateway answered ${res.status} - ${body}`);
        out('Nothing was written - we could not read the gateway.');
        process.exitCode = 2;
        return;
      }
      const parsed = await res.json().catch(() => null);
      const data = Array.isArray(parsed?.data) ? parsed.data : Array.isArray(parsed) ? parsed : [];
      if (typeof parsed?.count === 'number') expected = parsed.count;
      if (page === 1) {
        firstRef = data[0]?.reference ?? null;
      } else if ((data[0]?.reference ?? null) === firstRef) {
        // The gateway ignored the page parameter and served page 1 again.
        paginationIgnored = true;
        break;
      }
      fetched += data.length;
      for (const row of data) {
        if (row?.reference) seen.set(row.reference, row);
      }
      if (data.length === 0) break;
      if (expected !== null) {
        if (fetched >= expected) break;
      } else if (data.length < 50) {
        break; // no count to compare against, so a short page is the last page
      }
    }
    gatewayRecords = [...seen.values()];
    if (expected !== null && fetched < expected) {
      listComplete = false;
      out(
        `WARNING: the gateway holds ${expected} request(s) but only ${fetched} came back` +
          `${paginationIgnored ? ' (it ignores the page parameter)' : ''} - the list is incomplete,` +
          ` so a missing reference is looked up directly instead of being treated as proof.`,
      );
    }
  } catch (err) {
    out(`FATAL: could not read the gateway: ${err.message}`);
    out('Nothing was written - the gateway could not be asked.');
    process.exitCode = 2;
    return;
  }

  const confirmedTargets = [];
  const deadTargets = [];
  const flagged = [];
  for (const p of pending) {
    let record = gatewayRecords.find((r) => r?.reference === p.payment_ref);
    if (!record) {
      // The list did not contain it. If the list is incomplete, that proves
      // nothing - so ask the gateway about this reference directly.
      record = await lookupGatewayRecord(apiUrl, headers, p.payment_ref, p.gateway_txid);
      if (record) {
        out(`  (${p.payment_ref.slice(0, 24)} was not in the list - found it by direct lookup)`);
      }
    }
    const says = gatewaySaysConfirmed(record);
    const dead = gatewaySaysDead(record);
    out(
      `  ${p.payment_ref.slice(0, 24)} -> gateway: ${record ? String(record.status ?? '?') : 'NOT FOUND'}` +
        `${says ? '  CONFIRMED' : ''}${dead ? '  DEAD' : ''}` +
        `${record?.amount !== undefined ? ` amount=${record.amount}` : ''}` +
        `${record?.settlement ? ` settlement=${record.settlement}` : ''}` +
        `${record?.paid_at ? ` paid_at=${record.paid_at}` : ''}` +
        `${record?.submitted_hash ? ` hash=${String(record.submitted_hash).slice(0, 18)}` : ''}`,
    );
    if (says) {
      // The gateway says the money moved. Before we act on that, the invoice
      // and the gateway's record have to agree.
      const verdict = gatewayAgreesWithInvoice(record, p);
      if (verdict.ok) confirmedTargets.push({ payment: p, record });
      else {
        flagged.push({ payment: p, record, why: verdict.why });
        out(`     REFUSED TO SETTLE: ${verdict.why} - a human must look at this one.`);
      }
    } else if (dead) {
      deadTargets.push({ payment: p, record });
    } else if (record && gatewayHasMoney(record)) {
      // The gateway says the request failed, yet money is attached. That
      // contradiction is not ours to resolve: it is flagged, loudly, for a
      // human. Silently leaving it PENDING would be the worst outcome - a
      // member who paid and a ledger that never mentions it.
      flagged.push({ payment: p, record, why: `CONTRADICTION(status=${record.status} but money is attached)` });
      out('     NEEDS A HUMAN: the gateway reports a failure but money is attached - not touching it.');
    } else if (!record) {
      // The gateway does not know this reference. That is only meaningful if
      // its list is complete - otherwise we are looking at a truncated list
      // and know nothing. A complete list plus the checkout window having
      // closed means the request is not payable and it is holding the
      // member's slot. Pay2Crypto requests live for 1 hour; the margin is
      // there so a request that was refreshed (which keeps the row but
      // rewrites the reference) is never judged on a stale clock.
      const ageMin = p.created_at ? (Date.now() - new Date(p.created_at).getTime()) / 60_000 : 0;
      const dead = ageMin > CHECKOUT_WINDOW_MIN + ABSENCE_MARGIN_MIN;
      if (listComplete && dead) {
        deadTargets.push({
          payment: p,
          record: { status: 'expired', reason: `our checkout window closed ${Math.round(ageMin)} min ago and the gateway never knew it` },
        });
        out(`     the gateway does not list this reference and the checkout window has closed - releasing it.`);
      } else {
        out(
          `     the gateway does not list this reference` +
            `${listComplete ? ' (its list is complete)' : ' (its list is incomplete - proves nothing)'}` +
            `${dead ? '' : ` (the checkout window is still open, ${Math.round(ageMin)} min old)`}` +
            ` - leaving it PENDING, because a missing record is not proof of anything.`,
        );
      }
    }
  }

  if (confirmedTargets.length === 0 && deadTargets.length === 0) {
    out('== verdict ==');
    out('  The gateway confirms none of these and reports none as dead. Nothing was written.');
    if (flagged.length > 0) out(`  ${flagged.length} payment(s) need a human - see REFUSED above.`);
    markThrottled();
    return;
  }

  if (!APPLY) {
    out('== verdict ==');
    out(`  ${confirmedTargets.length} payment(s) the gateway calls confirmed.`);
    out(`  ${deadTargets.length} payment(s) the gateway calls dead (expired, unpaid).`);
    if (flagged.length > 0) out(`  ${flagged.length} payment(s) need a human - see REFUSED above.`);
    out('  DRY RUN — pass --apply to settle them through the normal confirmation path.');
    markThrottled();
    return;
  }

  if (!existsSync(API_DIST)) {
    out(`FATAL: ${API_DIST} not found — build the API first (pnpm --filter @aglotrends/api build)`);
    process.exitCode = 2;
    return;
  }

  const { confirmPaymentManually, cancelPendingPayment } = await import(pathToFileURL(API_DIST).href);

  out('== applying ==');
  for (const { payment, record } of confirmedTargets) {
    const txHash = record?.submitted_hash ?? record?.tx_hash ?? null;
    try {
      const result = await confirmPaymentManually(payment.id, txHash);
      out(
        `  SETTLED  ${payment.payment_ref} applied=${result.applied} purpose=${result.purpose} ` +
          `compensation=${result.compensationRun} reason=${result.reason ?? '-'}`,
      );
    } catch (err) {
      out(`  ${payment.payment_ref} FAILED: ${err?.message ?? err}`);
    }
  }
  for (const { payment, record } of deadTargets) {
    try {
      await cancelPendingPayment(payment.id);
      out(
        `  RELEASED ${payment.payment_ref} PENDING -> EXPIRED` +
          ` (${record?.reason ?? `the gateway ${record?.status ?? 'expired'} it unpaid`})`,
      );
    } catch (err) {
      out(`  ${payment.payment_ref} RELEASE FAILED: ${err?.message ?? err}`);
    }
  }

  // Prove the outcome against the ledger, not against the function's return.
  const check = new pg.Client({ connectionString: dbUrl, connectionTimeoutMillis: 10_000 });
  await check.connect();
  const { rows: after } = await check.query(
    `select p.payment_ref, p.status, p.paid_at, p.tx_hash, u.email, u.is_active_member,
            (select count(*)::int from registrations r where r.user_id = p.user_id) as registrations
       from payments p join users u on u.id = p.user_id
      where p.id = any($1::uuid[])`,
    [confirmedTargets.map((t) => t.payment.id)],
  );
  await check.end();
  out('== ledger after ==');
  for (const r of after) {
    out(
      `  ${r.payment_ref.slice(0, 24)} status=${r.status} paid_at=${r.paid_at ?? '-'} ` +
        `tx_hash=${r.tx_hash ? String(r.tx_hash).slice(0, 18) : '-'} member=${r.email} ` +
        `active=${r.is_active_member} registrations=${r.registrations}`,
    );
  }
  if (flagged.length > 0) {
    out('== needs a human ==');
    for (const f of flagged) {
      out(`  ${f.payment.payment_ref} ${f.why} member=${f.payment.email} amount=${f.payment.amount_cents}`);
    }
  }
  markThrottled();
}

main().catch((err) => {
  out(`FATAL: ${err.stack ?? err.message}`);
  process.exitCode = 2;
});
