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

  // C109 (guard): /vehicle-expenses carries the SAME `validateVehicleOwnership(vehicleId)` cross-tenant
  // gate as vehicle-tco/vehicle-health (routes.ts:147) — a REQUIRED-vehicleId endpoint — but its ownership
  // branch was the one vehicle-scoped analytics route this net never pinned (the C185/C290 additions covered
  // tco/health/fuel-*). The repo method getVehicleExpenses is unit-tested, but a route-layer guard-drop would
  // serve another tenant's per-vehicle expense analytics by guessing an id (the C109/#52 class). Unlike
  // tco/health it also REQUIRES startDate+endDate (dateRangeRequiredVehicleQuerySchema), so omit them and
  // zValidator 400s before the guard — supply the range to reach the ownership branch. RANGE defined above.
  test('vehicle-expenses serves an OWNED vehicle (200 + envelope)', async () => {
    const vehicleId = await seedVehicle('Daily Driver');
    const res = await ctx.authed(
      'GET',
      `/api/v1/analytics/vehicle-expenses?${RANGE}&vehicleId=${vehicleId}`
    );
    const body = await json<{ success: boolean; data: unknown }>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
  });

  test('vehicle-expenses REJECTS a foreign/nonexistent vehicleId with 404 (no cross-tenant analytics leak)', async () => {
    await seedVehicle('Daily Driver'); // owns SOME vehicle, just not the one queried
    const res = await ctx.authed(
      'GET',
      `/api/v1/analytics/vehicle-expenses?${RANGE}&vehicleId=not-my-vehicle-id`
    );
    expect(res.status).toBe(404);
  });

  test('vehicle-expenses missing the REQUIRED vehicleId is a 400 (query validation, before the guard)', async () => {
    const res = await ctx.authed('GET', `/api/v1/analytics/vehicle-expenses?${RANGE}`);
    expect(res.status).toBe(400);
  });

  // C110 (the C108/C109 route-coverage audit, completing the analytics domain): /quick-stats,
  // /cross-vehicle, /year-end were the 3 analytics routes with ZERO HTTP-harness coverage. Unlike the
  // vehicle-scoped routes above they're USER-scoped in the repo (no per-vehicle ownership gate), so the
  // route-layer invariants to pin are: (a) auth-gating — every analytics route is behind requireAuth, but
  // the C185 net asserted 401 on only ONE representative route (/financing); these pin it per-route so a
  // mis-mount that skipped the middleware on one wouldn't go unnoticed; (b) the REQUIRED startDate+endDate
  // validation on the two dateRange routes (omit → 400 via zValidator, BEFORE any repo work); (c) year-end's
  // year is OPTIONAL (omitted → defaults to the current year → 200, not 400). Drives the REAL routes.
  test('quick-stats: 401 anon / 400 missing range / 200 envelope with a valid range', async () => {
    expect((await ctx.anon('GET', `/api/v1/analytics/quick-stats?${RANGE}`)).status).toBe(401);
    expect((await ctx.authed('GET', '/api/v1/analytics/quick-stats')).status).toBe(400); // range required
    const res = await ctx.authed('GET', `/api/v1/analytics/quick-stats?${RANGE}`);
    const body = await json<{ success: boolean; data: unknown }>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
  });

  test('cross-vehicle: 401 anon / 400 missing range / 200 envelope with a valid range', async () => {
    expect((await ctx.anon('GET', `/api/v1/analytics/cross-vehicle?${RANGE}`)).status).toBe(401);
    expect((await ctx.authed('GET', '/api/v1/analytics/cross-vehicle')).status).toBe(400);
    const res = await ctx.authed('GET', `/api/v1/analytics/cross-vehicle?${RANGE}`);
    const body = await json<{ success: boolean; data: unknown }>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
  });

  test('year-end: 401 anon / 200 with NO year (defaults to current year, optional param) / 200 with a year', async () => {
    expect((await ctx.anon('GET', '/api/v1/analytics/year-end')).status).toBe(401);
    // year is OPTIONAL — omitted must NOT 400; it defaults to the current year.
    const noYear = await ctx.authed('GET', '/api/v1/analytics/year-end');
    const noYearBody = await json<{ success: boolean; data: unknown }>(noYear);
    expect(noYear.status, JSON.stringify(noYearBody)).toBe(200);
    expect(noYearBody.success).toBe(true);
    const withYear = await ctx.authed('GET', '/api/v1/analytics/year-end?year=2024');
    expect(withYear.status).toBe(200);
  });

  // #139 (C453): a 0%-APR dealer-promo loan (apr===0, schema .min(0)-valid) must STILL appear in
  // /analytics/financing's loanBreakdown. buildLoanBreakdown previously filtered `&& f.apr` (truthy),
  // dropping apr===0 → a real active loan's principal paydown vanished from the chart (the #92/#117
  // 0%-APR class, 3rd site). The amortization helper handles 0% correctly: interest=balance*0=0, the
  // whole payment retires principal. Drive the REAL GET /analytics/financing over a raw-seeded 0% loan.
  test('a 0%-APR active loan still appears in loanBreakdown with a principal series (#139)', async () => {
    const vehicleId = await seedVehicle('Promo Lease');
    // Raw-seed a 0%-APR active loan (the form/route allows apr:0; seed directly to pin the analytics path).
    ctx.sqlite.run(
      `INSERT INTO vehicle_financing
         (id, vehicle_id, financing_type, provider, original_amount, apr, term_months, start_date, payment_amount, is_active)
       VALUES ('fin-0apr', ?, 'loan', 'Dealer 0% Promo', 12000, 0, 24, ?, 500, 1)`,
      [vehicleId, Math.floor(new Date('2024-01-01').getTime() / 1000)]
    );
    // A financing-source payment so computeBalance < original → a real outstanding balance to amortize.
    ctx.sqlite.run(
      `INSERT INTO expenses (id, vehicle_id, user_id, category, expense_amount, date, source_type, source_id, missed_fillup)
       VALUES ('pay-0apr', ?, ?, 'financial', 500, ?, 'financing', 'fin-0apr', 0)`,
      [vehicleId, ctx.user.id, Math.floor(new Date('2024-02-01').getTime() / 1000)]
    );

    const res = await ctx.authed('GET', '/api/v1/analytics/financing');
    const body =
      await json<
        DataEnvelope<{
          loanBreakdown: Array<{ month: string; interest: number; principal: number }>;
        }>
      >(res);
    expect(res.status, JSON.stringify(body)).toBe(200);

    // NON-VACUOUS: pre-fix the `&& f.apr` filter excluded apr===0 → loanBreakdown was []. Post-fix the
    // 0% loan is present; a 0% loan's interest is always 0 and the payment retires principal.
    expect(body.data.loanBreakdown.length, 'a 0%-APR loan must not be dropped').toBeGreaterThan(0);
    expect(body.data.loanBreakdown.every((m) => m.interest === 0)).toBe(true);
    expect(body.data.loanBreakdown.some((m) => m.principal > 0)).toBe(true);
  });
});
