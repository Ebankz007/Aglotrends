import { and, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { REGISTRATION_FEE_CENTS } from '@aglotrends/engine';
import { config } from '../config.js';
import { db, schema } from '../db.js';
import { ApiError } from '../lib/errors.js';
import { logger } from '../logger.js';
import { recordPlatformFee } from './platform-fees.js';
import { processRegistration } from './registration.js';
import { isGatewayMock, resolveGatewaySettings, resolvePlatformFeeSettings, servedRailList } from './settings.js';
import { creditWallet } from './wallet.js';

/** §1 — the one-time membership fee ($20.00), paid by every new member. */
export const FEE_CENTS = REGISTRATION_FEE_CENTS;

const MAX_PAYMENT_CENTS = 100_000_000; // $1,000,000

export const PURPOSES = ['REGISTRATION', 'DEPOSIT'] as const;
export type PaymentPurpose = (typeof PURPOSES)[number];

/**
 * The USDT rails we accept. The client may PICK a rail, but the server owns
 * the list: anything outside this set is rejected, not silently coerced.
 */
export const ALLOWED_NETWORKS = ['trc20', 'erc20', 'bep20'] as const;
export type PaymentNetwork = (typeof ALLOWED_NETWORKS)[number];

/**
 * The rails the merchant account can actually SERVE.
 *
 * Offering a rail the gateway has no receiving address for is a broken
 * product: the member picks ERC20, the gateway refuses (422, "no USDT
 * receiving address on Ethereum"), and their registration fails. The account
 * decides which rails exist, so the account decides the list — the server
 * owns it, and the client renders exactly what the server says.
 */
export function servedNetworks(): string[] {
  return servedRailList();
}

/**
 * Validate a client-chosen rail. Defaults to the first served rail when
 * omitted or blank, and rejects a rail the account cannot serve.
 */
export function parseNetwork(
  value: string | null | undefined,
  served: readonly string[] = servedNetworks(),
): PaymentNetwork {
  const fallback = served[0] ?? 'trc20';
  const raw = (value ?? '').trim().toLowerCase() || fallback;
  if (!(served as readonly string[]).includes(raw)) {
    throw ApiError.badRequest(
      `Unsupported payment network: ${raw}. Available: ${served.join(', ')}`,
      'INVALID_NETWORK',
    );
  }
  return raw as PaymentNetwork;
}

export interface PaymentRequestBody {
  amount: string;
  asset: string;
  network: string;
  reference: string;
  description: string;
  return_url: string;
}

/**
 * Build the exact `POST /v1/payment-requests` body.
 * Amount is a 2-decimal STRING, not a number — pinned from the merchant
 * integration snippet. Pure so the contract can be unit-tested offline.
 */
export function buildPaymentRequestBody(input: {
  paymentRef: string;
  amountCents: number;
  purpose: PaymentPurpose;
  returnUrl: string;
  /** Operator-configured rail; defaults keep the pinned USDT/TRC20 contract. */
  asset?: string;
  network?: string;
}): PaymentRequestBody {
  const dollars = (input.amountCents / 100).toFixed(2);
  const description =
    input.purpose === 'REGISTRATION'
      ? `Aglotrends registration fee — $${dollars}`
      : `Aglotrends wallet deposit — $${dollars}`;
  return {
    amount: dollars,
    asset: input.asset ?? 'USDT',
    network: input.network ?? 'trc20',
    reference: input.paymentRef,
    description,
    return_url: input.returnUrl,
  };
}

/**
 * Parse a `POST /v1/payment-requests` success body. The checkout link is
 * `checkout_url` and the gateway-side id is `token`; neighbouring names are
 * accepted so a gateway rename fails loudly here (502) rather than storing a
 * row with no way to pay. Pure — unit-pinned against the real payload shape.
 */
export function parsePaymentRequestResponse(data: unknown): {
  paymentUrl: string;
  gatewayTxid: string | null;
} {
  const body = (data ?? {}) as Record<string, unknown>;
  const url =
    typeof body.checkout_url === 'string'
      ? body.checkout_url
      : typeof body.payment_url === 'string'
        ? body.payment_url
        : typeof body.url === 'string'
          ? body.url
          : null;
  if (body.success === false || !url) {
    throw ApiError.badRequest(
      'Pay2Crypto returned an invalid payment-request response',
      'PAYMENT_GATEWAY_ERROR',
    );
  }
  const txid = [body.token, body.txid, body.unique_id, body.id].find(
    (v) => typeof v === 'string',
  ) as string | undefined;
  return { paymentUrl: url, gatewayTxid: txid ?? null };
}

/**
 * The review-mode checkout URL.
 *
 * It MUST live on our own origin. An earlier version pointed mock invoices at
 * the gateway's real hosted checkout (`checkout.pay2crypto.com/?txid=mock-…`),
 * which produced a third-party "Payment link not found" page: the member was
 * told a merchant error while the real cause was our own test rail. A mock
 * invoice now goes to a local page that says exactly what it is.
 */
export function buildMockCheckoutUrl(input: {
  paymentRef: string;
  amountCents: number;
  purpose: PaymentPurpose;
  network?: string;
  gatewayTxid: string;
}): string {
  const base = config.APP_URL.replace(/\/$/, '');
  const params = new URLSearchParams({
    ref: input.paymentRef,
    // Named `test_txid`, not `txid`: the fabricated-URL detector keys on
    // `txid=mock-`, and the local test surface must not be mistaken for a
    // dead link (it is a live, reusable URL).
    test_txid: input.gatewayTxid,
    amount: (input.amountCents / 100).toFixed(2),
    asset: 'USDT',
    network: input.network || 'trc20',
    purpose: input.purpose,
  });
  return `${base}/wallet/checkout/mock?${params.toString()}`;
}

/**
 * True for a checkout URL that was fabricated by mock mode. Such a URL is
 * never payable, so it must never be handed to a member — in mock mode or in
 * live mode. The marker is the `mock-` transaction id / `mock=1` flag.
 */
export function isFabricatedCheckoutUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /(^|[?&])txid=mock-/.test(url) || /[?&]mock=1(&|$)/.test(url);
}

