/**
 * Behavioral guard (C225) for the CSRF protection on state-changing requests — the RUNTIME complement to
 * the source-scan in cors-csrf-origin-coupling.test.ts (which pins that cors()+csrf() read the same
 * allowlist, but never exercises an actual rejection).
 *
 * app.ts mounts `csrf({ origin: CONFIG.cors.origins })`, so a POST/PUT/DELETE/PATCH from an untrusted
 * origin (or with a cross-site Sec-Fetch-Site and no allowed Origin) is rejected with a bare 403
 * HTTPException — Hono's CSRF middleware. This is a SECURITY boundary (NORTH_STAR #2 cross-tenant/forgery
 * isolation): without it, a malicious page could ride a logged-in user's cookie to mutate their data.
 *
 * Nothing exercised the rejection behaviorally — a regression that dropped/loosened csrf() would leave the
 * source-scan green (if the call still references CONFIG.cors.origins) yet silently stop rejecting. This
 * drives the REAL app: a same-origin DELETE (the harness sets Sec-Fetch-Site: same-origin) succeeds, while
 * the IDENTICAL DELETE with a cross-site Sec-Fetch-Site + a foreign Origin is 403'd. (This also documents
 * why a raw `curl` DELETE without an Origin header 403s — the C225 scout's false-alarm resolution: the
 * CSRF guard working as intended, not a vehicle-delete bug.)
 *
 * createTestApp() rewrites env + dynamic-imports DB-bound modules, so keep imports to the harness + bun:test.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type DataEnvelope, json, type TestApp } from '../test-helpers/http-client';
import { seedVehicle } from '../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

describe('CSRF protects state-changing requests (C225 behavioral guard)', () => {
  test('a same-origin DELETE succeeds (the harness mirrors a real browser same-origin call)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    // ctx.authed sets Sec-Fetch-Site: same-origin → passes CSRF, like the real FE.
    const res = await ctx.authed('DELETE', `/api/v1/vehicles/${vehicleId}`);
    expect(res.status, await res.text()).toBe(200);
  });

  test('a cross-site DELETE (foreign Origin + Sec-Fetch-Site: cross-site) is 403 forgery-rejected', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });

    // Same valid session cookie, but a CROSS-SITE fetch metadata + an untrusted Origin — exactly what a
    // malicious third-party page riding the user's cookie looks like. CSRF must reject it BEFORE the
    // handler runs (a bare 403 HTTPException), so the vehicle is NOT deleted.
    const res = await ctx.app.request(`/api/v1/vehicles/${vehicleId}`, {
      method: 'DELETE',
      headers: {
        Cookie: ctx.cookie,
        Origin: 'https://evil.example.com',
        'Sec-Fetch-Site': 'cross-site',
      },
    });
    expect(res.status, 'cross-origin state-change must be CSRF-rejected').toBe(403);

    // The vehicle survives — the rejection happened before the delete handler.
    const after = await ctx.authed('GET', `/api/v1/vehicles/${vehicleId}`);
    const body = await json<DataEnvelope<{ id: string }>>(after);
    expect(after.status, JSON.stringify(body)).toBe(200);
    expect(body.data.id).toBe(vehicleId);
  });

  test('a same-origin GET is unaffected by CSRF (reads are not state-changing)', async () => {
    // Sanity floor: CSRF only guards mutating verbs; a cross-site GET reading own data still works (the
    // session cookie carries auth). Pins that the guard didn't over-broaden to block reads.
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const res = await ctx.app.request(`/api/v1/vehicles/${vehicleId}`, {
      method: 'GET',
      headers: { Cookie: ctx.cookie, 'Sec-Fetch-Site': 'cross-site' },
    });
    expect(res.status).toBe(200);
  });
});
