/**
 * Migration ledger verification.
 *
 * `drizzle-kit migrate` exits 0 and prints "migrations applied successfully!"
 * even when a migration file was never part of the journal — it has nothing to
 * apply, and it never says so. The deploy then proceeds to run an API that
 * expects a column the database does not have.
 *
 * drizzle records each applied migration in `drizzle.__drizzle_migrations`
 * with `created_at` = the journal entry's `when` value. So the invariant is
 * exact and checkable: every journal entry must have a matching row.
 *
 * Exit codes: 0 = ledger matches, 1 = mismatch, 2 = cannot verify.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const JOURNAL_PATH = join(MIGRATIONS_DIR, 'meta', '_journal.json');

const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf-8'));
const entries = Array.isArray(journal.entries) ? journal.entries : [];

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('[migrations] DATABASE_URL is not set — cannot verify the ledger');
  process.exit(2);
}

const client = new pg.Client({ connectionString: url });
try {
  await client.connect();
  const { rows } = await client.query(
    'SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at',
  );
  await client.end();

  const applied = new Set(rows.map((r) => String(r.created_at)));
  const missing = entries.filter((e) => !applied.has(String(e.when)));

  if (missing.length > 0) {
    console.error(
      `[migrations] LEDGER MISMATCH — ${missing.length} of ${entries.length} journal entries are NOT applied:`,
    );
    for (const m of missing) {
      console.error(`  - ${m.tag} (when=${m.when})`);
    }
    console.error(
      '[migrations] a migration file that is not in the journal will never run. Add it to the journal, then re-run.',
    );
    process.exit(1);
  }

  console.log(
    `[migrations] ledger OK — ${entries.length} journal entries, all applied (${rows.length} rows in drizzle.__drizzle_migrations).`,
  );
} catch (err) {
  try {
    await client.end();
  } catch {
    /* already closed */
  }
  console.error(`[migrations] could not verify the ledger: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}