/**
 * Call Pay2Crypto (or mock mode) for a checkout URL, without touching the
 * ledger. Shared by creation and by checkout refresh so both paths speak the
 * exact same contract.
 */
async function requestGatewayCheckout(input: {
  paymentRef: string;
  amountCents: number;
  purpose: PaymentPurpose;
  network?: string;
}): Promise<{ gatewayTxid: string | null; paymentUrl: string }> {
  // Gateway config resolves from the environment only (env-only contract).
  const gw = await resolveGatewaySettings();
  if (isGatewayMock(gw)) {
    const gatewayTxid = `mock-${randomUUID()}`;
    return {
      gatewayTxid,
      paymentUrl: buildMockCheckoutUrl({
        paymentRef: input.paymentRef,
        amountCents: input.amountCents,
        purpose: input.purpose,
        network: input.network,
        gatewayTxid,
      }),
    };
  }
  const body = buildPaymentRequestBody({
    paymentRef: input.paymentRef,
    amountCents: input.amountCents,
    purpose: input.purpose,
    returnUrl: `${config.APP_URL.replace(/\/$/, '')}/wallet`,
    asset: gw.asset,
    network: input.network || gw.network,
  });
  const res = await fetch(`${gw.apiUrl}/v1/payment-requests`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${gw.token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    // Surface the gateway's own message — it is the actionable part.
    throw new ApiError(
      502,
      `Pay2Crypto payment request failed: ${res.status} ${text.slice(0, 200)}`,
      'PAYMENT_GATEWAY_ERROR',
    );
  }
  const parsed = parsePaymentRequestResponse(await res.json());
  return { gatewayTxid: parsed.gatewayTxid, paymentUrl: parsed.paymentUrl };
}

/**
 * Create an invoice for a member.
 *
 * REGISTRATION is the fixed $20 compensation base PLUS the platform transaction
 * fee — $23.00 at the default $3.00 fee. DEPOSIT is the member's requested
 * amount plus the same fee. The fee is platform revenue, recorded separately on
 * confirmation; the compensation engine only ever sees the net base.
 */
export async function createPayment(
  userId: string,
  purpose: PaymentPurpose,
  amountCents?: number,
  network?: string,
): Promise<typeof schema.payments.$inferSelect> {
  const netCents = purpose === 'REGISTRATION' ? FEE_CENTS : amountCents;
  if (
    purpose === 'DEPOSIT' &&
    (!Number.isInteger(netCents) || (netCents as number) <= 0 || (netCents as number) > MAX_PAYMENT_CENTS)
  ) {
    throw ApiError.badRequest(
      'Deposit amount must be a positive integer up to $1,000,000',
      'INVALID_AMOUNT',
    );
  }

  const feeSettings = await resolvePlatformFeeSettings();
  const feeCents = feeSettings.enabled ? feeSettings.amountCents : 0;
  const grossCents = (netCents as number) + feeCents;

  const paymentRef = `AGL-${randomUUID()}`;
  const selectedNetwork = parseNetwork(network);
  const { gatewayTxid, paymentUrl } = await requestGatewayCheckout({
    paymentRef,
    amountCents: grossCents,
    purpose,
    network: selectedNetwork,
  });

  const [payment] = await db
    .insert(schema.payments)
    .values({
      userId,
      purpose,
      amountCents: grossCents,
      platformFeeCents: feeCents,
      network: selectedNetwork,
      paymentRef,
      gatewayTxid,
      paymentUrl,
      status: 'PENDING',
    })
    .returning();
  if (!payment) throw new Error('createPayment: insert failed');
  return payment;
}

/**
 * Checkout refresh. Pay2Crypto requests expire after 1 hour, so a stored URL
 * older than CHECKOUT_FRESH_MINUTES is dead. A refresh issues a brand-new
 * gateway request (new reference) and updates the SAME row — no duplicate
 * PENDING rows, and the webhook join key stays consistent because the row it
 * joins on is rewritten, not forked.
 */
export const CHECKOUT_FRESH_MINUTES = 50;

/**
 * Can the stored URL be handed to the member as-is?
 *
 * Three ways it can be stale-but-tempting:
 *  - it was fabricated by mock mode (never payable, in any mode);
 *  - it is older than the gateway's expiry margin;
 *  - it points off-origin while we are in mock mode (a leftover live-gateway
 *    link would drop the member into a real payment page during a review).
 */
async function canReuseCheckoutUrl(paymentUrl: string | null, ageMs: number): Promise<boolean> {
  if (!paymentUrl) return false;
  if (isFabricatedCheckoutUrl(paymentUrl)) return false;
  if (ageMs >= CHECKOUT_FRESH_MINUTES * 60_000) return false;
  const gw = await resolveGatewaySettings();
  if (!isGatewayMock(gw)) return true;
  const origin = config.APP_URL.replace(/\/$/, '');
  return paymentUrl.startsWith(origin);
}

export async function refreshCheckoutUrl(
  userId: string,
  paymentId: string,
): Promise<{ paymentUrl: string; refreshed: boolean }> {
  const [payment] = await db
    .select()
    .from(schema.payments)
    .where(and(eq(schema.payments.id, paymentId), eq(schema.payments.userId, userId)))
    .limit(1);
  if (!payment) throw ApiError.notFound('Payment not found');
  if (payment.status !== 'PENDING') {
    throw ApiError.conflict('Only a pending payment can be checked out', 'PAYMENT_NOT_PENDING');
  }
  const ageMs = Date.now() - new Date(payment.createdAt).getTime();
  if (await canReuseCheckoutUrl(payment.paymentUrl, ageMs)) {
    return { paymentUrl: payment.paymentUrl as string, refreshed: false };
  }
  const paymentRef = `AGL-${randomUUID()}`;
  const { gatewayTxid, paymentUrl } = await requestGatewayCheckout({
    paymentRef,
    amountCents: payment.amountCents,
    purpose: payment.purpose as PaymentPurpose,
    network: payment.network,
  });
  await db
    .update(schema.payments)
    .set({ paymentRef, gatewayTxid, paymentUrl })
    .where(eq(schema.payments.id, payment.id));
  return { paymentUrl, refreshed: true };
}

/** The member's own payment history, newest first. */
export async function listMyPayments(userId: string) {
  const payments = await db
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.userId, userId))
    .orderBy(desc(schema.payments.createdAt));
  // Never serve a fabricated link: the member would click it and land on a
  // gateway error page that looks like a merchant fault.
  return payments.map((p) => ({
    ...p,
    paymentUrl: isFabricatedCheckoutUrl(p.paymentUrl) ? null : p.paymentUrl,
  }));
}

