/**
 * SSRF guard for the push endpoint (push-notifications, C560 hardening).
 *
 * The subscribe endpoint is a URL the server later POSTs to (via web-push). An authenticated user can
 * hand-craft the JSON body, so without an allowlist they could register an internal/metadata/localhost
 * URL and turn the send hook into a request proxy (blind SSRF, ARCC SSRF-mitigation). This pins:
 *   (A) isAllowedPushEndpoint accepts ONLY https URLs on a known browser-vendor push host, and rejects
 *       every SSRF vector (metadata IP, loopback, private IP, alternate IP encodings, http, other
 *       schemes, userinfo-bypass, look-alike domains, malformed).
 *   (B) POST /api/v1/push/subscribe REJECTS a rogue endpoint (400) + stores nothing, while accepting a
 *       real vendor endpoint (201) — validation at the earliest point (SAX-04).
 */

import { describe, expect, test } from 'bun:test';
import { createTestApp } from '../../../test-helpers/http-client';
import { isAllowedPushEndpoint } from '../push-endpoint';
import { pushSubscriptionRepository } from '../repository';

describe('isAllowedPushEndpoint — allowlist (A)', () => {
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
      'http://169.254.169.254/latest/meta-data/iam/security-credentials/', // EC2 metadata
      'https://169.254.169.254/latest/meta-data/', // metadata over https
      'http://127.0.0.1:6379/', // loopback admin port (Redis)
      'https://localhost/x', // localhost name
      'http://10.0.0.5:22/', // private RFC1918
      'http://[::1]/', // IPv6 loopback
      'http://2130706433/', // 127.0.0.1 as an int
      'http://0x7f000001/', // 127.0.0.1 as hex
      'https://fcm.googleapis.com.evil.com/x', // look-alike suffix (not a real subdomain)
      'https://evilfcm.googleapis.com.attacker.tld/x', // another look-alike
      'https://user:pass@fcm.googleapis.com/x', // userinfo bypass attempt (rejected even on a good host)
      'http://fcm.googleapis.com/x', // right host, wrong scheme (http)
      'ftp://fcm.googleapis.com/x', // other scheme
      'file:///etc/passwd', // file scheme
      'not-a-url', // malformed
      '', // empty
      'https://example.com/x', // a valid https URL but not a push vendor
    ]) {
      expect(isAllowedPushEndpoint(ep), `should reject: ${ep}`).toBe(false);
    }
  });
});

describe('POST /api/v1/push/subscribe — SSRF rejection (B)', () => {
  test('a metadata/internal endpoint is rejected (400) + nothing is stored', async () => {
    const ctx = await createTestApp();
    const res = await ctx.authed('POST', '/api/v1/push/subscribe', {
      endpoint: 'http://169.254.169.254/latest/meta-data/',
      keys: { p256dh: 'k', auth: 'a' },
    });
    expect(res.status).toBe(400);
    // The rogue endpoint never entered the store.
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
