import { describe, expect, it } from 'vitest';
import {
  ALLOWED_NETWORKS,
  FEE_CENTS,
  buildMockCheckoutUrl,
  buildPaymentRequestBody,
  extractWebhookEvent,
  isFabricatedCheckoutUrl,
  parseNetwork,
  parsePaymentRequestResponse,
} from '../src/services/payment-service.js';
import { ApiError } from '../src/lib/errors.js';
import { config } from '../src/config.js';

/**
 * The Pay2Crypto contract, pinned offline. These two functions are the only
 * place that speaks the gateway's wire format — if Pay2Crypto renames a field,
 * these tests are what fails before a row is ever stored with no way to pay.
 */
describe('FEE_CENTS', () => {
  it('is the §1 $20 registration fee', () => {
    expect(FEE_CENTS).toBe(2000);
  });
});

describe('buildPaymentRequestBody', () => {
  const base = { paymentRef: 'AGL-abc', amountCents: 2000, returnUrl: 'http://x/wallet' };

  it('sends amount as a 2-decimal STRING, not a number', () => {
    const body = buildPaymentRequestBody({ ...base, purpose: 'REGISTRATION' });
    expect(body.amount).toBe('20.00');
    expect(typeof body.amount).toBe('string');
  });

  it('pads sub-cent values correctly', () => {
    expect(buildPaymentRequestBody({ ...base, amountCents: 5, purpose: 'DEPOSIT' }).amount).toBe(
      '0.05',
    );
    expect(
      buildPaymentRequestBody({ ...base, amountCents: 100_000_000, purpose: 'DEPOSIT' }).amount,
    ).toBe('1000000.00');
  });

  it('pins USDT on trc20', () => {
    const body = buildPaymentRequestBody({ ...base, purpose: 'DEPOSIT' });
    expect(body.asset).toBe('USDT');
    expect(body.network).toBe('trc20');
  });

  it('echoes the merchant reference and return URL', () => {
    const body = buildPaymentRequestBody({ ...base, purpose: 'REGISTRATION' });
    expect(body.reference).toBe('AGL-abc');
    expect(body.return_url).toBe('http://x/wallet');
  });

  it('describes each purpose differently', () => {
    const reg = buildPaymentRequestBody({ ...base, purpose: 'REGISTRATION' });
    const dep = buildPaymentRequestBody({ ...base, purpose: 'DEPOSIT' });
    expect(reg.description).toContain('registration fee');
    expect(reg.description).toContain('$20.00');
    expect(dep.description).toContain('deposit');
    expect(dep.description).not.toBe(reg.description);
  });
});

describe('parseNetwork', () => {
  it('offers exactly the three USDT rails we support', () => {
    expect([...ALLOWED_NETWORKS]).toEqual(['trc20', 'erc20', 'bep20']);
  });

  it('accepts each rail the account serves', () => {
    const served = ['trc20', 'erc20', 'bep20'];
    for (const n of served) {
      expect(parseNetwork(n, served)).toBe(n);
    }
  });

  it('is case- and whitespace-insensitive', () => {
    const served = ['trc20', 'erc20', 'bep20'];
    expect(parseNetwork('TRC20', served)).toBe('trc20');
    expect(parseNetwork(' Bep20 ', served)).toBe('bep20');
  });

  it('defaults to the first served rail when the client picks nothing', () => {
    expect(parseNetwork(undefined)).toBe('trc20');
    expect(parseNetwork(null)).toBe('trc20');
    expect(parseNetwork('')).toBe('trc20');
    expect(parseNetwork(undefined, ['bep20', 'trc20'])).toBe('bep20');
  });

  it('rejects a rail the account cannot serve — the account owns the list', () => {
    // ERC20 has no receiving address on the merchant account: the gateway
    // refuses it. Offering it would break the member's payment.
    expect(() => parseNetwork('erc20', ['trc20', 'bep20'])).toThrow(ApiError);
    try {
      parseNetwork('erc20', ['trc20', 'bep20']);
    } catch (err) {
      expect((err as ApiError).status).toBe(400);
      expect((err as ApiError).code).toBe('INVALID_NETWORK');
    }
  });

  it('rejects a rail we do not serve — the client names the intent, the server owns the list', () => {
    expect(() => parseNetwork('solana')).toThrow(ApiError);
    try {
      parseNetwork('solana');
    } catch (err) {
      expect((err as ApiError).status).toBe(400);
      expect((err as ApiError).code).toBe('INVALID_NETWORK');
    }
  });
});

