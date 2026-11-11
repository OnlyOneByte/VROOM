/**
 * VAPID public-key route. The test environment has no VAPID config, so the route must answer 503
 * PUSH_NOT_CONFIGURED and require auth. A source scan checks that the route never reads the private
 * key. CONFIG is cached per process, so the configured branch is not exercised here.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestApp } from '../../../test-helpers/http-client';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTE_SRC = readFileSync(join(HERE, '..', 'routes.ts'), 'utf-8');

describe('push VAPID public-key route', () => {
  test('unconfigured server → 503 PUSH_NOT_CONFIGURED (honest, not 500/blank)', async () => {
    const ctx = await createTestApp();
    const res = await ctx.authed('GET', '/api/v1/push/vapid-public-key');
    expect(res.status).toBe(503);
    const body = (await res.json()) as { success: boolean; error?: { code?: string } };
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('PUSH_NOT_CONFIGURED');
    ctx.close();
  });

  test('requires auth (anon → 401)', async () => {
    const ctx = await createTestApp();
    const res = await ctx.anon('GET', '/api/v1/push/vapid-public-key');
    expect(res.status).toBe(401);
    ctx.close();
  });

  test('the route source never reads the VAPID private key', () => {
    expect(ROUTE_SRC.includes('vapidPrivateKey')).toBe(false);
  });

  test('the route source references the public key and the not-configured code', () => {
    expect(ROUTE_SRC.includes('vapidPublicKey')).toBe(true);
    expect(ROUTE_SRC.includes('PUSH_NOT_CONFIGURED')).toBe(true);
  });
});
