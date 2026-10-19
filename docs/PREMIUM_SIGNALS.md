# Premium Signals — Design

**Status: DESIGN ONLY. No code exists.** Nothing in this document is built.
Blocked on the seven decisions in §8.

**Origin.** `docs/CONCEPT.md:123` asks the question this answers:

> 3. **Signal scope** — free to all members, or gated (e.g. paid tier / active members only)?

Today the answer is "free to all members": `GET /api/signals` returns every
`PUBLISHED` row to any active member. This document designs the gated version.

---

## 1. What it is

A paid subscription tier for signals. Members pay to unlock `PREMIUM`-visibility
signals; free signals stay free. Revenue splits three ways — a referral pool, the
company, and the signal provider who authored the signals.

Deliberately **not** in scope: custody, copy execution, or anything that touches
a member's broker account. This is a content-access product. See §9.

---

## 2. Money model

House rules, inherited from the existing engine — do not invent a second set:

- **Integer cents everywhere.** No floats, ever. `priceCents`, `amountCents`.
- **Basis points for splits.** 1% = 100 bps.
- **Reuse the existing splitter.** `packages/engine/src/allocation.ts` already
  exposes `splitByBps` and is covered by 11 tests. A second splitter is a second
  set of rounding bugs.

```ts
export const SUBSCRIPTION_SPLIT_BPS = {
  referralPool: 3000, // 30%
  company: 3000,      // 30%
  provider: 4000,     // 40%
} as const;
```

**The invariant that matters:** the three buckets must sum to the gross, exactly,
for every price. `splitByBps` must allocate the rounding remainder to a
deterministic bucket (the last one) so a $49.99 plan never loses or invents a
cent. Assert this in the engine test suite across a spread of prices, not just
one.

Every split writes **append-only ledger entries** — the same discipline the
registration fee split and profit settlements already follow. A split that
mutates a balance without a ledger row is a bug, not an optimisation.

---

## 3. Data model

Additive migration only. Nothing here drops or rewrites a column.

### 3a. `signals.visibility` + chart assets

```ts
export const signalVisibilityEnum = pgEnum('signal_visibility', ['FREE', 'PREMIUM']);

// added to the existing signals table
visibility: signalVisibilityEnum('visibility').notNull().default('FREE'),
chartImageUrl: text, // optional upload URL for chart screenshot / setup visual
chartLink: text,     // optional external chart link (TradingView, etc.)
```

`default('FREE')` means every existing row keeps working and every existing
reader keeps seeing what it saw. The migration is safe on live data.

Chart assets are optional. When present they are shown in the virtual view of the signal setup. Upload is provider-only, via admin UI.

### 3b. `subscription_plans`

| column | type | notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `providerId` | uuid → users | who authors the signals this plan unlocks |
| `name` | text | e.g. "Monthly" |
| `priceCents` | integer | never a float |
| `durationDays` | integer | 30 / 180 / 365 |
| `active` | boolean | soft-disable without deleting history |
| `createdAt` | timestamp | |

### 3c. `user_subscriptions`

| column | type | notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `userId` | uuid → users | |
| `planId` | uuid → subscription_plans | snapshot price at purchase |
| `priceCents` | integer | **snapshot** — a later plan edit must not rewrite history |
| `status` | enum | `ACTIVE` / `EXPIRED` / `CANCELLED` |
| `startsAt` / `expiresAt` | timestamp | |
| `paymentId` | uuid → payments | the money that bought it |
| `createdAt` | timestamp | |

Indexes: `(userId, status)` for the access check on every signal read, and
`(expiresAt)` for the expiry sweep.

**Snapshot the price on the subscription row.** Reading the current plan price
when rendering history is the classic way a "what did I pay?" question becomes
unanswerable.

---

## 4. Access control

**The server decides. The client is never trusted.** A `locked: true` flag on a
payload that still contains `entryPrice` is not access control — it is a
suggestion, and anyone with devtools can read it.

- `GET /api/signals` — returns `FREE` rows always; returns `PREMIUM` rows only
  when the caller has an `ACTIVE`, unexpired subscription.
- `GET /api/signals/:id` — the same rule, applied per row.
- A locked row is returned as **metadata only** (title, instrument, direction,
  author, publishedAt) with `locked: true`. The price levels are **absent from
  the response body**, not merely hidden in the UI.

### A bug this work must fix

`apps/api/src/routes/signals.ts:24` currently has **no `status` filter** on the
by-id route. Any active member who knows (or guesses) a signal UUID can read a
**DRAFT** signal — content its author has not published. Low severity today
(UUIDs are unguessable and never listed to members), but it is the exact seam
this feature has to get right. Fix: add `eq(signals.status, 'PUBLISHED')` or an
author-or-admin check.

