#!/usr/bin/env node
/**
 * One-shot production diagnostic for the Pay2Crypto CALLBACK path.
 *
 * Answers the question that a member can see and the server cannot:
 *   "the gateway says the payment is confirmed — why is the member still
 *    inactive?"
 *
 * It cross-references two independent records:
 *   1. OUR ledger  (payments + users + registrations in the production DB)
 *   2. THEIRS      (GET /v1/payment-requests on the gateway)
 *
 * and prints, side by side, every recent payment: what we recorded, what the
 * gateway recorded, and whether the member was activated.
 *
 * READ-ONLY. It creates no payment request, cancels nothing, and mutates
 * nothing: a diagnostic that writes to a live rail costs a member their
 * checkout slot.
 *
 * Usage:  node database/scripts/diagnose-webhook.mjs
 *         (run from the repo root; needs `pg` — it lives in this package)
 */

import { readFileSync } from 'node:fs';
import { createDecipheriv } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const API_ENV = resolve(REPO, 'apps', 'api', '.env');
const DB_ENV = resolve(REPO, 'database', '.env');

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
  const parts = stored.split(':');
  if (parts.length !== 4) throw new Error('malformed envelope');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'base64'));
  d.setAuthTag(Buffer.from(parts[2], 'base64'));
  return Buffer.concat([d.update(Buffer.from(parts[3], 'base64')), d.final()]).toString('utf8');
}

/** Redact anything that smells like a credential before it reaches a log file. */
function redact(value, key = '') {
  if (value === null || value === undefined) return value;
  if (typeof value === 'object') {
    if (Array.isArray(value)) return value.map((v) => redact(v));
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]));
  }
  if (typeof value === 'string') {
    if (/secret|api[_-]?key|authorization|password/i.test(key)) return `<redacted len=${value.length}>`;
    if (value.length > 200) return `${value.slice(0, 200)}…`;
  }
  return value;
}

const iso = (ms) => (ms ? new Date(Number(ms)).toISOString() : '-');

