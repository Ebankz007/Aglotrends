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

/** KYC/AML — a member must be VERIFIED before any withdrawal leaves the system. */
export const kycStatusEnum = pgEnum('kyc_status', [
  'NOT_STARTED',
  'PENDING',
  'VERIFIED',
  'REJECTED',
]);

/** Platform transaction fee — collected per inbound gateway payment, settled by hand. */
export const platformFeeStatusEnum = pgEnum('platform_fee_status', ['PENDING', 'SETTLED']);

/* ------------------------------------------- education / events / support */

/** Education resource shape — an article, a video, or an outbound link. */
export const educationResourceTypeEnum = pgEnum('education_resource_type', [
  'ARTICLE',
  'VIDEO',
  'LINK',
]);

export const eventRegistrationStatusEnum = pgEnum('event_registration_status', [
  'GOING',
  'CANCELLED',
]);

export const supportTicketStatusEnum = pgEnum('support_ticket_status', [
  'OPEN',
  'PENDING',
  'RESOLVED',
  'CLOSED',
]);

export const supportTicketPriorityEnum = pgEnum('support_ticket_priority', [
  'LOW',
  'NORMAL',
  'HIGH',
  'URGENT',
]);

/** Who authored a support message — the member or the operator. */
export const supportAuthorRoleEnum = pgEnum('support_author_role', ['MEMBER', 'STAFF']);

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
  // The TOTP seed, encrypted with the same envelope as the gateway secrets
  // (lib/crypto.ts). It is a bearer credential: whoever holds it can mint valid
  // codes forever, so it is never stored in the clear.
  twoFactorSecret: text('two_factor_secret'),
  // Recovery codes are one-shot fallbacks for a lost device. Stored hashed
  // (sha-256), never in the clear, for the same reason as the seed.
  twoFactorRecoveryCodes: jsonb('two_factor_recovery_codes').$type<string[]>().notNull().default([]),
  twoFactorEnrolledAt: timestamp('two_factor_enrolled_at', { withTimezone: true }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),

  // Admin access control. Meaningless for MEMBER; SUPERADMIN bypasses it
  // structurally. `permissions` maps an admin area -> 'VIEW' | 'MANAGE'; an area
  // absent from the map is NONE. `viewOnly` is a blunt override that caps every
  // granted area at VIEW, so read access can be handed out without touching the
  // matrix — and re-granting write access is one switch, not nine.
  permissions: jsonb('permissions').$type<Record<string, string>>().notNull().default({}),
  viewOnly: boolean('view_only').notNull().default(false),

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
    /** Total charged to the member, INCLUDING the platform fee. */
    amountCents: integer('amount_cents').notNull(),
    /**
     * The platform transaction fee carved out of `amountCents` (default $3.00).
     * It is platform revenue, NOT compensation: the engine still allocates the
     * registration base ($20.00) untouched. Net = amountCents - platformFeeCents.
     */
    platformFeeCents: integer('platform_fee_cents').notNull().default(0),
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

/* ------------------------------------------- platform fees (operator revenue) */

/**
 * Platform transaction fees — the flat fee carved out of every inbound gateway
 * payment (default $3.00), routed to an operator-controlled wallet configured
 * by a SUPERADMIN and never exposed to members.
 *
 * One row per collected fee. `walletAddress`/`network`/`asset` are SNAPSHOTTED
 * at collection time so a later wallet change cannot rewrite history.
 * Settlement is MANUAL: the operator moves the funds and marks the row SETTLED.
 */
export const platformFees = pgTable(
  'platform_fees',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    paymentId: uuid('payment_id').references(() => payments.id),
    purpose: paymentPurposeEnum('purpose').notNull(),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull().default('USDT'),
    /** Destination wallet as configured when this fee was collected. */
    walletAddress: text('wallet_address').notNull().default(''),
    network: text('network').notNull().default(''),
    asset: text('asset').notNull().default(''),
    status: platformFeeStatusEnum('status').notNull().default('PENDING'),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    settledBy: uuid('settled_by').references(() => users.id),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('platform_fees_status_idx').on(t.status),
    index('platform_fees_user_idx').on(t.userId),
    // One fee per payment — the idempotency token for webhook replays.
    uniqueIndex('platform_fees_payment_idx').on(t.paymentId),
  ],
);

