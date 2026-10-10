/**
 * Full development seed — idempotent. Safe to re-run.
 * Creates: the login set, broker links, showcase strategies, sample signals,
 * platform config, wallets.
 *
 * The logins themselves are NOT in this file. They are read from
 * `database/seed.accounts.json` (gitignored) so no username or password is ever
 * committed. See `seed-accounts.ts`.
 *
 * Run: pnpm --filter @aglotrends/database seed
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db, pool } from './index.js';
import { appConfig, brokerLinks, signals, strategies, users, wallets } from './schema.js';
import { hashPassword } from './password.js';
import { loadSeedAccounts } from './seed-accounts.js';

const { accounts, source } = loadSeedAccounts();

async function main() {
  console.log('Seeding Aglotrends dev database…');
  if (source === 'example') {
    console.log(
      '  NOTE: seed.accounts.json not found — using the committed example.\n' +
        '        These are PLACEHOLDER logins. Copy seed.accounts.example.json to\n' +
        '        seed.accounts.json and fill in real dev credentials.',
    );
  }

  const byEmail = new Map<string, typeof users.$inferSelect>();
  for (const a of accounts) {
    const sponsorId = a.sponsorEmail ? byEmail.get(a.sponsorEmail)?.id ?? null : null;
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
        },
      })
      .returning();
    if (!row) throw new Error(`seed: failed to upsert ${a.email}`);
    byEmail.set(a.email, row);
    // ensure wallet exists
    await db.insert(wallets).values({ userId: row.id, balanceCents: 0 }).onConflictDoNothing();
    console.log(`  user ${a.email} -> role=${row.role} status=${row.status}`);
  }

  const brokerFixtures = [
    { name: 'MetaTrader 5 — Demo', url: 'https://www.metatrader5.com/en/demo', description: 'Free MT5 demo account for copy-trading practice.' },
    { name: 'Exness', url: 'https://www.exness.com', description: 'Multi-asset broker with copy-trading support.' },
    { name: 'IC Markets', url: 'https://www.icmarkets.com', description: 'Raw spread trading, popular with signal followers.' },
  ];
  for (const b of brokerFixtures) {
    await db
      .insert(brokerLinks)
      .values({ ...b, isActive: true, sortOrder: 1 })
      .onConflictDoUpdate({ target: brokerLinks.url, set: { name: b.name, description: b.description, isActive: true } });
  }
  console.log(`  broker links: ${brokerFixtures.length}`);

  const strategyFixtures = [
    { name: 'Trend Rider', traderName: 'A. Sterling', description: 'Momentum-following on EUR/USD and GBP/USD.', riskLevel: 'MEDIUM' },
    { name: 'Gold Scalper', traderName: 'M. Okafor', description: 'Intraday XAU/USD scalps with tight stops.', riskLevel: 'HIGH' },
  ];
  for (const s of strategyFixtures) {
    await db
      .insert(strategies)
      .values({ ...s, isActive: true })
      .onConflictDoUpdate({ target: strategies.name, set: { traderName: s.traderName, description: s.description, riskLevel: s.riskLevel, isActive: true } });
  }
  console.log(`  strategies: ${strategyFixtures.length}`);

  // Author the demo signals as the first ADMIN in the login set.
  const adminAccount = accounts.find((a) => a.role === 'ADMIN');
  const adminId = adminAccount ? byEmail.get(adminAccount.email)?.id ?? null : null;
  const signalFixtures = [
    {
      title: 'EURUSD — long setup',
      instrument: 'EUR/USD',
      direction: 'BUY' as const,
      entryPrice: '1.0840 – 1.0860',
      stopLoss: '1.0790',
      takeProfit: '1.0960',
      timeframe: 'H4',
      notes: 'Bullish structure above 1.0800; manage risk at 1% per trade.',
      status: 'PUBLISHED' as const,
    },
    {
      title: 'XAUUSD — pullback short',
      instrument: 'XAU/USD',
      direction: 'SELL' as const,
      entryPrice: '2,410 – 2,420',
      stopLoss: '2,435',
      takeProfit: '2,360',
      timeframe: 'H1',
      notes: 'Rejection at resistance; watch for volume confirmation.',
      status: 'PUBLISHED' as const,
    },
  ];
  // Signals have no natural unique key (an admin may legitimately reuse a
  // title), so seeding is idempotent by existence check rather than ON CONFLICT.
  let signalCount = 0;
  for (const s of signalFixtures) {
    const [existing] = await db
      .select({ id: signals.id })
      .from(signals)
      .where(eq(signals.title, s.title))
      .limit(1);
    if (existing) continue;
    await db
      .insert(signals)
      .values({ ...s, authorId: adminId, publishedAt: new Date() });
    signalCount += 1;
  }
  console.log(`  signals: ${signalCount} created (${signalFixtures.length - signalCount} already present)`);

  const configRows = [
    { key: 'platform.name', value: { name: 'Aglotrends' } },
    { key: 'compensation.plan', value: { feeCents: 2000, reserveBps: 4500, communityBps: 5500, directBps: 3000, generationBps: 1000, rankPoolBps: 800, leadershipPoolBps: 700 } },
    { key: 'platform.registrationOpen', value: { open: true } },
  ];
  for (const c of configRows) {
    await db
      .insert(appConfig)
      .values({ key: c.key, value: c.value })
      .onConflictDoUpdate({ target: appConfig.key, set: { value: c.value } });
  }
  console.log(`  config: ${configRows.length}`);

  console.log('\nSeed complete.');
  console.log('\nPRIMARY LOGINS (from seed.accounts.json):');
  for (const a of accounts.filter((x) => x.primary)) {
    console.log(`  ${a.email} / ${a.password}  [${a.role}]`);
  }
  const others = accounts.filter((x) => !x.primary).map((u) => u.email);
  if (others.length > 0) {
    console.log(`\nOther seeded accounts (dev fixtures, DO NOT use in production): ${others.join(', ')}`);
  }
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
