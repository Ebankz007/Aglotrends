/**
 * Aglotrends — PostgreSQL schema (Drizzle ORM)
 *
 * Domains: identity, network, wallet/ledger, broker links, copy subscriptions,
 * signals + deliveries, compensation (registrations, settlements, rank awards,
 * pool ledger, payouts), notifications, audit, config.
 *
 * Money is stored in integer cents everywhere, matching @aglotrends/engine.
 * No ON DELETE CASCADE: a member is never deleted out from under their ledger.
 */
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

/* ------------------------------------------------------------------ enums */

export const userRoleEnum = pgEnum('user_role', ['MEMBER', 'ADMIN', 'SUPERADMIN']);
export const accountStatusEnum = pgEnum('account_status', ['PENDING', 'ACTIVE', 'SUSPENDED']);
export const sessionPurposeEnum = pgEnum('session_purpose', [
  'SESSION',
  'TWO_FACTOR_CHALLENGE',
  'EMAIL_VERIFY',
  'PASSWORD_RESET',
]);
export const brokerAccountStatusEnum = pgEnum('broker_account_status', [
  'PENDING',
  'VERIFIED',
  'REJECTED',
]);
export const signalDirectionEnum = pgEnum('signal_direction', ['BUY', 'SELL', 'NEUTRAL']);
export const signalStatusEnum = pgEnum('signal_status', ['DRAFT', 'PUBLISHED', 'CLOSED']);
export const notificationChannelEnum = pgEnum('notification_channel', [
  'IN_APP',
  'EMAIL',
  'WHATSAPP',
  'TELEGRAM',
]);
export const deliveryStatusEnum = pgEnum('delivery_status', ['PENDING', 'SENT', 'FAILED', 'SKIPPED']);
export const settlementStatusEnum = pgEnum('settlement_status', ['RECORDED', 'DISTRIBUTED']);
export const rankKindEnum = pgEnum('rank_kind', ['ASSOCIATE', 'LEADERSHIP']);
export const rankAwardStatusEnum = pgEnum('rank_award_status', [
  'PAID',
  'FLAGGED',
  'APPROVED',
  'REJECTED',
]);
export const poolKindEnum = pgEnum('pool_kind', ['RANK', 'LEADERSHIP']);
export const poolEntryTypeEnum = pgEnum('pool_entry_type', ['ACCRUAL', 'PAYOUT']);
export const payoutStatusEnum = pgEnum('payout_status', [
  'REQUESTED',
  'APPROVED',
  'REJECTED',
  'PAID',
]);
export const paymentPurposeEnum = pgEnum('payment_purpose', ['REGISTRATION', 'DEPOSIT']);
export const paymentStatusEnum = pgEnum('payment_status', ['PENDING', 'PAID', 'EXPIRED', 'FAILED']);

