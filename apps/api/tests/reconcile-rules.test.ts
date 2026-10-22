import { describe, expect, it } from 'vitest';
import {
  gatewayAgreesWithInvoice,
  gatewayHasMoney,
  gatewaySaysConfirmed,
  gatewaySaysDead,
} from '../src/services/reconcile-rules.js';

/**
 * These rules decide whether a member's money activates their account. Every
 * case here was a way to get it wrong.
 */
describe('reconciliation rules', () => {
  describe('gatewaySaysConfirmed', () => {
    it('trusts an explicit confirmation', () => {
      expect(gatewaySaysConfirmed({ status: 'paid' })).toBe(true);
      expect(gatewaySaysConfirmed({ status: 'confirmed' })).toBe(true);
      expect(gatewaySaysConfirmed({ status: 'settled' })).toBe(true);
      expect(gatewaySaysConfirmed({ status: 'successful' })).toBe(true);
    });

    it('refuses a request the gateway calls pending', () => {
      expect(gatewaySaysConfirmed({ status: 'pending' })).toBe(false);
      expect(gatewaySaysConfirmed({ status: 'awaiting' })).toBe(false);
      expect(gatewaySaysConfirmed({ status: 'broadcast' })).toBe(false);
    });

    it('credits a LATE payment: money that landed after the window closed', () => {
      // Crypto has no chargeback. The funds can arrive after the checkout
      // expired, and the gateway records it. Not crediting this strands a
      // member who sent real money.
      expect(gatewaySaysConfirmed({ status: 'expired', paid_at: '2026-10-21T15:34:47Z' })).toBe(true);
      expect(gatewaySaysConfirmed({ status: 'cancelled', submitted_hash: '0xabc' })).toBe(true);
    });

    it('never auto-settles a request the gateway calls failed', () => {
      // Even with a hash attached, a failure verdict means a human must look.
      expect(gatewaySaysConfirmed({ status: 'failed' })).toBe(false);
      expect(gatewaySaysConfirmed({ status: 'failed', submitted_hash: '0xabc' })).toBe(false);
      expect(gatewaySaysConfirmed({ status: 'rejected' })).toBe(false);
      expect(gatewaySaysConfirmed({ status: 'declined' })).toBe(false);
    });

    it('settles nothing without a record', () => {
      expect(gatewaySaysConfirmed(null)).toBe(false);
      expect(gatewaySaysConfirmed(undefined)).toBe(false);
    });
  });

  describe('gatewaySaysDead', () => {
    it('releases an expired, unpaid request', () => {
      expect(gatewaySaysDead({ status: 'expired' })).toBe(true);
      expect(gatewaySaysDead({ status: 'cancelled' })).toBe(true);
    });

    it('never releases a request that has money attached', () => {
      // "Dead but paid" is not dead - it is a payment that needs a human.
      expect(gatewaySaysDead({ status: 'expired', paid_at: '2026-10-21T15:34:47Z' })).toBe(false);
      expect(gatewaySaysDead({ status: 'cancelled', submitted_hash: '0xabc' })).toBe(false);
    });

    it('never releases a live request', () => {
      expect(gatewaySaysDead({ status: 'pending' })).toBe(false);
      expect(gatewaySaysDead({ status: 'paid' })).toBe(false);
    });
  });

  describe('gatewayHasMoney', () => {
    it('reads money from either field', () => {
      expect(gatewayHasMoney({ paid_at: '2026-10-21T15:34:47Z' })).toBe(true);
      expect(gatewayHasMoney({ submitted_hash: '0xabc' })).toBe(true);
      expect(gatewayHasMoney({ status: 'expired' })).toBe(false);
      expect(gatewayHasMoney(null)).toBe(false);
    });
  });

  describe('gatewayAgreesWithInvoice', () => {
    const invoice = { amount_cents: 2500, network: 'bep20' };

    it('agrees when the gateway charged what we asked for', () => {
      expect(
        gatewayAgreesWithInvoice(
          { status: 'paid', amount: '25', network: 'bep20', settlement: 'over' },
          invoice,
        ),
      ).toEqual({ ok: true, why: '-' });
    });

    it('refuses a different amount', () => {
      const verdict = gatewayAgreesWithInvoice({ status: 'paid', amount: '20' }, invoice);
      expect(verdict.ok).toBe(false);
      expect(verdict.why).toContain('AMOUNT_MISMATCH');
    });

    it('refuses a different network', () => {
      const verdict = gatewayAgreesWithInvoice(
        { status: 'paid', amount: '25', network: 'trc20' },
        invoice,
      );
      expect(verdict.ok).toBe(false);
      expect(verdict.why).toContain('NETWORK_MISMATCH');
    });

    it('refuses an underpayment', () => {
      const verdict = gatewayAgreesWithInvoice(
        { status: 'paid', amount: '25', network: 'bep20', settlement: 'under' },
        invoice,
      );
      expect(verdict.ok).toBe(false);
      expect(verdict.why).toContain('UNDERPAID');
    });

    it('accepts an overpayment - the member owes us nothing less', () => {
      expect(
        gatewayAgreesWithInvoice(
          { status: 'paid', amount: '25', network: 'bep20', settlement: 'over' },
          invoice,
        ).ok,
      ).toBe(true);
    });

    it('refuses when there is no record at all', () => {
      expect(gatewayAgreesWithInvoice(null, invoice).ok).toBe(false);
    });
  });
});