/**
 * The mock rail must never point at the gateway's own hosted checkout.
 *
 * Regression guard for the production bug: mock invoices were issued as
 * `https://checkout.pay2crypto.com/?txid=mock-…&mock=1`, a URL the gateway
 * had never issued, so it answered "Payment link not found" — a third-party
 * error page that read like a merchant fault on a rail that had never charged
 * anybody. A mock invoice belongs on our own origin, labelled as a test.
 */
describe('buildMockCheckoutUrl', () => {
  const input = {
    paymentRef: 'AGL-abc',
    amountCents: 2500,
    purpose: 'REGISTRATION' as const,
    network: 'trc20',
    gatewayTxid: 'mock-1234',
  };

  it('stays on our own origin — never the gateway host', () => {
    const url = buildMockCheckoutUrl(input);
    expect(url.startsWith(config.APP_URL)).toBe(true);
    expect(url).not.toContain('checkout.pay2crypto.com');
    expect(new URL(url).host).toBe(new URL(config.APP_URL).host);
  });

  it('lands on the local test-checkout surface', () => {
    expect(new URL(buildMockCheckoutUrl(input)).pathname).toBe('/wallet/checkout/mock');
  });

  it('carries the invoice the reviewer needs to check', () => {
    const params = new URL(buildMockCheckoutUrl(input)).searchParams;
    expect(params.get('ref')).toBe('AGL-abc');
    expect(params.get('amount')).toBe('25.00');
    expect(params.get('asset')).toBe('USDT');
    expect(params.get('network')).toBe('trc20');
    expect(params.get('purpose')).toBe('REGISTRATION');
    expect(params.get('test_txid')).toBe('mock-1234');
  });

  it('renders the amount in dollars, not cents', () => {
    const params = new URL(buildMockCheckoutUrl({ ...input, amountCents: 5 })).searchParams;
    expect(params.get('amount')).toBe('0.05');
  });
});

describe('isFabricatedCheckoutUrl', () => {
  it('flags the old mock links that were handed to members', () => {
    expect(
      isFabricatedCheckoutUrl('https://checkout.pay2crypto.com/?txid=mock-abc&mock=1'),
    ).toBe(true);
    expect(isFabricatedCheckoutUrl('https://checkout.pay2crypto.com/?txid=mock-abc')).toBe(true);
  });

  it('does not flag a real gateway checkout', () => {
    expect(isFabricatedCheckoutUrl('https://checkout.pay2crypto.com/?txid=real123')).toBe(false);
  });

  it('does not flag our own live test surface', () => {
    expect(
      isFabricatedCheckoutUrl('http://localhost:3000/wallet/checkout/mock?test_txid=mock-1'),
    ).toBe(false);
  });

  it('is false for empty input', () => {
    expect(isFabricatedCheckoutUrl(null)).toBe(false);
    expect(isFabricatedCheckoutUrl(undefined)).toBe(false);
    expect(isFabricatedCheckoutUrl('')).toBe(false);
  });
});

describe('parsePaymentRequestResponse', () => {
  it('reads checkout_url and token — the sandbox shape', () => {
    const parsed = parsePaymentRequestResponse({
      success: true,
      checkout_url: 'https://checkout.pay2crypto.com/?txid=abc',
      token: 'tok_123',
    });
    expect(parsed.paymentUrl).toBe('https://checkout.pay2crypto.com/?txid=abc');
    expect(parsed.gatewayTxid).toBe('tok_123');
  });

  it('falls back to payment_url and url', () => {
    expect(parsePaymentRequestResponse({ payment_url: 'https://a' }).paymentUrl).toBe('https://a');
    expect(parsePaymentRequestResponse({ url: 'https://b' }).paymentUrl).toBe('https://b');
  });

  it('falls back to other gateway id field names', () => {
    expect(parsePaymentRequestResponse({ url: 'https://c', txid: 't1' }).gatewayTxid).toBe('t1');
    expect(parsePaymentRequestResponse({ url: 'https://c', id: 'i1' }).gatewayTxid).toBe('i1');
    expect(parsePaymentRequestResponse({ url: 'https://c' }).gatewayTxid).toBeNull();
  });

  it('fails loudly when there is no checkout link', () => {
    expect(() => parsePaymentRequestResponse({ success: true, token: 'x' })).toThrow(ApiError);
    try {
      parsePaymentRequestResponse({ success: true, token: 'x' });
    } catch (err) {
      expect((err as ApiError).status).toBe(400);
      expect((err as ApiError).code).toBe('PAYMENT_GATEWAY_ERROR');
    }
  });

  it('fails loudly when the gateway reports failure', () => {
    expect(() =>
      parsePaymentRequestResponse({ success: false, checkout_url: 'https://d' }),
    ).toThrow(ApiError);
  });

  it('handles null / non-object payloads without throwing a TypeError', () => {
    expect(() => parsePaymentRequestResponse(null)).toThrow(ApiError);
    expect(() => parsePaymentRequestResponse(undefined)).toThrow(ApiError);
    expect(() => parsePaymentRequestResponse('nonsense')).toThrow(ApiError);
  });
});

