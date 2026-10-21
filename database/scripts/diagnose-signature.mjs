#!/usr/bin/env node
/**
 * Work out what Pay2Crypto signs.
 *
 * The vendor publishes no signing string, and the endpoint used to demand a
 * shared-secret header the gateway never sends — so every real delivery was
 * answered 401. The API now verifies a list of candidate schemes against the
 * real secret, but if none of them match, this script does the search
 * OFFLINE with a much wider space, using the body captured from the live
 * delivery.
 *
 * It reads the capture out of the API's own log (the window where the API
 * logs a callback it could not verify), then tries every combination of:
 *   keys      x  the webhook secret, the merchant token
 *   bodies    x  the raw bytes, the re-serialised JSON
 *   schemes   x  a wide list of timestamp/body/delivery/event arrangements
 *
 * A match is not a guess: it is an HMAC that reproduces the digest the
 * gateway sent. It prints the exact recipe so it can be pinned by a test.
 *
 * Usage: node database/scripts/diagnose-signature.mjs [--log=/root/.pm2/logs/aglotrends-api-out.log]
 */

import { readFileSync, existsSync } from 'node:fs';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const API_ENV = resolve(REPO, 'apps', 'api', '.env');
const DB_ENV = resolve(REPO, 'database', '.env');
const LOG_PATH = (() => {
  const hit = process.argv.find((a) => a.startsWith('--log='));
  return hit ? hit.slice('--log='.length).trim() : '/root/.pm2/logs/aglotrends-api-out.log';
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

const hex = (secret, message) => createHmac('sha256', secret).update(message, 'utf8').digest('hex');
const same = (a, b) => {
  if (a.length !== b.length) return false;
  if (!/^[0-9a-f]+$/.test(a)) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
};

/** Every arrangement of {timestamp, body, delivery, event} we can think of. */
function candidates(t, body, delivery, event) {
  const parts = { t, body, delivery, event };
  const list = [];
  const push = (name, s) => list.push([name, s]);
  push('ts.body', `${t}.${body}`);
  push('body', body);
  push('ts+body', `${t}${body}`);
  push('body.ts', `${body}.${t}`);
  push('v1.ts.body', `v1.${t}.${body}`);
  push('v1.body', `v1.${body}`);
  push('ts:body', `${t}:${body}`);
  push('ts\\nbody', `${t}\n${body}`);
  push('ts|body', `${t}|${body}`);
  push('ts body', `${t} ${body}`);
  push('body+ts', `${body}${t}`);
  push('body.ts.v1', `${body}.${t}.v1`);
  push('ts.v1.body', `${t}.v1.${body}`);
  if (delivery) {
    push('delivery.ts.body', `${delivery}.${t}.${body}`);
    push('ts.delivery.body', `${t}.${delivery}.${body}`);
    push('delivery.body', `${delivery}.${body}`);
    push('ts.body.delivery', `${t}.${body}.${delivery}`);
  }
  if (event) {
    push('ts.event.body', `${t}.${event}.${body}`);
    push('event.ts.body', `${event}.${t}.${body}`);
    push('event.body', `${event}.${body}`);
    push('ts.body.event', `${t}.${body}.${event}`);
  }
  return list;
}

/** Pull the captured callback out of the API log. */
function findCaptures(logText) {
  const captures = [];
  const lines = logText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!/signature rejected|body captured/i.test(lines[i])) continue;
    // pino prints the message and the fields on one line, in order.
    const line = lines[i];
    const event = /"event":"([^"]*)"/.exec(line)?.[1];
    const delivery = /"delivery":"([^"]*)"/.exec(line)?.[1];
    const bodyMatch = /"body":"((?:[^"\\]|\\.)*)"/.exec(line);
    const sigMatch = /"signature"?:"?t=(\d+),v1=([0-9a-f]+)/.exec(line);
    if (!bodyMatch) continue;
    let body;
    try {
      body = JSON.parse(`"${bodyMatch[1]}"`);
    } catch {
      body = bodyMatch[1];
    }
    captures.push({ event, delivery, body, sig: sigMatch ? { t: sigMatch[1], v1: sigMatch[2] } : null });
  }
  return captures;
}

async function main() {
  if (!existsSync(LOG_PATH)) {
    out(`FATAL: ${LOG_PATH} not found`);
    process.exitCode = 2;
    return;
  }
  const logText = readFileSync(LOG_PATH, 'utf-8');
  const captures = findCaptures(logText);
  out(`== ${captures.length} captured callback(s) in ${LOG_PATH} ==`);

  if (captures.length === 0) {
    out('  (no captured body yet — a delivery must arrive with the capture window open)');
    return;
  }

  // The secrets: the console's webhook secret and the merchant token.
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
  const webhookSecret = gw.webhookSecret ? decryptSecret(String(gw.webhookSecret), key) : '';
  const keys = [
    ['webhookSecret', webhookSecret],
    ['apiToken', token],
  ].filter(([, v]) => Boolean(v));

  for (const capture of captures) {
    out('--- capture ---');
    out(`  event=${capture.event ?? '?'} delivery=${capture.delivery ?? '?'}`);
    out(`  signature=${capture.sig ? `t=${capture.sig.t} v1=${capture.sig.v1.slice(0, 16)}…` : 'NOT IN LOG'}`);
    out(`  body=${capture.body.slice(0, 300)}`);
    if (!capture.sig) {
      out('  (no signature captured — the log line did not carry it)');
      continue;
    }

    let canonical = null;
    try {
      canonical = JSON.stringify(JSON.parse(capture.body));
    } catch {
      /* not JSON */
    }
    const bodies = [['raw', capture.body]];
    if (canonical && canonical !== capture.body) bodies.push(['canonical', canonical]);

    let found = null;
    let tried = 0;
    for (const [keyName, secret] of keys) {
      for (const [bodyName, body] of bodies) {
        for (const [scheme, message] of candidates(
          capture.sig.t,
          body,
          capture.delivery,
          capture.event,
        )) {
          tried++;
          if (same(hex(secret, message), capture.sig.v1)) {
            found = { keyName, bodyName, scheme, message: message.slice(0, 120) };
            break;
          }
        }
        if (found) break;
      }
      if (found) break;
    }

    if (found) {
      out('  ==> MATCH');
      out(`      key      = ${found.keyName}`);
      out(`      body     = ${found.bodyName}`);
      out(`      scheme   = ${found.scheme}`);
      out(`      message  = ${found.message}`);
    } else {
      out(`  ==> NO MATCH (${tried} combinations tried)`);
    }
  }
}

main().catch((err) => {
  out(`FATAL: ${err.stack ?? err.message}`);
  process.exitCode = 2;
});
