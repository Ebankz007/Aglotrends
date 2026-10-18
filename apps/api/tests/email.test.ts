import { describe, expect, it, vi } from 'vitest';
import { describeResendFailure, emailConfigured, sendEmail } from '../src/notifications/email.js';
import type { ResolvedEmailIntegration } from '../src/services/settings.js';

/**
 * Email provider dispatch, pinned offline. The console can switch the platform
 * between SMTP and Resend; these tests lock the rule for "is this channel
 * configured" so a provider swap can never silently black-hole mail — and they
 * prove the test suite itself never sends a real message.
 */

function cfg(overrides: Partial<ResolvedEmailIntegration> = {}): ResolvedEmailIntegration {
  return {
    provider: 'smtp',
    enabled: true,
    smtpUrl: '',
    resendApiKey: '',
    from: 'Aglotrends <no-reply@aglotrends.com>',
    replyTo: '',
    ...overrides,
  };
}

describe('emailConfigured', () => {
  it('is false when the channel is disabled, whatever the credentials', () => {
    expect(emailConfigured(cfg({ enabled: false, smtpUrl: 'smtps://u:p@h:465' }))).toBe(false);
    expect(
      emailConfigured(cfg({ enabled: false, provider: 'resend', resendApiKey: 're_x' })),
    ).toBe(false);
  });

  it('requires the SMTP URL when the provider is smtp', () => {
    expect(emailConfigured(cfg({ provider: 'smtp', smtpUrl: '' }))).toBe(false);
    expect(emailConfigured(cfg({ provider: 'smtp', smtpUrl: 'smtps://u:p@h:465' }))).toBe(true);
    // A Resend key does NOT satisfy the smtp provider.
    expect(emailConfigured(cfg({ provider: 'smtp', smtpUrl: '', resendApiKey: 're_x' }))).toBe(
      false,
    );
  });

  it('requires the API key when the provider is resend', () => {
    expect(emailConfigured(cfg({ provider: 'resend', resendApiKey: '' }))).toBe(false);
    expect(emailConfigured(cfg({ provider: 'resend', resendApiKey: 're_x' }))).toBe(true);
    // An SMTP URL does NOT satisfy the resend provider.
    expect(
      emailConfigured(cfg({ provider: 'resend', smtpUrl: 'smtps://u:p@h:465', resendApiKey: '' })),
    ).toBe(false);
  });

  it('ignores whitespace-only credentials', () => {
    expect(emailConfigured(cfg({ provider: 'resend', resendApiKey: '   ' }))).toBe(false);
    expect(emailConfigured(cfg({ provider: 'smtp', smtpUrl: '   ' }))).toBe(false);
  });
});

describe('sendEmail in the test environment', () => {
  it('never touches the network, even with a Resend key configured', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await sendEmail(
      'member@example.com',
      'Subject',
      'Body',
      '<p>Body</p>',
      cfg({ provider: 'resend', resendApiKey: 're_test' }),
    );
    expect(result.dev).toBe(true);
    expect(result.body).toBe('<p>Body</p>');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('describeResendFailure', () => {
  // Resend's real 403 body for an unverified From domain.
  const unverified =
    '{"statusCode":403,"name":"validation_error","message":"The aglotrends.com domain is not verified. Please, add and verify your domain on https://resend.com/domains"}';
  const testing =
    '{"statusCode":403,"message":"You can only send testing emails to your own email address"}';
  const inactive = '{"statusCode":403,"message":"API key is not active"}';

  it('reads a 403 as an unverified domain, not as a bad key', () => {
    const msg = describeResendFailure(403, unverified, 'member@example.com');
    expect(msg).toMatch(/not verified/i);
    expect(msg).not.toMatch(/RESEND_API_KEY/);
  });

  it('distinguishes the testing-sender restriction', () => {
    expect(describeResendFailure(403, testing, 'x@y.com')).toMatch(/onboarding@resend\.dev/);
  });

  it('names the key only when the body says the key is at fault', () => {
    expect(describeResendFailure(403, inactive, 'x@y.com')).toMatch(/API key/);
  });

  it('stays honest on a 403 body it cannot classify', () => {
    const msg = describeResendFailure(403, '{"message":"something else"}', 'x@y.com');
    expect(msg).toMatch(/API key is inactive or the From domain is unverified/);
  });

  it('maps 401, 422 and 429 to their own causes', () => {
    expect(describeResendFailure(401, '', 'x@y.com')).toMatch(/RESEND_API_KEY/);
    expect(describeResendFailure(422, '', 'x@y.com')).toMatch(/From address/);
    expect(describeResendFailure(429, '', 'x@y.com')).toMatch(/rate limit/i);
  });
});