async function main() {
  const apiEnv = parseEnv(API_ENV);
  const dbEnv = parseEnv(DB_ENV);

  out('== runtime ==');
  out(`  PAY2CRYPTO_API_URL = ${apiEnv.PAY2CRYPTO_API_URL ?? '<unset>'}`);
  out(`  PAY2CRYPTO_TOKEN = ${apiEnv.PAY2CRYPTO_TOKEN ? `set len=${apiEnv.PAY2CRYPTO_TOKEN.length}` : '<unset>'}`);
  out(
    `  PAY2CRYPTO_WEBHOOK_SECRET = ${apiEnv.PAY2CRYPTO_WEBHOOK_SECRET ? `set len=${apiEnv.PAY2CRYPTO_WEBHOOK_SECRET.length}` : '<unset>'}`,
  );
  out(`  RUNTIME_RAIL = ${apiEnv.PAY2CRYPTO_TOKEN && apiEnv.ALLOW_MOCK_RAIL !== 'true' ? 'LIVE' : 'MOCK'}`);

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

  out('== our ledger: the last 15 payments ==');
  const { rows: payments } = await client.query(`
    select p.id, p.purpose, p.status, p.amount_cents, p.platform_fee_cents, p.network,
           p.payment_ref, p.gateway_txid, p.tx_hash, p.paid_at, p.created_at,
           u.email, u.is_active_member,
           (select count(*)::int from registrations r where r.user_id = p.user_id) as registration_rows
      from payments p
      join users u on u.id = p.user_id
     order by p.created_at desc
     limit 15
  `);
  for (const p of payments) {
    out(
      `  ${iso(p.created_at)} ${p.purpose.padEnd(11)} ${p.status.padEnd(8)} ` +
        `$${(p.amount_cents / 100).toFixed(2)} (fee $${(p.platform_fee_cents / 100).toFixed(2)}) ` +
        `${String(p.network).padEnd(6)} ref=${p.payment_ref.slice(0, 22)} ` +
        `member=${p.email} active=${p.is_active_member} registrations=${p.registration_rows} ` +
        `txid=${p.gateway_txid ? String(p.gateway_txid).slice(0, 10) : '-'} ` +
        `txhash=${p.tx_hash ? p.tx_hash.slice(0, 12) : '-'} paid=${iso(p.paid_at)}`,
    );
  }
  if (payments.length === 0) out('  (no payments at all)');

  const { rows: statusCounts } = await client.query(
    'select status, count(*)::int as n from payments group by status order by status',
  );
  out('  status counts: ' + statusCounts.map((r) => `${r.status}=${r.n}`).join(' '));

  const { rows: inactivePaid } = await client.query(`
    select p.id, p.payment_ref, p.purpose, p.amount_cents, u.email, u.is_active_member
      from payments p join users u on u.id = p.user_id
     where u.is_active_member = false
       and p.purpose = 'REGISTRATION'
     order by p.created_at desc limit 10
  `);
  out('== members with an UNACTIVATED registration payment ==');
  if (inactivePaid.length === 0) out('  (none)');
  for (const r of inactivePaid) {
    out(
      `  ref=${r.payment_ref.slice(0, 22)} ${r.purpose} $${(r.amount_cents / 100).toFixed(2)} ` +
        `member=${r.email} active=${r.is_active_member}`,
    );
  }

  const { rows: cfg } = await client.query(
    "select value from app_config where key = 'payment.gateway'",
  );
  await client.end();
  const gw = cfg[0]?.value ?? {};

  const rawKey = apiEnv.SECRET_ENCRYPTION_KEY ?? '';
  if (!rawKey) {
    out('FATAL: SECRET_ENCRYPTION_KEY not set');
    process.exitCode = 2;
    return;
  }
  const key = /^[0-9a-fA-F]{64}$/.test(rawKey) ? Buffer.from(rawKey, 'hex') : Buffer.from(rawKey, 'base64');

  let token = '';
  let storedSecret = '';
  try {
    token = decryptSecret(gw.token ?? '', key);
    storedSecret = decryptSecret(gw.webhookSecret ?? '', key);
  } catch (err) {
    out(`FATAL: could not decrypt stored secret: ${err.message}`);
    process.exitCode = 2;
    return;
  }
  out('== credential ==');
  out(`  token len=${token.length} first6=${JSON.stringify(token.slice(0, 6))}`);
  out(`  stored webhookSecret len=${storedSecret.length}`);
  out(
    `  runtime webhookSecret == stored webhookSecret ? ${
      storedSecret && storedSecret === apiEnv.PAY2CRYPTO_WEBHOOK_SECRET ? 'YES' : 'NO'
    }`,
  );
  out(
    `  runtime webhookSecret == API token ? ${
      storedSecret && storedSecret === apiEnv.PAY2CRYPTO_TOKEN ? 'YES' : 'NO'
    }`,
  );

  if (!token) {
    out('VERDICT: NO_TOKEN');
    return;
  }

  const apiUrl = (gw.apiUrl || 'https://api.pay2crypto.com').replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const timeout = (ms = 15_000) => AbortSignal.timeout(ms);

  out(`== the gateway's own view: GET ${apiUrl}/v1/payment-requests ==`);
  let items = [];
  try {
    const res = await fetch(`${apiUrl}/v1/payment-requests`, { headers, signal: timeout() });
    const text = await res.text();
    out(`  status = ${res.status}`);
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    if (parsed && typeof parsed === 'object') {
      out(`  top-level keys = ${Object.keys(parsed).join(',')}`);
    }
    items = Array.isArray(parsed?.data) ? parsed.data : Array.isArray(parsed) ? parsed : [];
    if (items.length === 0 && parsed) {
      out(`  ${JSON.stringify(redact(parsed)).slice(0, 400)}`);
    }
  } catch (err) {
    out(`  ERROR ${err.message}`);
  }

  const ourRefs = new Set(payments.map((p) => p.payment_ref));
  for (const item of items.slice(0, 20)) {
    const ref = typeof item?.reference === 'string' ? item.reference : '(no reference)';
    const ours = ourRefs.has(ref);
    out(
      `  ${ours ? 'OURS ' : '     '} status=${String(item?.status ?? '?').padEnd(12)} ` +
        `amount=${String(item?.amount ?? '?').padEnd(8)} ref=${ref.slice(0, 30)} ` +
        `network=${String(item?.network ?? '?').padEnd(6)} ` +
        `token=${String(item?.token ?? '?').slice(0, 10)} ` +
        `created=${iso(item?.created_at)} paid=${iso(item?.paid_at)} ` +
        `hash=${item?.submitted_hash ? String(item.submitted_hash).slice(0, 14) : '-'}`,
    );
    if (ours) {
      out(`        raw = ${JSON.stringify(redact(item)).slice(0, 600)}`);
    }
  }

  out('== verdict ==');
  const confirmed = items.filter((i) =>
    /confirmed|paid|success|complete/i.test(String(i?.status ?? '')),
  );
  out(`  gateway reports ${confirmed.length} confirmed request(s)`);
  for (const c of confirmed) {
    const ref = typeof c?.reference === 'string' ? c.reference : '';
    const row = payments.find((p) => p.payment_ref === ref);
    out(
      `  ${ref} -> our ledger: ${row ? `${row.status} / member active=${row.is_active_member}` : 'NO MATCHING ROW'}`,
    );
  }
}

main().catch((err) => {
  out(`FATAL: ${err.stack ?? err.message}`);
  process.exitCode = 2;
});
