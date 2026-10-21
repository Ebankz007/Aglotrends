#!/usr/bin/env node
/**
 * One-shot production diagnostic for the Pay2Crypto rail.
 *
 * Answers two questions that cannot be answered from the outside:
 *   1. Is the merchant credential stored on this box actually alive?
 *   2. Does the live gateway still speak the contract we code against
 *      (`POST /v1/payment-requests` -> `checkout_url` + `token`)?
 *
 * It decrypts the stored credential IN PLACE, on the server, and never prints
 * a secret: only lengths, a 6-character format hint, and HTTP status codes.
 * The gateway is probed read-only first (GET endpoints); only if those do not
 * answer does it create ONE unpaid $1.00 request to exercise the write path.
 * That request charges nobody and expires on its own.
 *
 * Usage:  node database/scripts/diagnose-p2c.mjs [--create-probe]
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
const WANT_CREATE = process.argv.includes('--create-probe');

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
    if (/^token$/i.test(key) && value.length > 12) return `${value.slice(0, 8)}…(len=${value.length})`;
    if (value.length > 400) return `${value.slice(0, 400)}…`;
  }
  return value;
}

async function main() {
  const apiEnv = parseEnv(API_ENV);
  const dbEnv = parseEnv(DB_ENV);
  out('== env ==');
  for (const k of ['NODE_ENV', 'ALLOW_MOCK_RAIL', 'PAY2CRYPTO_API_URL', 'PAY2CRYPTO_TOKEN', 'PAY2CRYPTO_WEBHOOK_SECRET', 'SECRET_ENCRYPTION_KEY']) {
    const v = apiEnv[k];
    if (k === 'PAY2CRYPTO_API_URL' || k === 'ALLOW_MOCK_RAIL' || k === 'NODE_ENV') {
      out(`  ${k} = ${v === undefined ? '<unset>' : v === '' ? '<empty>' : v}`);
    } else {
      out(`  ${k} = ${v ? `<set len=${v.length}>` : '<unset-or-empty>'}`);
    }
  }
  out(`  APP_URL = ${apiEnv.APP_URL ?? '<unset>'}`);

  const dbUrl = dbEnv.DATABASE_URL || process.env.DATABASE_URL;
  if (!dbUrl) {
    out('FATAL: no DATABASE_URL (database/.env missing and env unset)');
    process.exitCode = 2;
    return;
  }

  const client = new pg.Client({
    connectionString: dbUrl,
    connectionTimeoutMillis: 10_000,
    query_timeout: 15_000,
  });
  await client.connect();
  const { rows } = await client.query(
    "select value from app_config where key = 'payment.gateway'",
  );
  await client.end();
  const gw = rows[0]?.value ?? {};
  out('== stored payment.gateway ==');
  out(`  apiUrl = ${gw.apiUrl ?? '<none>'}`);
  out(`  provider = ${gw.provider ?? '<none>'}  asset = ${gw.asset ?? '<none>'}  network = ${gw.network ?? '<none>'}`);
  out(`  forceMock = ${gw.forceMock}`);
  out(`  walletAddress = ${gw.walletAddress ? `set len=${gw.walletAddress.length}` : '<none>'}`);
  out(`  token (stored) = ${gw.token ? `len=${gw.token.length} encrypted=${String(gw.token).startsWith('v1:')}` : '<empty>'}`);
  out(`  webhookSecret (stored) = ${gw.webhookSecret ? `len=${gw.webhookSecret.length} encrypted=${String(gw.webhookSecret).startsWith('v1:')}` : '<empty>'}`);

  const rawKey = apiEnv.SECRET_ENCRYPTION_KEY ?? '';
  if (!rawKey) {
    out('FATAL: SECRET_ENCRYPTION_KEY not set — cannot decrypt the stored credential');
    process.exitCode = 2;
    return;
  }
  const key = /^[0-9a-fA-F]{64}$/.test(rawKey) ? Buffer.from(rawKey, 'hex') : Buffer.from(rawKey, 'base64');
  out(`  encryption key bytes = ${key.length}`);

  let token = '';
  let webhookSecret = '';
  try {
    token = decryptSecret(gw.token ?? '', key);
    webhookSecret = decryptSecret(gw.webhookSecret ?? '', key);
  } catch (err) {
    out(`FATAL: could not decrypt stored secret: ${err.message}`);
    process.exitCode = 2;
    return;
  }
  out('== decrypted (never printed in full) ==');
  out(`  token len=${token.length} first6=${JSON.stringify(token.slice(0, 6))} charset=${/^[A-Za-z0-9_\-.]+$/.test(token)}`);
  out(`  webhookSecret len=${webhookSecret.length}`);

  if (!token) {
    out('VERDICT: NO_TOKEN — nothing to probe; the rail cannot leave mock mode');
    return;
  }

  const apiUrl = (gw.apiUrl || 'https://api.pay2crypto.com').replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  // Every request is bounded: this script runs inside the deploy, and a hung
  // socket must never hold the deploy lock.
  const timeout = (ms = 12_000) => AbortSignal.timeout(ms);
  out(`== gateway probe against ${apiUrl} ==`);

  let authed = false;
  for (const path of ['/v1/balance', '/v1/payments', '/v1/merchant', '/v1/payment-requests']) {
    try {
      const res = await fetch(`${apiUrl}${path}`, { headers, signal: timeout() });
      const text = await res.text();
      const ok = res.status >= 200 && res.status < 300;
      if (ok) authed = true;
      out(`  GET ${path} -> ${res.status}${ok ? ' (AUTH OK)' : ''}`);
      if (text) {
        try {
          out(`      ${JSON.stringify(redact(JSON.parse(text))).slice(0, 300)}`);
        } catch {
          out(`      ${text.slice(0, 200)}`);
        }
      }
    } catch (err) {
      out(`  GET ${path} -> ERROR ${err.message}`);
    }
  }

  if (!authed) {
    out('  no read endpoint accepted the token; trying the write path');
    if (!WANT_CREATE) {
      out('  (write probe skipped — rerun with --create-probe to exercise it)');
    } else {
      const body = {
        amount: '1.00',
        asset: gw.asset || 'USDT',
        network: gw.network || 'trc20',
        reference: `AGL-PROBE-${Date.now()}`,
        description: 'Aglotrends connectivity probe',
        return_url: `${(apiEnv.APP_URL || 'https://aglotrends.com').replace(/\/$/, '')}/wallet`,
      };
      try {
        const res = await fetch(`${apiUrl}/v1/payment-requests`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: timeout(),
        });
        const text = await res.text();
        out(`  POST /v1/payment-requests -> ${res.status}`);
        let parsed = null;
        try {
          parsed = JSON.parse(text);
          out(`      ${JSON.stringify(redact(parsed)).slice(0, 500)}`);
        } catch {
          out(`      ${text.slice(0, 300)}`);
        }
        const url = parsed?.checkout_url || parsed?.payment_url || parsed?.url || '';
        if (url) {
          let host = 'unparseable';
          try {
            host = new URL(url).host;
          } catch {
            /* keep the default */
          }
          out(`      checkout host = ${host}`);
          try {
            const head = await fetch(url, { redirect: 'manual', signal: timeout() });
            out(`      checkout GET -> ${head.status}`);
          } catch (err) {
            out(`      checkout GET -> ERROR ${err.message}`);
          }
        } else {
          out('      no checkout_url in the response');
        }
      } catch (err) {
        out(`  POST /v1/payment-requests -> ERROR ${err.message}`);
      }
    }
  }

  out('== verdict ==');
  if (authed) out('  TOKEN_LIVE — the stored credential authenticates against the gateway');
  else out('  TOKEN_NOT_ACCEPTED — the stored credential does not authenticate (see status codes above)');
}

main().catch((err) => {
  out(`FATAL: ${err.stack ?? err.message}`);
  process.exitCode = 2;
});
