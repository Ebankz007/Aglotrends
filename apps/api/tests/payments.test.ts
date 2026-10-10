import { describe, expect, it } from 'vitest';
import {
  FEE_CENTS,
  buildPaymentRequestBody,
  parsePaymentRequestResponse,
} from '../src/services/payment-service.js';
import { ApiError } from '../src/lib/errors.js';

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
