/**
 * GET /reminders/recurring-cost returns the monthly run-rate of active expense reminders. Covers the
 * sum across frequencies, notifications contributing nothing, a clean zero for a new user, and user scoping.
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

interface CostSummary {
  count: number;
  monthlyTotal: number;
}

async function createReminder(vehicleId: string, over: Record<string, unknown>): Promise<void> {
  const res = await ctx.authed('POST', '/api/v1/reminders', {
    name: 'R',
    frequency: 'monthly',
    startDate: '2024-01-15T00:00:00.000Z',
    vehicleIds: [vehicleId],
    ...over,
  });
  const body = await json<DataEnvelope<unknown>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
}

async function getSummary(): Promise<CostSummary> {
  const res = await ctx.authed('GET', '/api/v1/reminders/recurring-cost');
  const body = await json<DataEnvelope<CostSummary>>(res);
  expect(res.status, JSON.stringify(body)).toBe(200);
  return body.data;
}

describe('GET /reminders/recurring-cost — monthly recurring run-rate', () => {
  test('sums active expense reminders normalized to a monthly rate; ignores notifications', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    await createReminder(vehicleId, {
      type: 'expense',
      frequency: 'monthly',
      expenseCategory: 'financial',
      expenseAmount: 100,
    });
    await createReminder(vehicleId, {
      type: 'expense',
      frequency: 'yearly',
      expenseCategory: 'financial',
      expenseAmount: 1200,
    });
    await createReminder(vehicleId, { type: 'notification', frequency: 'monthly' });

    const summary = await getSummary();
    expect(summary.count).toBe(2);
    expect(summary.monthlyTotal).toBeCloseTo(200, 6);
  });

  test('a user with no expense reminders gets a clean zero', async () => {
    const summary = await getSummary();
    expect(summary).toEqual({ count: 0, monthlyTotal: 0 });
  });

  test('the summary is user-scoped (no cross-user leak)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    await createReminder(vehicleId, {
      type: 'expense',
      frequency: 'monthly',
      expenseCategory: 'financial',
      expenseAmount: 50,
    });
    expect((await getSummary()).count).toBe(1);

    const other = await createTestApp();
    try {
      const res = await other.authed('GET', '/api/v1/reminders/recurring-cost');
      const body = await json<DataEnvelope<CostSummary>>(res);
      expect(res.status).toBe(200);
      expect(body.data).toEqual({ count: 0, monthlyTotal: 0 });
    } finally {
      other.close();
    }
  });
});
