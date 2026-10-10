/**
 * Seed-account loader.
 *
 * The dev logins (emails + passwords) are deliberately NOT in the repository.
 * They live in `database/seed.accounts.json`, which is gitignored, so no
 * username or password can ever be committed or pushed.
 *
 * A fresh clone falls back to the committed `seed.accounts.example.json`, which
 * contains placeholder accounts — the seed still runs, but with throwaway
 * credentials, and it says so loudly.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type SeedRole = 'MEMBER' | 'ADMIN' | 'SUPERADMIN';
export type SeedStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED';

export interface SeedAccount {
  email: string;
  fullName: string;
  role: SeedRole;
  status?: SeedStatus;
  sponsorEmail?: string | null;
  password: string;
  /** Printed by the seed as "the logins"; used to author the demo signals. */
  primary?: boolean;
}

const LOCAL = fileURLToPath(new URL('../seed.accounts.json', import.meta.url));
const EXAMPLE = fileURLToPath(new URL('../seed.accounts.example.json', import.meta.url));

export function loadSeedAccounts(): { accounts: SeedAccount[]; source: 'local' | 'example' } {
  const useLocal = existsSync(LOCAL);
  const path = useLocal ? LOCAL : EXAMPLE;

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`Could not read seed accounts from ${path}: ${(err as Error).message}`);
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`Seed accounts file is empty or malformed: ${path}`);
  }
  for (const a of raw as SeedAccount[]) {
    if (!a.email || !a.password || !a.role) {
      throw new Error(`Seed account is missing email/password/role: ${JSON.stringify(a)}`);
    }
  }
  return { accounts: raw as SeedAccount[], source: useLocal ? 'local' : 'example' };
}
