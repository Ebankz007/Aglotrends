import { and, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { REGISTRATION_FEE_CENTS } from '@aglotrends/engine';
import { config, isPaymentMockMode } from '../config.js';
import { db, schema } from '../db.js';
import { ApiError } from '../lib/errors.js';
import { logger } from '../logger.js';
import { processRegistration } from './registration.js';
import { creditWallet } from './wallet.js';

/** §1 — the one-time membership fee ($20.00), paid by every new member. */
export const FEE_CENTS = REGISTRATION_FEE_CENTS;

const MAX_PAYMENT_CENTS = 100_000_000; // $1,000,000

export const PURPOSES = ['REGISTRATION', 'DEPOSIT'] as const;
export type PaymentPurpose = (typeof PURPOSES)[number];

export interface PaymentRequestBody {
  amount: string;
  asset: 'USDT';
  network: 'trc20';
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
}): PaymentRequestBody {
  const dollars = (input.amountCents / 100).toFixed(2);
  const description =
    input.purpose === 'REGISTRATION'
      ? `Aglotrends registration fee — $${dollars}`
      : `Aglotrends wallet deposit — $${dollars}`;
  return {
    amount: dollars,
    asset: 'USDT',
    network: 'trc20',
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
 * Call Pay2Crypto (or mock mode) for a checkout URL, without touching the
 * ledger. Shared by creation and by checkout refresh so both paths speak the
 * exact same contract.
 */
async function requestGatewayCheckout(input: {
  paymentRef: string;
  amountCents: number;
  purpose: PaymentPurpose;
}): Promise<{ gatewayTxid: string | null; paymentUrl: string }> {
  if (isPaymentMockMode()) {
    const gatewayTxid = `mock-${randomUUID()}`;
    return {
      gatewayTxid,
      paymentUrl: `https://checkout.pay2crypto.com/?txid=${gatewayTxid}&mock=1`,
    };
  }
  const body = buildPaymentRequestBody({
    paymentRef: input.paymentRef,
    amountCents: input.amountCents,
    purpose: input.purpose,
    returnUrl: `${config.APP_URL.replace(/\/$/, '')}/wallet`,
  });
  const res = await fetch(`${config.PAY2CRYPTO_API_URL}/v1/payment-requests`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.PAY2CRYPTO_TOKEN}`,
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

/** Create an invoice for a member. REGISTRATION is always the fixed $20 fee. */
export async function createPayment(
  userId: string,
  purpose: PaymentPurpose,
  amountCents?: number,
): Promise<typeof schema.payments.$inferSelect> {
  const cents = purpose === 'REGISTRATION' ? FEE_CENTS : amountCents;
  if (
    purpose === 'DEPOSIT' &&
    (!Number.isInteger(cents) || (cents as number) <= 0 || (cents as number) > MAX_PAYMENT_CENTS)
  ) {
    throw ApiError.badRequest(
      'Deposit amount must be a positive integer up to $1,000,000',
      'INVALID_AMOUNT',
    );
  }

  const paymentRef = `AGL-${randomUUID()}`;
  const { gatewayTxid, paymentUrl } = await requestGatewayCheckout({
    paymentRef,
    amountCents: cents as number,
    purpose,
  });

  const [payment] = await db
    .insert(schema.payments)
    .values({
      userId,
      purpose,
      amountCents: cents as number,
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
  if (payment.paymentUrl && ageMs < CHECKOUT_FRESH_MINUTES * 60_000) {
    return { paymentUrl: payment.paymentUrl, refreshed: false };
  }
  const paymentRef = `AGL-${randomUUID()}`;
  const { gatewayTxid, paymentUrl } = await requestGatewayCheckout({
    paymentRef,
    amountCents: payment.amountCents,
    purpose: payment.purpose as PaymentPurpose,
  });
  await db
    .update(schema.payments)
    .set({ paymentRef, gatewayTxid, paymentUrl })
    .where(eq(schema.payments.id, payment.id));
  return { paymentUrl, refreshed: true };
}

/** The member's own payment history, newest first. */
export async function listMyPayments(userId: string) {
  return db
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.userId, userId))
    .orderBy(desc(schema.payments.createdAt));
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
 * Pay2Crypto confirmation webhook. Idempotent: re-delivery is a no-op for the
 * ledger, but a REGISTRATION payment always re-attempts compensation so a
 * first attempt that failed after the PAID write heals on gateway retry.
 *
 * Extraction is deliberately defensive — `payment_ref` is the join key the
 * gateway echoes back.
 */
export async function handlePaymentWebhook(payload: unknown): Promise<{
  applied: boolean;
  purpose: string;
  userId: string;
  compensationRun: boolean;
}> {
  const body = (payload ?? {}) as Record<string, unknown>;
  const paymentRef = typeof body.payment_ref === 'string' ? body.payment_ref : undefined;
  const txHash = typeof body.tx_hash === 'string' ? body.tx_hash : undefined;
  const status = typeof body.status === 'string' ? body.status : undefined;

  if (!paymentRef) throw ApiError.badRequest('Missing payment_ref', 'INVALID_WEBHOOK');

  // Non-final statuses (broadcast, pending, …) are acknowledged, not applied.
  if (status && !['confirmed', 'paid', 'success', 'completed'].includes(status.toLowerCase())) {
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
    // Amount verification when the gateway echoes it back. The sandbox echoes
    // a STRING ("1" for a $1 request), so accept numeric strings too — a
    // type-narrow check here would silently skip verification entirely.
    const echoed =
      typeof body.payment_amount === 'number'
        ? body.payment_amount
        : typeof body.payment_amount === 'string'
          ? Number(body.payment_amount)
          : NaN;
    if (Number.isFinite(echoed)) {
      const expected = payment.amountCents / 100;
      // Half-cent tolerance: float noise is ~1e-9, anything at or above this
      // is a real discrepancy, not dust.
      if (Math.abs(echoed - expected) >= 0.005) {
        throw ApiError.badRequest(
          `Payment amount ${body.payment_amount} != expected ${expected}`,
          'AMOUNT_MISMATCH',
        );
      }
    }

    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(schema.payments)
        .set({ status: 'PAID', paidAt: now, txHash: txHash ?? null })
        .where(eq(schema.payments.id, payment.id));

      if (payment.purpose === 'DEPOSIT') {
        await creditWallet(tx, {
          userId: payment.userId,
          amountCents: payment.amountCents,
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
