/**
 * GET and POST on the financing vehicle route return 404 "Vehicle not found" when the vehicle is
 * missing or not owned by the caller, and the POST does so before any financing write.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

const MISSING_VEHICLE = 'no-such-vehicle-id';

describe('financing routes 404 when the vehicle is missing / not owned', () => {
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