/**
 * Run a member's compensation exactly once. Safe to call repeatedly — the
 * registration row is the idempotency token, and `processRegistration` locks
 * the user row so two concurrent webhooks cannot both pay out.
 *
 * Returns true when this call actually performed the distribution.
 */
export async function ensureRegistrationProcessed(userId: string): Promise<boolean> {
  const [existing] = await db
    .select({ id: schema.registrations.id })
    .from(schema.registrations)
    .where(eq(schema.registrations.userId, userId));
  if (existing) return false;
  await processRegistration(userId);
  return true;
}

/**
 * Webhook payload shape, learned from the LIVE gateway.
 *
 * The create response (verified against the live rail) is:
 *   { token, status, settlement, amount, asset, network, network_mode, mode,
 *     pay_address, reference, description, checkout_url, submitted_hash,
 *     expires_at, created_at, paid_at }
 *
 * The join key the gateway echoes is `reference` — NOT `payment_ref`, which is
 * what the old handler read. Accepting one name and not the other means a real
 * payment 400s at the door: the member pays, the ledger never credits, and
 * the gateway eventually stops retrying. So the reader below accepts every
 * name the gateway plausibly uses, in priority order.
 */
const WEBHOOK_REF_KEYS = ['payment_ref', 'reference', 'paymentRef', 'ref'] as const;
const WEBHOOK_STATUS_KEYS = ['status', 'state', 'payment_status'] as const;
const WEBHOOK_AMOUNT_KEYS = ['payment_amount', 'amount', 'value'] as const;
const WEBHOOK_TX_KEYS = [
  'tx_hash',
  'submitted_hash',
  'txHash',
  'txid',
  'transaction_hash',
  'tx_id',
] as const;

