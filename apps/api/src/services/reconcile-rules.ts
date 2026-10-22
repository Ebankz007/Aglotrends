/**
 * The rules that decide whether a payment may be settled.
 *
 * These are the only sentences in the system allowed to say "this member
 * paid", so they are written to be read by a human under pressure and tested
 * like code that moves money.
 *
 * The governing idea: the GATEWAY is the only authority on whether money
 * moved, and OUR INVOICE is the only authority on what we owe for it. A
 * settlement needs both to agree.
 */

/** What the gateway's API returns for one payment request. */
export interface GatewayPaymentRecord {
  status?: string | null;
  settlement?: string | null;
  amount?: string | number | null;
  network?: string | null;
  paid_at?: string | null;
  submitted_hash?: string | null;
  reference?: string | null;
  [key: string]: unknown;
}

/** What we issued. */
export interface IssuedInvoice {
  amount_cents: number;
  network?: string | null;
  [key: string]: unknown;
}

export interface InvoiceVerdict {
  ok: boolean;
  why: string;
}

const CONFIRMED = /confirm|paid|success|complete|settled/;
const DEAD = /expire|cancel|fail/;
const HARD_FAIL = /fail|reject|declin/;

/** Did money actually move, by the gateway's own account? */
export function gatewayHasMoney(record: GatewayPaymentRecord | null | undefined): boolean {
  if (!record || typeof record !== 'object') return false;
  return Boolean(record.paid_at) || Boolean(record.submitted_hash);
}

/**
 * The gateway's own words for "the money moved".
 *
 * The order matters, and each clause has a reason:
 *
 * - A request the gateway calls FAILED/REJECTED/DECLINED is never settled
 *   automatically. The gateway has concluded the money did not arrive, and if
 *   a hash is attached anyway then something is wrong that a human must see.
 * - PAID/CONFIRMED/SETTLED is settled, plainly.
 * - EXPIRED or CANCELLED with money attached is a LATE payment: crypto has no
 *   chargeback, so the funds can land after the checkout window closed. The
 *   money is real, the member paid, and crediting it is the honest reading.
 *   (Getting this wrong strands a member who sent real money.)
 * - Anything else counts only if money is attached.
 */
export function gatewaySaysConfirmed(record: GatewayPaymentRecord | null | undefined): boolean {
  if (!record || typeof record !== 'object') return false;
  const status = String(record.status ?? '').toLowerCase();
  if (HARD_FAIL.test(status)) return false;
  if (CONFIRMED.test(status)) return true;
  if (DEAD.test(status) || /pending|unpaid|created|broadcast|awaiting/.test(status)) {
    return gatewayHasMoney(record);
  }
  return gatewayHasMoney(record);
}

/**
 * The gateway's own words for "this request is dead and unpaid".
 *
 * A dead status with money attached is not a dead invoice - it is a payment
 * that needs a human. Never release that automatically.
 */
export function gatewaySaysDead(record: GatewayPaymentRecord | null | undefined): boolean {
  if (!record || typeof record !== 'object') return false;
  const status = String(record.status ?? '').toLowerCase();
  if (!DEAD.test(status)) return false;
  return !gatewayHasMoney(record);
}

/**
 * Does the gateway's record actually match the invoice we issued?
 *
 * A settlement is a claim on real money, so it gets checked from every angle
 * we can check it from. Any mismatch means a human, not an automatic credit:
 *   - amount:   the gateway must have charged what we asked for;
 *   - network:  the money must have arrived on the chain we told the member
 *               to send it on;
 *   - settlement: 'under' means the member underpaid - a partial payment is
 *               not a registration.
 * 'over' is fine: the member sent more than asked, and we owe the member the
 * full registration, not a pro-rated slice of their overpayment.
 */
export function gatewayAgreesWithInvoice(
  record: GatewayPaymentRecord | null | undefined,
  invoice: IssuedInvoice,
): InvoiceVerdict {
  if (!record || typeof record !== 'object') return { ok: false, why: 'NO_GATEWAY_RECORD' };

  const rawAmount = record.amount;
  if (rawAmount !== undefined && rawAmount !== null && rawAmount !== '') {
    const gatewayCents = Math.round(Number(rawAmount) * 100);
    if (!Number.isFinite(gatewayCents)) return { ok: false, why: `AMOUNT_UNREADABLE(${rawAmount})` };
    if (gatewayCents !== invoice.amount_cents) {
      return { ok: false, why: `AMOUNT_MISMATCH(gateway=${rawAmount} ours=${invoice.amount_cents})` };
    }
  }

  const gatewayNetwork = String(record.network ?? '').toLowerCase();
  if (gatewayNetwork && invoice.network && gatewayNetwork !== String(invoice.network).toLowerCase()) {
    return { ok: false, why: `NETWORK_MISMATCH(gateway=${gatewayNetwork} ours=${invoice.network})` };
  }

  const settlement = String(record.settlement ?? '').toLowerCase();
  if (settlement === 'under' || settlement === 'underpaid' || settlement === 'partial') {
    return { ok: false, why: `UNDERPAID(settlement=${settlement})` };
  }

  return { ok: true, why: '-' };
}
