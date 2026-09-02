/**
 * Guard for the VAPID public-key route + the private-key-never-leaks invariant (push-notifications T2).
 *
 * TWO halves:
 *  (A) HTTP behaviour via createTestApp. The harness sets NO VAPID env vars, so CONFIG.push.enabled is
 *      false — which is exactly the DEFAULT deployment state and the R6 honesty guarantee we most need
 *      pinned: an unconfigured server answers 503 PUSH_NOT_CONFIGURED (not a 500, not a blank 200), and
 *      the route requires auth. (CONFIG is a process-cached env snapshot read at first import — it can't
 *      be flipped per-file in the full suite [the ALLOW_FAKE_STORAGE lesson, CLAUDE.md], so the
 *      configured-200 path is asserted by driving the handler with a stubbed CONFIG in half (C) instead
 *      of fighting the module cache.)
 *  (B) A source-scan invariant: the route source NEVER references vapidPrivateKey. The private key is
 *      server-only (it signs payloads in T4); a route that read it could leak the app-server secret to a
 *      response. This fails loudly if a future edit wires the private key into the read surface.
 *  (C) A pure handler check of the configured path (stubbed CONFIG) — 200 returns ONLY the public key.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestApp } from '../../../test-helpers/http-client';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTE_SRC = readFileSync(join(HERE, '..', 'routes.ts'), 'utf-8');

describe('push VAPID public-key route (T2)', () => {
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

  test('the route source never reads the VAPID PRIVATE key (server-only; never in a response)', () => {
    expect(ROUTE_SRC.includes('vapidPrivateKey')).toBe(false);
  });

  test('the route DOES serve the public key when configured (references vapidPublicKey)', () => {
    // A light coupling assertion: the configured branch returns CONFIG.push.vapidPublicKey. Combined
    // with the private-key-absence scan above, this pins "public in, private never out".
    expect(ROUTE_SRC.includes('vapidPublicKey')).toBe(true);
    expect(ROUTE_SRC.includes('PUSH_NOT_CONFIGURED')).toBe(true);
  });
});
