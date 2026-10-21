#!/usr/bin/env node
/**
 * Probe the gateway for its webhook configuration and delivery history.
 *
 * Two deliveries arrived on 2026-10-21 (14:32 cancelled, 14:54 confirmed) and
 * then nothing — including for a payment the gateway itself reports as PAID.
 * So: is the webhook still configured, is it firing, and what does the vendor
 * say it signs? The API answers the first two questions only if the gateway
 * will talk about it.
 *
 * READ-ONLY: it issues GETs only.
 *
 * Usage: node database/scripts/diagnose-webhook-config.mjs
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

const CANDIDATES = [
  '/v1/webhooks',
  '/v1/webhook',
  '/v1/webhook-config',
  '/v1/webhook-deliveries',
  '/v1/deliveries',
  '/v1/events',
  '/v1/notifications',
  '/v1/settings',
  '/v1/settings/webhooks',
  '/v1/merchant/webhooks',
  '/v1/webhook-logs',
  '/openapi.json',
  '/swagger.json',
  '/docs',
];

async function main() {
  const apiEnv = parseEnv(API_ENV);
  const dbEnv = parseEnv(DB_ENV);
  const rawKey = apiEnv.SECRET_ENCRYPTION_KEY ?? '';
  if (!rawKey) {
    out('FATAL: SECRET_ENCRYPTION_KEY not set');
    process.exitCode = 2;
    return;
  }
  const key = /^[0-9a-fA-F]{64}$/.test(rawKey) ? Buffer.from(rawKey, 'hex') : Buffer.from(rawKey, 'base64');

  const dbUrl = dbEnv.DATABASE_URL || process.env.DATABASE_URL;
  const client = new pg.Client({ connectionString: dbUrl, connectionTimeoutMillis: 10_000 });
  await client.connect();
  const { rows } = await client.query("select value from app_config where key = 'payment.gateway'");
  await client.end();
  const gw = rows[0]?.value ?? {};
  const token = decryptSecret(String(gw.token ?? ''), key);
  const apiUrl = (gw.apiUrl || 'https://api.pay2crypto.com').replace(/\/+$/, '');
  if (!token) {
    out('FATAL: no gateway token');
    process.exitCode = 2;
    return;
  }
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  out(`== probing ${apiUrl} ==`);
  for (const path of CANDIDATES) {
    try {
      const res = await fetch(`${apiUrl}${path}`, { headers, signal: AbortSignal.timeout(12_000) });
      const text = await res.text();
      const body = text.slice(0, 900).replace(/\s+/g, ' ');
      out(`  ${res.status} ${path}  ${res.status === 200 ? body : ''}`);
    } catch (err) {
      out(`  ERR ${path}  ${err.message}`);
    }
  }
}

main().catch((err) => {
  out(`FATAL: ${err.stack ?? err.message}`);
  process.exitCode = 2;
});