/**
 * The webhook contract, pinned from the LIVE rail's create response:
 *   { token, status, settlement, amount, asset, network, network_mode, mode,
 *     pay_address, reference, checkout_url, submitted_hash, expires_at,
 *     created_at, paid_at }
 *
 * The join key is `reference`. A handler that only reads `payment_ref` would
 * 400 on a real payment: the member pays, the ledger never credits, and the
 * gateway gives up retrying. These tests are the tripwire.
 */
describe('extractWebhookEvent', () => {
  it('joins on `reference` - the name the live gateway actually echoes', () => {
    const event = extractWebhookEvent({
      token: '037c40aad2394e2fb77d65f6f8644b30',
      status: 'pending',
      settlement: null,
      amount: '1',
      asset: 'USDT',
      network: 'trc20',
      mode: 'live',
      reference: 'AGL-PROBE-1792590484437',
      checkout_url: 'https://checkout.pay2crypto.com/037c40aa',
      paid_at: null,
    });
    expect(event.paymentRef).toBe('AGL-PROBE-1792590484437');
    expect(event.amount).toBe(1);
    expect(event.settled).toBe(false);
  });

  it('still accepts the legacy `payment_ref` name', () => {
    const event = extractWebhookEvent({ payment_ref: 'AGL-legacy', status: 'confirmed' });
    expect(event.paymentRef).toBe('AGL-legacy');
    expect(event.settled).toBe(true);
  });

  it('treats a confirmed status as settled', () => {
    expect(
      extractWebhookEvent({ reference: 'AGL-1', status: 'confirmed' }).settled,
    ).toBe(true);
    expect(extractWebhookEvent({ reference: 'AGL-1', status: 'paid' }).settled).toBe(true);
    expect(
      extractWebhookEvent({ reference: 'AGL-1', status: 'payment_completed' }).settled,
    ).toBe(true);
  });

  it('reads a settled status nested in `settlement`', () => {
    const event = extractWebhookEvent({
      reference: 'AGL-1',
      status: 'pending',
      settlement: { status: 'confirmed', amount: '20.00' },
    });
    expect(event.settled).toBe(true);
  });

  it('treats a non-null paid_at as settled even without a status', () => {
    const event = extractWebhookEvent({
      reference: 'AGL-1',
      status: 'pending',
      paid_at: '2026-10-21T14:00:00+00:00',
    });
    expect(event.settled).toBe(true);
  });

  it('does NOT settle on a pending / created / broadcasting ping', () => {
    for (const status of ['pending', 'created', 'broadcasting', 'confirming', 'processing']) {
      expect(extractWebhookEvent({ reference: 'AGL-1', status }).settled).toBe(false);
    }
  });

  it('does NOT settle on a missing status - fail closed, not free money', () => {
    expect(extractWebhookEvent({ reference: 'AGL-1' }).settled).toBe(false);
    expect(extractWebhookEvent({ reference: 'AGL-1', paid_at: null }).settled).toBe(false);
  });

  it('is not fooled by a status that merely contains a settled word', () => {
    expect(extractWebhookEvent({ reference: 'AGL-1', status: 'unpaid' }).settled).toBe(false);
    expect(extractWebhookEvent({ reference: 'AGL-1', status: 'not_paid' }).settled).toBe(false);
    expect(extractWebhookEvent({ reference: 'AGL-1', status: 'unconfirmed' }).settled).toBe(false);
  });

  it('reads the amount from `amount` as well as `payment_amount`', () => {
    expect(extractWebhookEvent({ reference: 'AGL-1', amount: '20.00' }).amount).toBe(20);
    expect(extractWebhookEvent({ reference: 'AGL-1', payment_amount: 20 }).amount).toBe(20);
    expect(extractWebhookEvent({ reference: 'AGL-1' }).amount).toBeUndefined();
  });

  it('finds the tx hash under any of the gateway id names', () => {
    expect(extractWebhookEvent({ reference: 'AGL-1', submitted_hash: 'abc' }).txHash).toBe('abc');
    expect(extractWebhookEvent({ reference: 'AGL-1', tx_hash: 'def' }).txHash).toBe('def');
  });

  it('survives a junk payload without throwing', () => {
    expect(extractWebhookEvent(null).settled).toBe(false);
    expect(extractWebhookEvent('nonsense').paymentRef).toBeUndefined();
    expect(extractWebhookEvent({}).paymentRef).toBeUndefined();
  });
});