/** Statuses that mean "the money moved". */
const SETTLED_TOKENS = new Set([
  'confirmed',
  'paid',
  'success',
  'succeeded',
  'complete',
  'completed',
  'settled',
  'finished',
]);

/** Statuses that mean "not yet" — they veto a token that looks settled. */
const UNSETTLED_TOKENS = new Set([
  'unpaid',
  'unconfirmed',
  'incomplete',
  'invalid',
  'pending',
  'failed',
  'error',
  'reversed',
  'refund',
  'refunded',
  'declined',
  'rejected',
  'expired',
  'canceled',
  'cancelled',
  'processing',
  'broadcasting',
  'confirming',
  'awaiting',
  'created',
  'not',
  'never',
]);

export interface WebhookEvent {
  paymentRef?: string;
  status?: string;
  amount?: number;
  txHash?: string;
  /** True only when the payload says the money actually moved. */
  settled: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function firstString(
  sources: (Record<string, unknown> | undefined)[],
  keys: readonly string[],
): string | undefined {
  for (const src of sources) {
    if (!src) continue;
    for (const key of keys) {
      const raw = src[key];
      if (typeof raw === 'string' && raw.trim()) return raw.trim();
    }
  }
  return undefined;
}

function firstNumber(
  sources: (Record<string, unknown> | undefined)[],
  keys: readonly string[],
): number | undefined {
  for (const src of sources) {
    if (!src) continue;
    for (const key of keys) {
      const raw = src[key];
      if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
      if (typeof raw === 'string' && raw.trim() !== '') {
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) return parsed;
      }
    }
  }
  return undefined;
}

