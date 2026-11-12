import { describe, expect, test } from 'bun:test';
import { createTestApp } from '../../../test-helpers/http-client';
import { isAllowedPushEndpoint } from '../push-endpoint';
import { pushSubscriptionRepository } from '../repository';

describe('isAllowedPushEndpoint allowlist', () => {
  test('accepts real browser-vendor push endpoints (https, known host + subdomains)', () => {
    for (const ep of [
      'https://fcm.googleapis.com/fcm/send/abc123',
      'https://updates.push.services.mozilla.com/wpush/v2/xyz',
      'https://web.push.apple.com/Qw...token',
      'https://abc.notify.windows.com/w/?token=x',
    ]) {
      expect(isAllowedPushEndpoint(ep)).toBe(true);
    }
  });

  test('rejects every SSRF vector + non-vendor host', () => {
    for (const ep of [
      'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
      'https://169.254.169.254/latest/meta-data/',
      'http://127.0.0.1:6379/',
      'https://localhost/x',
      'http://10.0.0.5:22/',
      'http://[::1]/',
      'http://2130706433/',
      'http://0x7f000001/',
      'https://fcm.googleapis.com.evil.com/x',
      'https://evilfcm.googleapis.com.attacker.tld/x',
      'https://user:pass@fcm.googleapis.com/x',
      'http://fcm.googleapis.com/x',
      'ftp://fcm.googleapis.com/x',
      'file:///etc/passwd',
      'not-a-url',
      '',
      'https://example.com/x',
    ]) {
      expect(isAllowedPushEndpoint(ep), `should reject: ${ep}`).toBe(false);
    }
  });
});

describe('POST /api/v1/push/subscribe SSRF rejection', () => {
  test('a metadata/internal endpoint is rejected (400) + nothing is stored', async () => {
    const ctx = await createTestApp();
    const res = await ctx.authed('POST', '/api/v1/push/subscribe', {
      endpoint: 'http://169.254.169.254/latest/meta-data/',
      keys: { p256dh: 'k', auth: 'a' },
    });
    expect(res.status).toBe(400);
    expect(await pushSubscriptionRepository.findByUser(ctx.user.id)).toHaveLength(0);
    ctx.close();
  });

  test('a real vendor endpoint is accepted (201)', async () => {
    const ctx = await createTestApp();
    const res = await ctx.authed('POST', '/api/v1/push/subscribe', {
      endpoint: 'https://fcm.googleapis.com/fcm/send/ok',
      keys: { p256dh: 'k', auth: 'a' },
    });
    expect(res.status).toBe(201);
    expect(await pushSubscriptionRepository.findByUser(ctx.user.id)).toHaveLength(1);
    ctx.close();
  });
});
