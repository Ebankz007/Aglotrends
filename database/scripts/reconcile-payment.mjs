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
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const API_ENV = resolve(REPO, 'apps', 'api', '.env');
const DB_ENV = resolve(REPO, 'database', '.env');
const API_DIST = resolve(REPO, 'apps', 'api', 'dist', 'services', 'payment-service.js');

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

/** The gateway's own words for "the money moved". */
function gatewaySaysConfirmed(record) {
  if (!record || typeof record !== 'object') return false;
  const status = String(record.status ?? '').toLowerCase();
  if (/confirm|paid|success|complete|settled/.test(status)) return true;
  if (/cancel|expire|fail|pending|unpaid|created|broadcast|awaiting/.test(status)) return false;
  return Boolean(record.paid_at);
}

/** The gateway's own words for "this request is dead and unpaid". */
function gatewaySaysDead(record) {
  if (!record || typeof record !== 'object') return false;
  const status = String(record.status ?? '').toLowerCase();
  if (!/expire|cancel|fail/.test(status)) return false;
  // A dead status with money attached is not a dead invoice - it is a
  // payment that needs a human. Never release that automatically.
  return !record.paid_at && !record.submitted_hash;
}

/**
 * Does the gateway's record actually match the invoice we issued?
 *
 * A settlement is a claim on real money, so it gets checked from every angle
 * we can check it from. Any mismatch means a human, not an automatic credit:
 *   - amount:  the gateway must have charged what we asked for;
 *   - network: the money must have arrived on the chain we told the member
 *               to send it on;
 *   - settlement: 'under' means the member underpaid - a partial payment is
 *               not a registration.
 * 'over' is fine: the member sent more than asked, and we owe the member the
 * full registration, not a pro-rated slice of their overpayment.
 */
function gatewayAgreesWithInvoice(record, payment) {
  if (!record || typeof record !== 'object') return { ok: false, why: 'NO_GATEWAY_RECORD' };

  const rawAmount = record.amount;
  if (rawAmount !== undefined && rawAmount !== null) {
    const gatewayCents = Math.round(Number(rawAmount) * 100);
    if (Number.isFinite(gatewayCents) && gatewayCents !== payment.amount_cents) {
      return { ok: false, why: `AMOUNT_MISMATCH(gateway=${rawAmount} ours=${payment.amount_cents})` };
    }
  }

  const gatewayNetwork = String(record.network ?? '').toLowerCase();
  if (gatewayNetwork && payment.network && gatewayNetwork !== String(payment.network).toLowerCase()) {
    return { ok: false, why: `NETWORK_MISMATCH(gateway=${gatewayNetwork} ours=${payment.network})` };
  }

  const settlement = String(record.settlement ?? '').toLowerCase();
  if (settlement === 'under' || settlement === 'underpaid' || settlement === 'partial') {
    return { ok: false, why: `UNDERPAID(settlement=${settlement})` };
  }

  return { ok: true, why: '-' };
}

async function main() {
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
    let page = 1;
    let expected = null;
    for (page = 1; page <= 10; page += 1) {
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
      for (const row of data) {
        if (row?.reference) seen.set(row.reference, row);
      }
      if (typeof parsed?.count === 'number') expected = parsed.count;
      if (data.length === 0) break;
      if (expected !== null && seen.size >= expected) break;
      if (data.length < 50) break; // a short page is the last page
    }
    gatewayRecords = [...seen.values()];
    if (expected !== null && gatewayRecords.length < expected) {
      listComplete = false;
      out(
        `WARNING: the gateway holds ${expected} request(s) but only ${gatewayRecords.length} came back - ` +
          `the list is incomplete, so a missing reference proves nothing.`,
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
    if (!record && p.gateway_txid) {
      try {
        const res = await fetch(`${apiUrl}/v1/payment-requests/${p.gateway_txid}`, {
          headers,
          signal: AbortSignal.timeout(15_000),
        });
        const parsed = await res.json().catch(() => null);
        record = parsed?.data ?? parsed;
        if (record && !record.reference) record = { ...record, reference: p.payment_ref };
      } catch {
        /* fall through to "unknown" */
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
    } else if (!record) {
      out(
        `     the gateway does not list this reference` +
          `${listComplete ? ' (its list is complete, so the request is gone)' : ' (its list is incomplete - proves nothing)'}` +
          ` - leaving it PENDING, because a missing record is not proof of anything.`,
      );
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

  const { confirmPaymentManually, cancelPendingPayment } = await import(API_DIST);

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
  for (const { payment } of deadTargets) {
    try {
      await cancelPendingPayment(payment.id);
      out(`  RELEASED ${payment.payment_ref} PENDING -> EXPIRED (the gateway expired it unpaid)`);
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
