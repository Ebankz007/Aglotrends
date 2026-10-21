#!/usr/bin/env node
/**
 * Clear invoices that can never be paid.
 *
 * A PENDING invoice blocks its member from starting a new one
 * (`PENDING_PAYMENT_EXISTS`), so a member who clicked a dead checkout link
 * was stuck: the old invoice held the slot, and the new one could not be
 * created. The fix is to EXPIRE those rows, not delete them — a payment row
 * is a financial record, and "expired" says what actually happened (nobody
 * was ever charged) while keeping the trail.
 *
 * Only invoices that were FABRICATED by mock mode are touched. A row with a
 * real gateway transaction id is left alone and reported: a member may have
 * actually paid it, and only a human (or a webhook) can settle that.
 *
 * Usage:  node database/scripts/expire-mock-payments.mjs [--apply]
 *         (no flag = dry run: report only, change nothing)
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const APPLY = process.argv.includes('--apply');
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
    if (m) result[m[1]] = m[2].trim().replace(/^["']|['"]$/g, '');
  }
  return result;
}

/** The same marker the API uses to recognise a URL fabricated by mock mode. */
function isFabricated(url, txid) {
  if (typeof txid === 'string' && txid.startsWith('mock-')) return true;
  if (!url) return false;
  return /(^|[?&])txid=mock-/.test(url) || /[?&]mock=1(&|$)/.test(url);
}

async function main() {
  const dbEnv = parseEnv(resolve(REPO, 'database', '.env'));
  const dbUrl = dbEnv.DATABASE_URL || process.env.DATABASE_URL;
  if (!dbUrl) {
    out('FATAL: no DATABASE_URL (database/.env missing and env unset)');
    process.exitCode = 2;
    return;
  }

  const client = new pg.Client({
    connectionString: dbUrl,
    connectionTimeoutMillis: 10_000,
    query_timeout: 20_000,
  });
  await client.connect();

  const { rows } = await client.query(
    `select id, purpose, amount_cents, network, gateway_txid, payment_url, created_at
       from payments
      where status = 'PENDING'
      order by created_at desc`,
  );

  const fabricated = rows.filter((r) => isFabricated(r.payment_url, r.gateway_txid));
  const real = rows.filter((r) => !isFabricated(r.payment_url, r.gateway_txid));

  out(`== pending payments: ${rows.length} (fabricated by mock mode: ${fabricated.length}, real: ${real.length}) ==`);
  for (const r of fabricated) {
    out(`  EXPIRE  ${r.id}  ${r.purpose}  ${(r.amount_cents / 100).toFixed(2)} USDT ${r.network}  created ${new Date(r.created_at).toISOString()}  txid=${r.gateway_txid ?? '-'}`);
  }
  for (const r of real) {
    out(`  KEEP    ${r.id}  ${r.purpose}  ${(r.amount_cents / 100).toFixed(2)} USDT ${r.network}  created ${new Date(r.created_at).toISOString()}  txid=${r.gateway_txid ?? '-'}  url=${(r.payment_url ?? '').slice(0, 80)}`);
  }

  if (!fabricated.length) {
    out('nothing fabricated to clear.');
  } else if (!APPLY) {
    out('DRY RUN — pass --apply to expire the fabricated invoices.');
  } else {
    const ids = fabricated.map((r) => r.id);
    const { rowCount } = await client.query(
      `update payments set status = 'EXPIRED' where id = any($1::uuid[]) and status = 'PENDING'`,
      [ids],
    );
    out(`APPLIED — expired ${rowCount} fabricated invoice(s).`);
    const { rows: left } = await client.query(
      `select count(*)::int as n from payments where status = 'PENDING'`,
    );
    out(`pending invoices remaining: ${left[0].n}`);
  }

  // A `registrations` row is the receipt for a settled §1 fee — and it blocks
  // a new registration invoice (ALREADY_REGISTERED). A member who was marked
  // registered by hand cannot start a fresh test invoice, so report it.
  const { rows: regs } = await client.query(
    `select r.user_id, u.email, r.created_at
       from registrations r
       join users u on u.id = r.user_id
      order by r.created_at desc
      limit 20`,
  );
  out(`== registrations (settled §1 receipts): ${regs.length} ==`);
  for (const r of regs) {
    out(`  REGISTERED  ${r.user_id}  ${r.email}  ${new Date(r.created_at).toISOString()}`);
  }

  await client.end();
}

main().catch((err) => {
  out(`FATAL: ${err.stack ?? err.message}`);
  process.exitCode = 2;
});