/** "payment_confirmed" -> {payment, confirmed}; "unpaid" -> {unpaid}. */
function statusTokens(status: string): string[] {
  return status
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Read a gateway webhook into a normalised event.
 *
 * Deliberately fail-CLOSED on settlement: a payload that carries a reference
 * but no settled status is acknowledged and NOT credited. The old handler
 * treated a missing status as "paid", which would hand a wallet balance for
 * a mere "payment created" ping — free money, at the merchant's expense.
 */
export function extractWebhookEvent(payload: unknown): WebhookEvent {
  const body = asRecord(payload);
  if (!body) return { settled: false };

  const nested = asRecord(body.data) ?? asRecord(body.payment);
  const sources = [body, nested];

  const paymentRef = firstString(sources, WEBHOOK_REF_KEYS);

  // The status may sit at the top level or inside a `settlement` object — the
  // live create response carries `settlement: null` alongside `status`.
  const settlement = asRecord(body.settlement);
  const statusCandidates = [
    firstString(sources, WEBHOOK_STATUS_KEYS),
    firstString([settlement], WEBHOOK_STATUS_KEYS),
  ].filter((s): s is string => Boolean(s));
  const status = statusCandidates[0];

  let settled = false;
  for (const candidate of statusCandidates) {
    const tokens = statusTokens(candidate);
    if (tokens.some((t) => UNSETTLED_TOKENS.has(t))) continue;
    if (tokens.some((t) => SETTLED_TOKENS.has(t))) {
      settled = true;
      break;
    }
  }

  // A non-null `paid_at` is an unambiguous settlement signal in the live shape.
  const paidAt = firstString([body], ['paid_at', 'paidAt']);
  if (paidAt) settled = true;

  return {
    paymentRef,
    status,
    amount: firstNumber(sources, WEBHOOK_AMOUNT_KEYS),
    txHash: firstString(sources, WEBHOOK_TX_KEYS),
    settled,
  };
}

/**
 * Pay2Crypto confirmation webhook. Idempotent: re-delivery is a no-op for the
 * ledger, but a REGISTRATION payment always re-attempts compensation so a
 * first attempt that failed after the PAID write heals on gateway retry.
 */
export async function handlePaymentWebhook(payload: unknown): Promise<{
  applied: boolean;
  purpose: string;
  userId: string;
  compensationRun: boolean;
}> {
  const event = extractWebhookEvent(payload);
  const paymentRef = event.paymentRef;
  const txHash = event.txHash;

  if (!paymentRef) throw ApiError.badRequest('Missing payment_ref', 'INVALID_WEBHOOK');

  // Only a settled event moves money. Anything else (created, pending,
  // broadcasting) is acknowledged and dropped.
  if (!event.settled) {
    logger.info(
      { paymentRef, status: event.status },
      'webhook received but not settled - acknowledged without applying',
    );
    return {
      applied: false,
      purpose: 'UNKNOWN',
      userId: '',
      compensationRun: false,
    };
  }

  const [payment] = await db
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.paymentRef, paymentRef))
    .limit(1);
  if (!payment) throw ApiError.notFound('Unknown payment_ref');

  const alreadyPaid = payment.status === 'PAID';

  if (!alreadyPaid) {
    // Amount verification when the gateway echoes it back. The sandbox and
    // the live rail both echo a STRING ("1" for a $1 request), so accept
    // numeric strings too — a type-narrow check here would silently skip
    // verification entirely.
    const echoed = event.amount;
    if (echoed !== undefined && Number.isFinite(echoed)) {
      const expected = payment.amountCents / 100;
      // Half-cent tolerance: float noise is ~1e-9, anything at or above this
      // is a real discrepancy, not dust.
      if (Math.abs(echoed - expected) >= 0.005) {
        throw ApiError.badRequest(
          `Payment amount ${event.amount} != expected ${expected}`,
          'AMOUNT_MISMATCH',
        );
      }
    }

    const now = new Date();
    const feeCents = payment.platformFeeCents ?? 0;
    const netCents = payment.amountCents - feeCents;

    await db.transaction(async (tx) => {
      await tx
        .update(schema.payments)
        .set({ status: 'PAID', paidAt: now, txHash: txHash ?? null })
        .where(eq(schema.payments.id, payment.id));

      // The platform fee is recorded in the SAME transaction as the PAID write,
      // so the operator's ledger can never miss a fee that was actually charged.
      // `recordPlatformFee` is idempotent on payment_id, so a webhook replay
      // cannot double-count it.
      if (feeCents > 0) {
        const feeSettings = await resolvePlatformFeeSettings();
        await recordPlatformFee(tx, {
          userId: payment.userId,
          paymentId: payment.id,
          purpose: payment.purpose as PaymentPurpose,
          amountCents: feeCents,
          currency: payment.currency,
          walletAddress: feeSettings.walletAddress,
          network: feeSettings.network,
          asset: feeSettings.asset,
        });
      }

      if (payment.purpose === 'DEPOSIT' && netCents > 0) {
        // Only the NET is credited — the fee is not the member's money.
        await creditWallet(tx, {
          userId: payment.userId,
          amountCents: netCents,
          type: 'CRYPTO_DEPOSIT',
          refType: 'payment',
          refId: payment.id,
          description: 'Crypto deposit (USDT)',
        });
      }
    });
  }

  // Compensation is its own transaction, and is re-attempted even when the
  // payment was already PAID — that is what makes webhook retries healing.
  let compensationRun = false;
  if (payment.purpose === 'REGISTRATION') {
    compensationRun = await ensureRegistrationProcessed(payment.userId);
    if (compensationRun) {
      logger.info(
        { userId: payment.userId, paymentRef },
        'registration compensation distributed after payment',
      );
    }
  }

  return {
    applied: !alreadyPaid,
    purpose: payment.purpose,
    userId: payment.userId,
    compensationRun,
  };
}