/* --------------------------------------------------------------- identity */

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  fullName: text('full_name').notNull(),
  phone: text('phone'),
  country: text('country'),
  role: userRoleEnum('role').notNull().default('MEMBER'),
  status: accountStatusEnum('status').notNull().default('ACTIVE'),

  // Referral / network
  sponsorId: uuid('sponsor_id').references((): AnyPgColumn => users.id),
  matrixParentId: uuid('matrix_parent_id').references((): AnyPgColumn => users.id),
  isActiveMember: boolean('is_active_member').notNull().default(true),
  highestAssociateRank: integer('highest_associate_rank').notNull().default(0),
  highestLeadershipRank: integer('highest_leadership_rank').notNull().default(0),

  // Security
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
  twoFactorSecret: text('two_factor_secret'),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  tokenHash: text('token_hash').notNull().unique(),
  purpose: sessionPurposeEnum('purpose').notNull().default('SESSION'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------- broker / copy */

export const brokerLinks = pgTable(
  'broker_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    url: text('url').notNull(),
    description: text('description'),
    logoUrl: text('logo_url'),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // A broker URL is a natural key: re-seeding must upsert on it, not duplicate.
  (t) => ({ urlUnique: unique('broker_links_url_unique').on(t.url) }),
);

export const clientBrokerAccounts = pgTable('client_broker_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  brokerLinkId: uuid('broker_link_id')
    .notNull()
    .references(() => brokerLinks.id),
  accountRef: text('account_ref').notNull(), // broker account number / login
  status: brokerAccountStatusEnum('status').notNull().default('PENDING'),
  fundedAmountCents: integer('funded_amount_cents').notNull().default(0),
  verifiedBy: uuid('verified_by').references(() => users.id),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Showcase strategies/traders for the community + copy-picker (display only; copying is manual). */
export const strategies = pgTable(
  'strategies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    traderName: text('trader_name').notNull(),
    description: text('description'),
    avatarUrl: text('avatar_url'),
    riskLevel: text('risk_level'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // Strategy names are how the UI and seeder identify a strategy — duplicate
  // names are ambiguous, so re-seeding upserts on the name.
  (t) => ({ nameUnique: unique('strategies_name_unique').on(t.name) }),
);

/** A client's intent to copy, recorded manually (the copy itself happens on the broker site). */
export const copySubscriptions = pgTable('copy_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  strategyId: uuid('strategy_id').references(() => strategies.id),
  brokerAccountId: uuid('broker_account_id').references(() => clientBrokerAccounts.id),
  status: text('status').notNull().default('MANUAL'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------- signals */

export const signals = pgTable('signals', {
  id: uuid('id').primaryKey().defaultRandom(),
  authorId: uuid('author_id').references(() => users.id),
  title: text('title').notNull(),
  instrument: text('instrument').notNull(),
  direction: signalDirectionEnum('direction').notNull(),
  entryPrice: text('entry_price'),
  stopLoss: text('stop_loss'),
  takeProfit: text('take_profit'),
  timeframe: text('timeframe'),
  notes: text('notes'),
  status: signalStatusEnum('status').notNull().default('DRAFT'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const signalDeliveries = pgTable('signal_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  signalId: uuid('signal_id')
    .notNull()
    .references(() => signals.id),
  userId: uuid('user_id').references(() => users.id), // null = broadcast
  channel: notificationChannelEnum('channel').notNull(),
  status: deliveryStatusEnum('status').notNull().default('PENDING'),
  error: text('error'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* --------------------------------------------------- wallet / ledger */

export const wallets = pgTable('wallets', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id),
  balanceCents: integer('balance_cents').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Append-only ledger. A row is never updated or deleted. */
export const ledgerEntries = pgTable('ledger_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  type: text('type').notNull(),
  amountCents: integer('amount_cents').notNull(), // positive = credit, negative = debit
  balanceAfterCents: integer('balance_after_cents').notNull(),
  sourceUserId: uuid('source_user_id').references(() => users.id),
  refType: text('ref_type'),
  refId: uuid('ref_id'),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* -------------------------------------------------- compensation */

export const registrations = pgTable('registrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  sponsorId: uuid('sponsor_id').references(() => users.id),
  feeCents: integer('fee_cents').notNull(),
  companyReserveCents: integer('company_reserve_cents').notNull(),
  directReferralCents: integer('direct_referral_cents').notNull(),
  generationCents: integer('generation_cents').notNull(),
  rankPoolCents: integer('rank_pool_cents').notNull(),
  leadershipPoolCents: integer('leadership_pool_cents').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** §7 — admin-entered realized profit per client per period (no live broker feed). */
export const profitSettlements = pgTable('profit_settlements', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  realizedProfitCents: integer('realized_profit_cents').notNull(),
  clientCents: integer('client_cents').notNull().default(0),
  sponsorCents: integer('sponsor_cents').notNull().default(0),
  companyCents: integer('company_cents').notNull().default(0),
  status: settlementStatusEnum('status').notNull().default('RECORDED'),
  recordedBy: uuid('recorded_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const rankAwards = pgTable('rank_awards', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  kind: rankKindEnum('kind').notNull(),
  rankId: integer('rank_id').notNull(),
  rewardCents: integer('reward_cents'),
  rewardSku: text('reward_sku'),
  status: rankAwardStatusEnum('status').notNull(),
  approvedBy: uuid('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** §10 — the shared, accumulating pools, as an append-only ledger. */
export const poolLedger = pgTable('pool_ledger', {
  id: uuid('id').primaryKey().defaultRandom(),
  pool: poolKindEnum('pool').notNull(),
  entryType: poolEntryTypeEnum('entry_type').notNull(),
  amountCents: integer('amount_cents').notNull(),
  balanceAfterCents: integer('balance_after_cents').notNull(),
  refType: text('ref_type'),
  refId: uuid('ref_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const payouts = pgTable('payouts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  type: text('type').notNull(),
  amountCents: integer('amount_cents').notNull(),
  status: payoutStatusEnum('status').notNull().default('REQUESTED'),
  method: text('method'),
  details: text('details'),
  approvedBy: uuid('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ---------------------------------------------- payments (Pay2Crypto) */

/**
 * Crypto invoices (Pay2Crypto). One row per invoice created against the
 * gateway. PENDING → PAID on the confirmation webhook.
 *
 *  - REGISTRATION — the §1 $20.00 one-time membership fee.
 *  - DEPOSIT      — a wallet top-up.
 *
 * `paymentRef` is the merchant-side reference the gateway echoes back (the
 * webhook join key); `gatewayTxid` is the gateway's checkout reference.
 */
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    purpose: paymentPurposeEnum('purpose').notNull(),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull().default('USDT'),
    status: paymentStatusEnum('status').notNull().default('PENDING'),
    /** Merchant-side reference echoed by the gateway (join key for webhooks). */
    paymentRef: text('payment_ref').notNull(),
    /** Pay2Crypto checkout reference. */
    gatewayTxid: text('gateway_txid'),
    /** Hosted checkout URL returned by the gateway. */
    paymentUrl: text('payment_url'),
    /** On-chain transaction hash from the confirmation webhook. */
    txHash: text('tx_hash'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('payments_user_idx').on(t.userId),
    uniqueIndex('payments_ref_idx').on(t.paymentRef),
    index('payments_status_idx').on(t.status),
  ],
);

/* ------------------------------------------------ notifications / audit */

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  link: text('link'),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const notificationSettings = pgTable('notification_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id),
  emailEnabled: boolean('email_enabled').notNull().default(true),
  whatsappEnabled: boolean('whatsapp_enabled').notNull().default(false),
  telegramEnabled: boolean('telegram_enabled').notNull().default(false),
  whatsappNumber: text('whatsapp_number'),
  telegramChatId: text('telegram_chat_id'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorId: uuid('actor_id').references(() => users.id),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  metadata: jsonb('metadata'),
  ip: text('ip'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const appConfig = pgTable(
  'app_config',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ keyUnique: unique('app_config_key_unique').on(t.key) }),
);
