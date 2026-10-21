#!/usr/bin/env node
/**
 * Reconcile a payment the gateway confirmed but our ledger never applied.
 *
 * WHY THIS EXISTS
 * The callback endpoint answered 401 to every real Pay2Crypto delivery
 * (it demanded a shared-secret header the gateway does not send), so a
 * confirmed payment sat in the ledger as PENDING and the member's dashboard
 * stayed inactive. The callback is being fixed, but a member who already paid
 * cannot wait for a retry that may never come.
 *
 * WHAT IT DOES
 * It asks the GATEWAY for its own record of the request, and only if the
 * gateway says the money moved does it apply the settlement — through the
 * same `confirmPaymentManually` the admin console uses, which routes into the
 * same `handlePaymentWebhook` the live callback uses. One code path, so the
 * idempotency, the fee record, the wallet credit and the registration
 * compensation are identical whether the money arrived by callback or by hand.
 *
 * It never invents a settlement: no gateway confirmation, no write.
 *
 * Usage:
 *   node database/scripts/reconcile-payment.mjs                       # read only
 *   node database/scripts/reconcile-payment.mjs --ref=AGL-xxxx --apply # settle
 *   node database/scripts/reconcile-payment.mjs --all --apply          # every
 *                                                                    # confirmed
 *                                                                    # PENDING
 */

import { readFileSync, existsSync } from 'node:fs';
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

async function main() {
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
  try {
    const res = await fetch(`${apiUrl}/v1/payment-requests`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    const parsed = await res.json().catch(() => null);
    gatewayRecords = Array.isArray(parsed?.data) ? parsed.data : Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    out(`FATAL: could not read the gateway: ${err.message}`);
    process.exitCode = 2;
    return;
  }

  const confirmedTargets = [];
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
    out(
      `  ${p.payment_ref.slice(0, 24)} -> gateway: ${record ? String(record.status ?? '?') : 'NOT FOUND'}` +
        `${says ? '  CONFIRMED' : ''}` +
        `${record?.amount !== undefined ? ` amount=${record.amount}` : ''}` +
        `${record?.paid_at ? ` paid_at=${record.paid_at}` : ''}` +
        `${record?.submitted_hash ? ` hash=${String(record.submitted_hash).slice(0, 18)}` : ''}`,
    );
    if (says) confirmedTargets.push({ payment: p, record });
  }

  if (confirmedTargets.length === 0) {
    out('== verdict ==');
    out('  The gateway does not report any of these as confirmed. Nothing was written.');
    return;
  }

  if (!APPLY) {
    out('== verdict ==');
    out(`  ${confirmedTargets.length} payment(s) the gateway calls confirmed.`);
    out('  DRY RUN — pass --apply to settle them through the normal confirmation path.');
    return;
  }

  if (!existsSync(API_DIST)) {
    out(`FATAL: ${API_DIST} not found — build the API first (pnpm --filter @aglotrends/api build)`);
    process.exitCode = 2;
    return;
  }

  const { confirmPaymentManually } = await import(API_DIST);

  out('== applying ==');
  for (const { payment, record } of confirmedTargets) {
    const txHash = record?.submitted_hash ?? record?.tx_hash ?? null;
    try {
      const result = await confirmPaymentManually(payment.id, txHash);
      out(
        `  ${payment.payment_ref} applied=${result.applied} purpose=${result.purpose} ` +
          `compensation=${result.compensationRun} reason=${result.reason ?? '-'}`,
      );
    } catch (err) {
      out(`  ${payment.payment_ref} FAILED: ${err?.message ?? err}`);
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
}

main().catch((err) => {
  out(`FATAL: ${err.stack ?? err.message}`);
  process.exitCode = 2;
});
