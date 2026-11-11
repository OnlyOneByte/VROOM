/**
 * HTTP tests for GET /insurance/expiring-soon. A non-numeric or out-of-range `days` must fall back or clamp,
 * never produce an Invalid Date that silently hides expiring terms.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

interface ExpiringResponse {
  success: boolean;
  data: Array<{ id: string; endDate: string }>;
  count: number;
  daysAhead: number;
  limit: number;
}

/** Seeds a policy whose term ends in about 20 days, inside the default 30-day window. */
async function seedSoonExpiringTerm(vehicleId: string): Promise<string> {
  const start = new Date();
  start.setDate(start.getDate() - 345);
  const end = new Date();
  end.setDate(end.getDate() + 20);
  const res = await ctx.authed('POST', '/api/v1/insurance', {
    company: 'Acme Mutual',
    terms: [
      {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        policyNumber: 'POL-EXP',
        totalCost: 1200,
        vehicleCoverage: { vehicleIds: [vehicleId] },
      },
    ],
  });
  const body = await json<DataEnvelope<{ terms: Array<{ id: string }> }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data.terms[0].id;
}

describe('GET /insurance/expiring-soon', () => {
  test('the default window finds a term expiring in about 20 days', async () => {
    const vid = await seedVehicle(ctx);
    const termId = await seedSoonExpiringTerm(vid);

    const res = await ctx.authed('GET', '/api/v1/insurance/expiring-soon');
    const body = await json<ExpiringResponse>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.some((t) => t.id === termId)).toBe(true);
    expect(body.daysAhead).toBe(30);
  });

  test('a non-numeric days value falls back to the 30-day default', async () => {
    const vid = await seedVehicle(ctx);
    const termId = await seedSoonExpiringTerm(vid);

    const res = await ctx.authed('GET', '/api/v1/insurance/expiring-soon?days=abc');
    const body = await json<ExpiringResponse>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.daysAhead).toBe(30);
    expect(body.data.some((t) => t.id === termId)).toBe(true);
  });

  test('an explicit valid `?days=45` is honored', async () => {
    const vid = await seedVehicle(ctx);
    const termId = await seedSoonExpiringTerm(vid);

    const res = await ctx.authed('GET', '/api/v1/insurance/expiring-soon?days=45');
    const body = await json<ExpiringResponse>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.daysAhead).toBe(45);
    expect(body.data.some((t) => t.id === termId)).toBe(true);
  });

  test('an out-of-range days value clamps to the 366-day ceiling', async () => {
    await seedVehicle(ctx);
    const res = await ctx.authed('GET', '/api/v1/insurance/expiring-soon?days=99999');
    const body = await json<ExpiringResponse>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.daysAhead).toBe(366);
  });
});
