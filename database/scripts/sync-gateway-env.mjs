#!/usr/bin/env node
/**
 * Publish the console's payment credential into the runtime environment.
 *
 * The architecture is env-only: the API reads PAY2CRYPTO_* from apps/api/.env
 * and NEVER from the database. But the console stores the credential in
 * app_config.payment.gateway (encrypted). Without a step that moves it from
 * there to the environment, the credential Henry configured sits in the
 * database while the API keeps running the mock rail forever. This is that
 * step.
 *
 * It runs on every deploy, before the API starts, so the runtime env and the
 * console never drift.
 *
 * Rules, each one earned:
 *  - The token and webhook secret are written ONLY from the console. They are
 *    never printed - only their length and a short prefix.
 *  - ALLOW_MOCK_RAIL is set to "false" exactly once: when the credential is
 *    populated for the first time. After that it is the operator's switch and
 *    this script does not touch it. A review deployment that deliberately
 *    keeps the mock rail must not be flipped live by a later deploy.
 *  - PAY2CRYPTO_NETWORKS (the rails the account can serve) is written only if
 *    absent, unless the operator passes --networks explicitly.
 *  - An empty console credential never blanks a working environment.
 *
 * Exit codes: 0 = nothing changed, 42 = the environment changed (the deploy
 * must restart the API to pick it up), 1 = failure.
 */

import { readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDecipheriv } from 'node:crypto';
import pg from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const API_DIR = resolve(REPO, 'apps', 'api');
const ENV_FILE = resolve(API_DIR, '.env');

const APPLY = process.argv.includes('--apply');
const NETWORKS_ARG = (() => {
  const hit = process.argv.find((a) => a.startsWith('--networks='));
  return hit ? hit.slice('--networks='.length).trim() : '';
})();
const out = (line) => process.stdout.write(`${line}\n`);

function parseEnv(text) {
  const result = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) result[m[1]] = m[2].trim().replace(/^["']|['"]$/g, '');
  }
  return result;
}

/** Mirror of the API's envelope decrypt (v1:<iv>:<tag>:<ciphertext>). */
function decryptSecret(payload, key) {
  if (!payload) return '';
  if (!payload.startsWith('v1:')) return payload;
  const [, ivB64, tagB64, dataB64] = payload.split(':');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf-8');
}

/** Replace or append a key in a .env file, preserving everything else. */
function setKey(lines, key, value) {
  const pattern = new RegExp(`^(\\s*${key}\\s*=).*$`);
  const index = lines.findIndex((l) => pattern.test(l));
  const rendered = `${key}=${value}`;
  if (index >= 0) {
    if (lines[index] === rendered) return { lines, changed: false };
    const next = [...lines];
    next[index] = rendered;
    return { lines: next, changed: true };
  }
  return { lines: [...lines, rendered], changed: true };
}

