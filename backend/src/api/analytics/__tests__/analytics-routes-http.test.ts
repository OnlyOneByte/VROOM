/**
 * In-process HTTP tests for the REAL analytics routes (C185 deep-review → guard).
 *
 * The analytics route handlers (analytics/routes.ts) were the named coverage low spot (15% func) —
 * the existing summary-route.test.ts reconstructs a MINIMAL app inline (mocked repo + fake auth),
 * so it never drives the real module (the C181/C182 coverage-theater shape). This drives the ACTUAL
 * app via createTestApp() over an in-memory DB (the C91 providers-routes precedent), so it covers:
 *   - auth gating (anon → 401) on a representative endpoint,
 *   - the OWNERSHIP-GUARD branch the audit cares about: a vehicle-scoped endpoint must NOT serve a
 *     foreign / nonexistent vehicleId (validateVehicleOwnership → NotFoundError → 404; the C109/#52
 *     cross-tenant class — a user can never read another tenant's analytics by guessing an id),
 *   - the optional-vehicleId branch (omitted → all-the-user's-vehicles path, no validation),
 *   - the {success,data} success envelope on an owned vehicle,
 *   - query validation (required vehicleId missing → 400).
 *
 * createTestApp() must run before static config/connection imports — keep imports to the harness.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

async function seedVehicle(nickname: string): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/vehicles', {
    make: 'Honda',
    model: 'Civic',
    year: 2021,
    nickname,
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

describe('analytics routes (real HTTP stack)', () => {
  test('401 without a session (auth middleware gates every analytics route)', async () => {
    const res = await ctx.anon('GET', '/api/v1/analytics/financing');
    expect(res.status).toBe(401);
  });

  test('non-vehicle endpoints return a {success,data} envelope for the authed user', async () => {
    // /financing + /insurance take no vehicleId — they aggregate the user's own fleet (userId-scoped
    // in the repository). Even with an empty fleet they must return a shaped 200, not throw.
    for (const path of ['/api/v1/analytics/financing', '/api/v1/analytics/insurance']) {
      const res = await ctx.authed('GET', path);
      const body = await json<{ success: boolean; data: unknown }>(res);
      expect(res.status, `${path}: ${JSON.stringify(body)}`).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
    }
  });

  test('vehicle-tco serves an OWNED vehicle (200 + envelope)', async () => {
    const vehicleId = await seedVehicle('Daily Driver');
    const res = await ctx.authed('GET', `/api/v1/analytics/vehicle-tco?vehicleId=${vehicleId}`);
    const body = await json<{ success: boolean; data: unknown }>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
  });

  test('vehicle-tco REJECTS a foreign/nonexistent vehicleId with 404 (no cross-tenant analytics leak)', async () => {
    await seedVehicle('Daily Driver'); // the user owns SOME vehicle, just not the one queried
    // A vehicleId the user does not own (validateVehicleOwnership can't distinguish not-owned from
    // not-found — both 404, the anti-enumeration posture). Pre-guard this would have run analytics
    // over a vehicle the caller has no claim to.
    const res = await ctx.authed(
      'GET',
      '/api/v1/analytics/vehicle-tco?vehicleId=not-my-vehicle-id'
    );
    expect(res.status).toBe(404);
  });

  test('vehicle-health REJECTS a foreign vehicleId with 404 too (same ownership guard)', async () => {
    await seedVehicle('Daily Driver');
    const res = await ctx.authed(
      'GET',
      '/api/v1/analytics/vehicle-health?vehicleId=someone-elses-vehicle'
    );
    expect(res.status).toBe(404);
  });

  test('vehicle-tco missing the REQUIRED vehicleId is a 400 (query validation)', async () => {
    const res = await ctx.authed('GET', '/api/v1/analytics/vehicle-tco');
    expect(res.status).toBe(400);
  });

  test('fuel-efficiency with NO vehicleId is allowed (the optional-guard branch — all-fleet trend)', async () => {
    // fuel-efficiency guards ownership only `if (vehicleId)`; omitted means the whole fleet, so it
    // must NOT 400/404 — it returns the fleet trend envelope. Pins the optional-vehicleId branch.
    const res = await ctx.authed('GET', '/api/v1/analytics/fuel-efficiency');
    const body = await json<{ success: boolean; data: { fuelEfficiencyTrend: unknown } }>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.fuelEfficiencyTrend).toBeDefined();
  });

  test('fuel-efficiency with a FOREIGN vehicleId is 404 (the guard fires when an id IS supplied)', async () => {
    await seedVehicle('Daily Driver');
    const res = await ctx.authed('GET', '/api/v1/analytics/fuel-efficiency?vehicleId=nope');
    expect(res.status).toBe(404);
  });

  // C290: /fuel-stats + /fuel-advanced carry the IDENTICAL `if (vehicleId) validateVehicleOwnership`
  // optional-guard as fuel-efficiency, but their cross-tenant branch was uncovered (the C185 net pinned
  // fuel-efficiency + the required-vehicleId endpoints, not these two). Pin both branches on each:
  // omitted vehicleId → 200 all-fleet (no validation), foreign vehicleId → 404 (no cross-tenant leak).
  // NOTE: unlike fuel-efficiency, these two REQUIRE startDate+endDate (unix seconds) — omit them and
  // zValidator 400s BEFORE the ownership guard, so supply a valid range to reach the guard branch.
  const RANGE = 'startDate=1704067200&endDate=1735689600'; // 2024 calendar year (unix seconds)

  test('fuel-stats with NO vehicleId returns the all-fleet envelope (optional-guard branch)', async () => {
    const res = await ctx.authed('GET', `/api/v1/analytics/fuel-stats?${RANGE}`);
    const body = await json<{ success: boolean; data: unknown }>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
  });

  test('fuel-stats with a FOREIGN vehicleId is 404 (cross-tenant ownership guard)', async () => {
    await seedVehicle('Daily Driver');
    const res = await ctx.authed('GET', `/api/v1/analytics/fuel-stats?${RANGE}&vehicleId=not-mine`);
    expect(res.status).toBe(404);
  });

  test('fuel-advanced with NO vehicleId returns the all-fleet envelope (optional-guard branch)', async () => {
    const res = await ctx.authed('GET', `/api/v1/analytics/fuel-advanced?${RANGE}`);
    const body = await json<{ success: boolean; data: unknown }>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
  });

  test('fuel-advanced with a FOREIGN vehicleId is 404 (cross-tenant ownership guard)', async () => {
    await seedVehicle('Daily Driver');
    const res = await ctx.authed(
      'GET',
      `/api/v1/analytics/fuel-advanced?${RANGE}&vehicleId=not-mine`
    );
    expect(res.status).toBe(404);
  });
});