/* ------------------------------------------------------ admin settlement */

/**
 * Settle an invoice off-rail — cash, a bank transfer, or a webhook the gateway
 * never delivered. It routes through the SAME confirmation path as the live
 * webhook, so idempotency, wallet crediting, and registration compensation
 * behave identically: an operator cannot pay a member twice by clicking twice.
 *
 * No `payment_amount` is passed, so the amount check is skipped by design —
 * the operator is vouching that the money arrived.
 */
export async function confirmPaymentManually(
  paymentId: string,
  txHash?: string | null,
): Promise<{ applied: boolean; purpose: string; userId: string; compensationRun: boolean }> {
  const [payment] = await db
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.id, paymentId))
    .limit(1);
  if (!payment) throw ApiError.notFound('Payment not found');
  if (payment.status === 'FAILED') {
    throw ApiError.conflict('A failed payment cannot be confirmed', 'PAYMENT_FAILED');
  }
  return handlePaymentWebhook({
    payment_ref: payment.paymentRef,
    status: 'confirmed',
    ...(txHash ? { tx_hash: txHash } : {}),
  });
}

/**
 * Expire a stale PENDING invoice so the member is no longer blocked by
 * `PENDING_PAYMENT_EXISTS` from starting a fresh one. No ledger effect — the
 * member was never charged.
 */
export async function cancelPendingPayment(
  paymentId: string,
): Promise<typeof schema.payments.$inferSelect> {
  const [payment] = await db
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.id, paymentId))
    .limit(1);
  if (!payment) throw ApiError.notFound('Payment not found');
  if (payment.status !== 'PENDING') {
    throw ApiError.conflict('Only a pending payment can be cancelled', 'PAYMENT_NOT_PENDING');
  }
  const [row] = await db
    .update(schema.payments)
    .set({ status: 'EXPIRED' })
    .where(eq(schema.payments.id, paymentId))
    .returning();
  if (!row) throw new Error('cancelPendingPayment: update failed');
  return row;
}
