// Runtime check that csrf() rejects a cross-site state-changing request before its handler runs.
// cors-csrf-origin-coupling.test.ts covers only the config wiring. A raw curl DELETE without an Origin header is also rejected.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type DataEnvelope, json, type TestApp } from '../test-helpers/http-client';
import { seedVehicle } from '../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

describe('CSRF protects state-changing requests', () => {
  test('a same-origin DELETE succeeds (the harness mirrors a real browser same-origin call)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    // ctx.authed sends Sec-Fetch-Site: same-origin, as a browser does.
    const res = await ctx.authed('DELETE', `/api/v1/vehicles/${vehicleId}`);
    expect(res.status, await res.text()).toBe(200);
  });

  test('a cross-site DELETE (foreign Origin + Sec-Fetch-Site: cross-site) is 403 forgery-rejected', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });

    // Valid cookie plus a cross-site origin, as a malicious page would send. The 403 must come before the
    // handler runs, so the vehicle must survive.
    const res = await ctx.app.request(`/api/v1/vehicles/${vehicleId}`, {
      method: 'DELETE',
      headers: {
        Cookie: ctx.cookie,
        Origin: 'https://evil.example.com',
        'Sec-Fetch-Site': 'cross-site',
      },
    });
    expect(res.status, 'cross-origin state-change must be CSRF-rejected').toBe(403);

    // The vehicle survives: the rejection happened before the delete handler.
    const after = await ctx.authed('GET', `/api/v1/vehicles/${vehicleId}`);
    const body = await json<DataEnvelope<{ id: string }>>(after);
    expect(after.status, JSON.stringify(body)).toBe(200);
    expect(body.data.id).toBe(vehicleId);
  });

  test('a same-origin GET is unaffected by CSRF (reads are not state-changing)', async () => {
    // Reads are not state-changing, so CSRF must leave them alone.
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const res = await ctx.app.request(`/api/v1/vehicles/${vehicleId}`, {
      method: 'GET',
      headers: { Cookie: ctx.cookie, 'Sec-Fetch-Site': 'cross-site' },
    });
    expect(res.status).toBe(200);
  });
});