/* ------------------------------------------------------------------ KYC/AML */

/**
 * KYC/AML identity record. One per member. A member must reach VERIFIED before
 * any withdrawal is allowed out of the system (see services/payouts.ts).
 *
 * Documents are stored as references (URLs / storage keys), not blobs — the
 * upload target is a deployment concern. `idNumber` is sensitive and is never
 * returned in full by the API (see the masked view in services/kyc.ts).
 */
export const kycProfiles = pgTable(
  'kyc_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    status: kycStatusEnum('status').notNull().default('NOT_STARTED'),
    legalName: text('legal_name'),
    dateOfBirth: date('date_of_birth'),
    country: text('country'),
    address: text('address'),
    idType: text('id_type'),
    idNumber: text('id_number'),
    documents: jsonb('documents'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    rejectionReason: text('rejection_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('kyc_profiles_user_idx').on(t.userId)],
);

/* ------------------------------------------------------------- education */

/**
 * Learning resources shown in the member portal. Operator-authored; a member
 * only ever sees `isPublished` rows. `body` is plain text/markdown, `url` is
 * the external target for VIDEO/LINK resources.
 */
export const educationResources = pgTable(
  'education_resources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    summary: text('summary'),
    body: text('body'),
    category: text('category').notNull().default('GENERAL'),
    /** Free-form level label (BEGINNER / INTERMEDIATE / ADVANCED / …). */
    level: text('level'),
    resourceType: educationResourceTypeEnum('resource_type').notNull().default('ARTICLE'),
    url: text('url'),
    coverImageUrl: text('cover_image_url'),
    isPublished: boolean('is_published').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('education_resources_published_idx').on(t.isPublished),
    index('education_resources_sort_idx').on(t.sortOrder),
  ],
);

/* ---------------------------------------------------------------- events */

/**
 * Scheduled events (webinars, workshops, meetups). Members RSVP; the RSVP is a
 * soft intent recorded here, not a payment. `startsAt` drives the upcoming/past
 * split on the member side.
 */
export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    description: text('description'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    location: text('location'),
    url: text('url'),
    coverImageUrl: text('cover_image_url'),
    isPublished: boolean('is_published').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('events_starts_idx').on(t.startsAt),
    index('events_published_idx').on(t.isPublished),
  ],
);

/** One RSVP per member per event — re-RSVPing upserts, never duplicates. */
export const eventRegistrations = pgTable(
  'event_registrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    status: eventRegistrationStatusEnum('status').notNull().default('GOING'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('event_registrations_event_user_idx').on(t.eventId, t.userId)],
);

/* --------------------------------------------------------------- support */

/**
 * Member support tickets. A ticket is a thread of `supportMessages`; the
 * denormalised `lastMessageAt` lets both inboxes sort by recency without a
 * join. Status is operator-owned — a member reply reopens a RESOLVED ticket.
 */
export const supportTickets = pgTable(
  'support_tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    subject: text('subject').notNull(),
    category: text('category').notNull().default('GENERAL'),
    priority: supportTicketPriorityEnum('priority').notNull().default('NORMAL'),
    status: supportTicketStatusEnum('status').notNull().default('OPEN'),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('support_tickets_user_idx').on(t.userId),
    index('support_tickets_status_idx').on(t.status),
    index('support_tickets_last_message_idx').on(t.lastMessageAt),
  ],
);

export const supportMessages = pgTable(
  'support_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => supportTickets.id),
    authorId: uuid('author_id').references(() => users.id),
    authorRole: supportAuthorRoleEnum('author_role').notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('support_messages_ticket_idx').on(t.ticketId)],
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
