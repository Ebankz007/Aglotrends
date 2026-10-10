/**
 * Idempotent fixture repair for dev/testing.
 *
 * Restores the seeded accounts to their canonical state (roles, status, sponsor
 * links) and then prints the TRUTH FROM THE DATABASE — not what the caller
 * believes. This is the fast path to undo whatever a live test or a stale build
 * did to the dev DB.
 *
 * The accounts are read from `database/seed.accounts.json` (gitignored) — no
 * username or password is ever committed. See `seed-accounts.ts`.
 *
 * Run: pnpm --filter @aglotrends/database seed-users
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db, pool } from './index.js';
import { users, wallets } from './schema.js';
import { hashPassword } from './password.js';
import { loadSeedAccounts } from './seed-accounts.js';

const { accounts, source } = loadSeedAccounts();

async function main() {
  console.log('Repairing fixture users…');
  if (source === 'example') {
    console.log(
      '  NOTE: seed.accounts.json not found — repairing with the committed example (placeholders).',
    );
  }

  const byEmail = new Map<string, string>();
  for (const a of accounts) {
    const sponsorId = a.sponsorEmail ? byEmail.get(a.sponsorEmail) ?? null : null;
    const [row] = await db
      .insert(users)
      .values({
        email: a.email,
        passwordHash: hashPassword(a.password),
        fullName: a.fullName,
        role: a.role,
        status: a.status ?? 'ACTIVE',
        sponsorId,
        emailVerifiedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: users.email,
        set: {
          fullName: a.fullName,
          role: a.role,
          status: a.status ?? 'ACTIVE',
          sponsorId,
          isActiveMember: true,
        },
      })
      .returning();
    if (!row) throw new Error(`seed-users: failed to upsert ${a.email}`);
    byEmail.set(a.email, row.id);
    await db.insert(wallets).values({ userId: row.id, balanceCents: 0 }).onConflictDoNothing();
  }

  console.log('\nTruth from the database:');
  for (const a of accounts) {
    const [row] = await db.select().from(users).where(eq(users.email, a.email));
    if (!row) {
      console.log(`  ${a.email}: MISSING`);
      continue;
    }
    const sponsor = row.sponsorId
      ? (await db.select({ email: users.email }).from(users).where(eq(users.id, row.sponsorId)))[0]
      : null;
    console.log(
      `  ${row.email} / ${a.password} | role=${row.role} | status=${row.status} | activeMember=${row.isActiveMember} | sponsor=${sponsor?.email ?? '-'} | rank=${row.highestAssociateRank}`,
    );
  }
}

main()
  .catch((err) => {
    console.error('seed-users failed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