function readKey(lines, key) {
  const pattern = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`);
  const hit = lines.find((l) => pattern.test(l));
  return hit ? hit.replace(pattern, '$1').trim().replace(/^["']|['"]$/g, '') : undefined;
}

async function main() {
  const dbEnv = parseEnv(
    existsSync(resolve(REPO, 'database', '.env'))
      ? readFileSync(resolve(REPO, 'database', '.env'), 'utf-8')
      : '',
  );
  const databaseUrl = dbEnv.DATABASE_URL || process.env.DATABASE_URL;
  if (!databaseUrl) {
    out('FATAL: no DATABASE_URL');
    process.exitCode = 1;
    return;
  }

  const client = new pg.Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10_000,
    query_timeout: 15_000,
  });
  await client.connect();
  const { rows } = await client.query(
    "select value from app_config where key = 'payment.gateway'",
  );
  await client.end();

  const gw = rows[0]?.value ?? {};
  out('== console credential ==');
  out(`  apiUrl = ${gw.apiUrl || '<none>'}`);
  out(`  token stored = ${gw.token ? `len=${String(gw.token).length} encrypted=${String(gw.token).startsWith('v1:')}` : '<empty>'}`);
  out(`  webhookSecret stored = ${gw.webhookSecret ? `len=${String(gw.webhookSecret).length}` : '<empty>'}`);

  // Email is resolved from the console FIRST (app_config `integrations`), with
  // the environment as a fallback - so the console is the real source. Report
  // its state (never the secrets) so the operator can see whether password
  // resets will actually be delivered.
  const { rows: integrationRows } = await (async () => {
    const c = new pg.Client({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 10_000,
      query_timeout: 15_000,
    });
    await c.connect();
    const res = await c.query("select value from app_config where key = 'integrations'");
    await c.end();
    return res;
  })();
  const integ = integrationRows[0]?.value ?? {};
  const email = integ.email ?? {};
  out('== console email ==');
  out(`  provider = ${email.provider || '<none>'}  enabled = ${email.enabled}`);
  out(`  smtpUrl = ${email.smtpUrl ? 'set' : '<unset>'}  resendApiKey = ${email.resendApiKey ? 'set' : '<unset>'}  from = ${email.from || '<unset>'}`);

  if (!gw.token) {
    out('  console holds no credential - leaving the environment untouched');
    return;
  }

  if (!existsSync(ENV_FILE)) {
    out(`FATAL: ${ENV_FILE} does not exist`);
    process.exitCode = 1;
    return;
  }

  const rawEnv = readFileSync(ENV_FILE, 'utf-8');
  const envLines = rawEnv.split(/\r?\n/);
  const env = parseEnv(rawEnv);

  const rawKey = env.SECRET_ENCRYPTION_KEY ?? '';
  if (!rawKey) {
    out('FATAL: SECRET_ENCRYPTION_KEY is not set in apps/api/.env');
    process.exitCode = 1;
    return;
  }
  const key = /^[0-9a-fA-F]{64}$/.test(rawKey)
    ? Buffer.from(rawKey, 'hex')
    : Buffer.from(rawKey, 'base64');

  let token = '';
  let webhookSecret = '';
  try {
    token = decryptSecret(String(gw.token), key);
    webhookSecret = gw.webhookSecret ? decryptSecret(String(gw.webhookSecret), key) : '';
  } catch (err) {
    out(`FATAL: could not decrypt the console credential: ${err.message}`);
    process.exitCode = 1;
    return;
  }
  if (!token) {
    out('FATAL: decrypted token is empty');
    process.exitCode = 1;
    return;
  }

  out('== decrypted (never printed in full) ==');
  out(`  token len=${token.length} first6=${JSON.stringify(token.slice(0, 6))}`);
  out(`  webhookSecret len=${webhookSecret.length}`);

  let lines = envLines;
  let changed = false;
  const apply = (keyName, value, force) => {
    const current = readKey(lines, keyName);
    if (current === value) return;
    if (!force && current !== undefined && current !== '') return; // operator's value - do not stomp
    const result = setKey(lines, keyName, value);
    lines = result.lines;
    changed = changed || result.changed;
  };

  apply('PAY2CRYPTO_API_URL', (gw.apiUrl || 'https://api.pay2crypto.com').replace(/\/+$/, ''), true);
  apply('PAY2CRYPTO_TOKEN', token, true);
  apply('PAY2CRYPTO_WEBHOOK_SECRET', webhookSecret, true);
  if (NETWORKS_ARG) apply('PAY2CRYPTO_NETWORKS', NETWORKS_ARG, true);
  else apply('PAY2CRYPTO_NETWORKS', 'trc20', false);

  // The mock rail is a review-only hatch. Populating a live credential is the
  // moment the rail must stop being a review rail - but only that moment.
  // After this, ALLOW_MOCK_RAIL belongs to the operator.
  const hadToken = Boolean(env.PAY2CRYPTO_TOKEN);
  if (!hadToken) {
    const result = setKey(lines, 'ALLOW_MOCK_RAIL', 'false');
    lines = result.lines;
    changed = changed || result.changed;
  }

  const finalEnv = parseEnv(lines.join('\n'));
  out('== environment (result) ==');
  out(`  PAY2CRYPTO_API_URL = ${finalEnv.PAY2CRYPTO_API_URL || '<empty>'}`);
  out(`  PAY2CRYPTO_TOKEN = ${finalEnv.PAY2CRYPTO_TOKEN ? `set len=${finalEnv.PAY2CRYPTO_TOKEN.length} first6=${JSON.stringify(finalEnv.PAY2CRYPTO_TOKEN.slice(0, 6))}` : '<unset>'}`);
  out(`  PAY2CRYPTO_WEBHOOK_SECRET = ${finalEnv.PAY2CRYPTO_WEBHOOK_SECRET ? `set len=${finalEnv.PAY2CRYPTO_WEBHOOK_SECRET.length}` : '<unset>'}`);
  out(`  PAY2CRYPTO_NETWORKS = ${finalEnv.PAY2CRYPTO_NETWORKS || '<unset>'}`);
  out(`  ALLOW_MOCK_RAIL = ${finalEnv.ALLOW_MOCK_RAIL || '<unset>'}`);
  out(`  LIVE = ${finalEnv.PAY2CRYPTO_TOKEN && finalEnv.ALLOW_MOCK_RAIL !== 'true' ? 'yes' : 'no (mock rail active)'}`);

  if (!changed) {
    out('  environment already matches the console - nothing to do');
    return;
  }
  if (!APPLY) {
    out('  DRY RUN - pass --apply to write apps/api/.env');
    return;
  }

  // Atomic: write beside the target, then rename over it. A half-written .env
  // would boot the API with half a credential.
  const tmp = `${ENV_FILE}.tmp`;
  writeFileSync(tmp, lines.join('\n'), { encoding: 'utf-8', mode: 0o600 });
  renameSync(tmp, ENV_FILE);
  out('  APPLIED - apps/api/.env updated');
  process.exitCode = 42; // the environment changed: the API must restart
}

main().catch((err) => {
  out(`FATAL: ${err.stack ?? err.message}`);
  process.exitCode = 1;
});
