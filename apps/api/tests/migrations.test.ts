import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The drizzle journal IS the migration list. A .sql file that is not in the
 * journal is a file the migrator never reads — it will happily report
 * "migrations applied successfully!" while applying nothing.
 *
 * That is not hypothetical: `0008_add_payments_network.sql` sat in the folder
 * for a full release cycle, unlisted, while the deployed API inserted into a
 * column the database did not have. The deploy log said success the whole
 * time. This test is the tripwire.
 */

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../database/migrations', import.meta.url));
const META_DIR = join(MIGRATIONS_DIR, 'meta');

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

const journal = JSON.parse(
  readFileSync(join(META_DIR, '_journal.json'), 'utf-8'),
) as Journal;

const journalTags = journal.entries.map((e) => e.tag);
const sqlFiles = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => f.replace(/\.sql$/, ''));

describe('drizzle migration journal', () => {
  it('is not empty and has sequential indexes', () => {
    expect(journal.entries.length).toBeGreaterThan(0);
    expect(journal.entries.map((e) => e.idx)).toEqual(
      journal.entries.map((_, i) => i),
    );
  });

  it('lists every migration file that exists on disk', () => {
    // The failure mode this catches: a migration file that drizzle will never
    // run, because the journal does not know about it.
    const orphans = sqlFiles.filter((tag) => !journalTags.includes(tag));
    expect(orphans).toEqual([]);
  });

  it('points every journal entry at a file that exists', () => {
    const missing = journalTags.filter(
      (tag) => !existsSync(join(MIGRATIONS_DIR, `${tag}.sql`)),
    );
    expect(missing).toEqual([]);
  });

  it('keeps a snapshot for every journal entry', () => {
    // The snapshot chain is what lets the NEXT generate diff correctly.
    // Drizzle names snapshots by journal INDEX (zero-padded to 4), not by tag.
    const missing = journal.entries
      .filter((e) => !existsSync(join(META_DIR, `${String(e.idx).padStart(4, '0')}_snapshot.json`)))
      .map((e) => e.tag);
    expect(missing).toEqual([]);
  });

  it('has no duplicate tags', () => {
    expect(new Set(journalTags).size).toBe(journalTags.length);
  });
});
