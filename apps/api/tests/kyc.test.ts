import { describe, expect, it } from 'vitest';
import { maskId } from '../src/services/kyc.js';

/**
 * `maskId` is the only thing standing between a leaked session and a full
 * identity-document dump. The API stores `idNumber` whole (an operator must be
 * able to verify it) but every read path funnels through this function, so its
 * contract is a security boundary, not a formatting nicety.
 */
describe('maskId', () => {
  it('shows only the last 4 characters of a real document number', () => {
    expect(maskId('1234567890')).toBe('••••••7890');
    expect(maskId('AB1234567A')).toBe('••••••567A');
  });

  it('never returns the whole value for anything longer than 4 chars', () => {
    const full = 'P1234567X';
    const masked = maskId(full)!;
    expect(masked).not.toBe(full);
    expect(masked.endsWith(full.slice(-4))).toBe(true);
  });

  it('caps the bullet run at 8 so a long id does not leak its length', () => {
    const masked = maskId('A'.repeat(40))!;
    expect(masked).toBe('••••••••AAAA');
  });

  it('fully masks short values instead of echoing them', () => {
    expect(maskId('1234')).toBe('••••');
    expect(maskId('12')).toBe('••••');
    expect(maskId('A')).toBe('••••');
  });

  it('returns null for empty / missing input', () => {
    expect(maskId(null)).toBeNull();
    expect(maskId(undefined)).toBeNull();
    expect(maskId('')).toBeNull();
  });

  it('trims surrounding whitespace before masking', () => {
    expect(maskId('  1234567890  ')).toBe('••••••7890');
  });
});
