/**
 * In-process HTTP tests for GET /api/v1/insurance/expiring-soon — through the REAL stack.
 *
 * #70 (data-correctness, C210): the `days` query param was Number.parseInt'd with NO finite-guard
 * (unlike its sibling `limit`, guarded right beside it). A non-numeric `?days=` → NaN →
 * `endDate = new Date(now + NaN)` = Invalid Date → the BETWEEN range query silently matched NOTHING,
 * so "expiring soon" falsely reported ZERO expiring policies and the user missed a renewal nag. The
 * fix guards + clamps `days` like `limit`. These pin: a malformed days still finds an expiring term
 * (the regression), the valid path works, and the clamp holds.
 *
 * createTestApp() rewrites process.env + dynamic-imports the DB-bound modules, so this file imports
 * only the harness.
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

async function seedVehicle(): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/vehicles', {
    make: 'Toyota',
    model: 'Camry',
    year: 2022,
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

interface ExpiringResponse {
  success: boolean;
  data: Array<{ id: string; endDate: string }>;
  count: number;
  daysAhead: number;
  limit: number;
}

/**
 * Seed a policy whose single term ends ~20 days from now — so it falls inside the default 30-day
 * "expiring soon" window. Returns the term id.
 */
async function seedSoonExpiringTerm(vehicleId: string): Promise<string> {
  const start = new Date();
  start.setDate(start.getDate() - 345); // ~a year ago
  const end = new Date();
  end.setDate(end.getDate() + 20); // expires in ~20 days → within 30-day window
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

describe('GET /insurance/expiring-soon — #70 malformed `days` must not silently hide expiring terms', () => {
  test('the default window finds a ~20-days-out term (baseline)', async () => {
    const vid = await seedVehicle();
    const termId = await seedSoonExpiringTerm(vid);

    const res = await ctx.authed('GET', '/api/v1/insurance/expiring-soon');
    const body = await json<ExpiringResponse>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.some((t) => t.id === termId)).toBe(true);
    expect(body.daysAhead).toBe(30);
  });

  test('REGRESSION: a non-numeric `?days=abc` falls back to the 30-day default (was: Invalid Date → empty)', async () => {
    const vid = await seedVehicle();
    const termId = await seedSoonExpiringTerm(vid);

    const res = await ctx.authed('GET', '/api/v1/insurance/expiring-soon?days=abc');
    const body = await json<ExpiringResponse>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    // Pre-fix: NaN → Invalid Date → BETWEEN matched nothing → the term vanished from the nag.
    expect(body.daysAhead).toBe(30);
    expect(body.data.some((t) => t.id === termId)).toBe(true);
  });

  test('an explicit valid `?days=45` is honored', async () => {
    const vid = await seedVehicle();
    const termId = await seedSoonExpiringTerm(vid);

    const res = await ctx.authed('GET', '/api/v1/insurance/expiring-soon?days=45');
    const body = await json<ExpiringResponse>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.daysAhead).toBe(45);
    expect(body.data.some((t) => t.id === termId)).toBe(true);
  });

  test('an absurd `?days=99999` clamps to the 366-day ceiling (no unbounded window)', async () => {
    await seedVehicle();
    const res = await ctx.authed('GET', '/api/v1/insurance/expiring-soon?days=99999');
    const body = await json<ExpiringResponse>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.daysAhead).toBe(366);
  });
});