---

## 5. API surface

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /api/subscriptions/plans` | member | active plans |
| `POST /api/subscriptions/checkout` | member | create a payment via the existing rail; returns `checkout_url` |
| `GET /api/subscriptions/me` | member | current subscription + expiry |
| `GET /api/admin/subscriptions` | staff | subscriber list, revenue |
| `POST /api/admin/subscription-plans` | staff | create/edit a plan |

Checkout **reuses the existing Pay2Crypto rail** (`services/payment-service.ts`)
rather than growing a second payment path. A subscription is a `Payment` with a
new `purpose`, and the existing webhook (`POST /api/webhooks/pay2crypto`,
fails-closed on a missing secret) is what marks it paid.

**Activation must be transactional.** Marking the payment paid, inserting the
`user_subscriptions` row, and writing the three ledger entries happen in one
transaction or not at all. A paid-but-not-activated member is a support ticket;
an activated-but-unpaid member is a loss.

---

## 6. Web surface

- `/signals` — `PREMIUM` rows render as locked cards (title + instrument visible,
  levels replaced by a lock affordance and an upgrade CTA). Teaser shows chart visual if provider uploaded `chartImageUrl` / `chartLink`.
- `/subscriptions` — plan list, current status, expiry date, renew.
- Admin → Subscriptions — plans, subscribers, revenue split view.
- Admin → Signals — provider can upload chart image and set chart link for virtual view of signal setup.

Palette and components follow the existing dark-navy system
(`apps/web/app/globals.css`). No new design language.

---

## 7. Notifications

Publishing a `PREMIUM` signal must fan out **only to members who can actually
read it**. The existing fan-out (`notifications/index.ts`) broadcasts to a
segment; a premium broadcast needs the recipient list filtered by active
subscription *before* dispatch — otherwise the email becomes the leak that the
API gate was built to prevent.

Resolve channel config once per broadcast, not per recipient (existing rule).

---

## 8. Open decisions — these block the build

**DECISIONS RECORDED 2026-10-19**

1. **Split.** 30/30/40 is final. Referral-pool 30% **compresses up the tree** the way the registration bonus does.
2. **Provider payout timing.** Provider 40% vests **at purchase**. No refunds or chargebacks. Signal performance is shown before subscribe. Provider 40% is credited to his client wallet.
3. **Referral pool distribution.** TBD — need distribution rule: pro-rata by active referrals? Equal? Direct referrers only? Minimum threshold?
4. **Plan economics.** Platform does **not** set prices. Each provider sets their own price for Monthly / 6-Month / Yearly.
5. **Access model.** Teaser: title and instrument visible, levels locked.
6. **Expiry behaviour.** Unlocked retroactively on renewal. Lapse behaviour: TBD — hard cut / grace / auto-renew?
7. **Free tier definition.** No free signals by default. Provider can opt to make their signal service free.

**Open items remaining:**
- 3. Referral pool distribution rule + minimum threshold
- 6. Lapse behaviour: hard cut / grace period / auto-renew?

---

## 9. Non-goals

- **No custody, no copy execution.** This does not touch broker accounts.
- **No provider self-service payouts** in v1 — payouts stay admin-driven, as
  they are today.
- **No proration or mid-period refunds** in v1.
- **No auto-renew** unless decision 6 says so.

---

## 10. Risks

- **Regulatory posture.** Selling signal access moves the product toward
  investment advice. The current posture is a software/education layer with no
  licence. Charging for signals is a different fact pattern from giving them
  away — this should be a conscious decision, not a side effect of a feature.
- **Recruitment-funded compensation.** A referral pool funded by subscriptions
  is closer to the R1/R2 question already open in the compensation plan than the
  registration-fee pool is. Worth deciding deliberately.
- **The leak is the email.** Gating the API while broadcasting to everyone is a
  silent failure that looks like success. See §7.

---

## 11. Build order

1. **Engine** — `SUBSCRIPTION_SPLIT_BPS`, split + remainder tests, expiry maths.
2. **Schema** — additive migration: enum, column, two tables, indexes.
3. **API** — access gate (incl. the `signals.ts:24` fix), plans, checkout,
   activation transaction, admin routes.
4. **Web** — locked cards, subscriptions page, admin area.
5. **Notifications** — filtered fan-out.

Each step lands with its own tests. The access gate (step 3) is the one that
must not ship without a test proving a non-subscriber cannot read a `PREMIUM`
signal's levels.
