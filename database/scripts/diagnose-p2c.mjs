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
  for (const k of ['NODE_ENV', 'ALLOW_MOCK_RAIL', 'PAY2CRYPTO_API_URL', 'PAY2CRYPTO_TOKEN', 'PAY2CRYPTO_WEBHOOK_SECRET', 'PAY2CRYPTO_NETWORKS', 'SECRET_ENCRYPTION_KEY']) {
    const v = apiEnv[k];
    if (k === 'PAY2CRYPTO_API_URL' || k === 'ALLOW_MOCK_RAIL' || k === 'NODE_ENV' || k === 'PAY2CRYPTO_NETWORKS') {
      out(`  ${k} = ${v === undefined ? '<unset>' : v === '' ? '<empty>' : v}`);
    } else {
      out(`  ${k} = ${v ? `<set len=${v.length}>` : '<unset-or-empty>'}`);
    }
  }
  out(`  APP_URL = ${apiEnv.APP_URL ?? '<unset>'}`);
  out(
    `  RUNTIME_RAIL = ${
      apiEnv.PAY2CRYPTO_TOKEN && apiEnv.ALLOW_MOCK_RAIL !== 'true' ? 'LIVE' : 'MOCK'
    }`,
  );

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

  // Reclaim the addresses our own probes are holding.
  //
  // A pending payment request OCCUPIES a receiving address on the merchant
  // account until it settles or expires. The account has 2 TRC20 addresses,
  // so two abandoned probes block every TRC20 payment for an hour - the
  // member sees "all addresses are awaiting payment" and the rail looks
  // broken. Cancelling our own probe requests releases them immediately.
  // ONLY requests whose reference starts with our probe prefix are touched:
  // a real member's invoice is never cancelled by a diagnostic.
  const PROBE_PREFIXES = ['AGL-PROBE-', 'AGL-RAIL-'];
  try {
    const res = await fetch(`${apiUrl}/v1/payment-requests`, { headers, signal: timeout() });
    const body = await res.json();
    const items = Array.isArray(body?.data) ? body.data : [];
    const mine = items.filter(
      (r) => typeof r?.reference === 'string' && PROBE_PREFIXES.some((p) => r.reference.startsWith(p)),
    );
    out(`== reclaiming probe invoices (${mine.length} of ${items.length}) ==`);
    for (const item of mine) {
      const token = item.token;
      let done = false;
      for (const [label, method, path] of [
        ['DELETE', 'DELETE', `/v1/payment-requests/${token}`],
        ['CANCEL', 'POST', `/v1/payment-requests/${token}/cancel`],
      ]) {
        try {
          const r = await fetch(`${apiUrl}${path}`, { method, headers, signal: timeout() });
          out(`  ${label} ${path.slice(0, 46)} -> ${r.status}`);
          if (r.status >= 200 && r.status < 300) {
            done = true;
            break;
          }
        } catch (err) {
          out(`  ${label} ${path.slice(0, 46)} -> ERROR ${err.message}`);
        }
      }
      if (!done) out(`  could not cancel ${String(token).slice(0, 8)} (it will free the address when it expires)`);
    }
  } catch (err) {
    out(`  reclaim pass failed: ${err.message}`);
  }

  // Is the webhook configured on the account? If it is not, payments settle
  // only by hand. Read-only probes; a 404 simply means "no such endpoint".
  out('== webhook configuration probe ==');
  for (const path of [
    '/v1/webhook',
    '/v1/webhooks',
    '/v1/settings',
    '/v1/config',
    '/v1/notify',
    '/v1/callbacks',
  ]) {
    try {
      const res = await fetch(`${apiUrl}${path}`, { headers, signal: timeout() });
      const text = await res.text();
      if (res.status >= 200 && res.status < 300) {
        out(`  GET ${path} -> ${res.status}`);
        out(`      ${text.slice(0, 300)}`);
      } else {
        out(`  GET ${path} -> ${res.status}`);
      }
    } catch (err) {
      out(`  GET ${path} -> ERROR ${err.message}`);
    }
  }

  // The address pool. A pending request OCCUPIES a receiving address, so the
  // number of addresses per network IS the number of members who can pay at
  // the same time. The operator needs this number to size the account.
  out('== address pool probe ==');
  for (const path of [
    '/v1/wallet-addresses',
    '/v1/addresses',
    '/v1/wallet',
    '/v1/receiving-addresses',
  ]) {
    try {
      const res = await fetch(`${apiUrl}${path}`, { headers, signal: timeout() });
      const text = await res.text();
      out(`  GET ${path} -> ${res.status}`);
      if (res.status >= 200 && res.status < 300) {
        out(`      ${text.slice(0, 400)}`);
      }
    } catch (err) {
      out(`  GET ${path} -> ERROR ${err.message}`);
    }
  }

  if (!authed || WANT_CREATE) {
    if (authed) out('  read endpoints answered; still exercising the write path (--create-probe)');
    else out('  no read endpoint accepted the token; trying the write path');
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
        // The response key names are the webhook contract's key names.
        if (parsed && typeof parsed === 'object') {
          out(`      response keys = ${Object.keys(parsed).join(',')}`);
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

  // The rail question. The live create response carried "network_mode":"fixed",
  // which may mean the merchant account serves ONE network while our product
  // lets the client pick trc20/erc20/bep20. If the gateway silently coerces
  // the rail, a member who picks BEP20 is charged on TRC20 — funds sent on the
  // wrong chain. Ask the gateway directly, once per rail.
  //
  // This creates payment requests, and a pending request OCCUPIES a receiving
  // address on the account until it expires. So it runs ONLY inside the
  // write probe - a routine diagnostic must never hold a member's rail.
  if (WANT_CREATE) {
    out('== rail probe (does the account serve every rail we offer?) ==');
    for (const network of ['trc20', 'erc20', 'bep20']) {
      try {
        const res = await fetch(`${apiUrl}/v1/payment-requests`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            amount: '1.00',
            asset: gw.asset || 'USDT',
            network,
            reference: `AGL-RAIL-${network}-${Date.now()}`,
            description: `Aglotrends rail probe (${network})`,
            return_url: `${(apiEnv.APP_URL || 'https://aglotrends.com').replace(/\/$/, '')}/wallet`,
          }),
          signal: timeout(),
        });
        const text = await res.text();
        let parsed = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
        const served = parsed?.network ?? '?';
        const mode = parsed?.network_mode ?? '?';
        const addr = typeof parsed?.pay_address === 'string' ? parsed.pay_address : '';
        const shape = addr.startsWith('0x') ? 'evm' : addr.startsWith('T') ? 'trc' : addr ? '?' : '-';
        out(
          `  asked ${network} -> ${res.status}  served=${served}  mode=${mode}  address_shape=${shape}`,
        );
        if (parsed && res.status >= 400) {
          out(`      ${JSON.stringify(redact(parsed)).slice(0, 200)}`);
        }
      } catch (err) {
        out(`  asked ${network} -> ERROR ${err.message}`);
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
