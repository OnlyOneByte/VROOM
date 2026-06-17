/**
 * Vehicle-ownership 404 guard on the financing GET + POST routes (C294 arch characterization).
 *
 * `GET` and `POST /api/v1/financing/vehicles/:vehicleId/financing` both gate on the vehicle existing
 * AND belonging to the caller before doing any financing work. Financing was the LONE route module
 * hand-rolling that guard inline (`vehicleRepository.findByUserIdAndId` + a manual
 * `throw new HTTPException(404, { message: 'Vehicle not found' })`) while every sibling module
 * (expenses/insurance/odometer/analytics/vehicles) uses the shared `validateVehicleOwnership`.
 *
 * This pins the OBSERVABLE 404 (status + message) on both routes so the C294 refactor — swapping the
 * inline blocks for `validateVehicleOwnership`, which throws `NotFoundError('Vehicle')` → the same
 * 404 + "Vehicle not found" message via the global error handler — is provably behavior-preserving
 * for every consumer. (The raw error envelope's `code` field shifts from 'HTTPException' to
 * 'NotFoundError', CONVERGING financing onto the code every other route already emits for this case;
 * the FE never branches on either value — both are absent from ERROR_CODE_MESSAGES, so it falls back
 * to `error.message`, which is unchanged.)
 *
 * createTestApp() rewrites env + dynamic-imports the DB-bound modules, so this imports only the
 * harness + bun:test.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

const MISSING_VEHICLE = 'no-such-vehicle-id';

describe('financing routes 404 when the vehicle is missing / not owned (C294)', () => {
  test('GET financing for a nonexistent vehicle → 404 "Vehicle not found"', async () => {
    const res = await ctx.authed('GET', `/api/v1/financing/vehicles/${MISSING_VEHICLE}/financing`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: { message?: string } };
    expect(body.error?.message).toBe('Vehicle not found');
  });

  test('POST financing for a nonexistent vehicle → 404 "Vehicle not found" (before any financing write)', async () => {
    const res = await ctx.authed(
      'POST',
      `/api/v1/financing/vehicles/${MISSING_VEHICLE}/financing`,
      {
        financingType: 'loan',
        provider: 'LoanBank',
        originalAmount: 25000,
        termMonths: 60,
        startDate: '2024-01-01',
        paymentAmount: 480,
      }
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: { message?: string } };
    expect(body.error?.message).toBe('Vehicle not found');
  });
});
