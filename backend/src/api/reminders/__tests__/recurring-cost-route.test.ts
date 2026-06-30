/**
 * HTTP characterization of GET /api/v1/reminders/recurring-cost (recurring-expenses T7 backend, C116).
 *
 * The route exposes the C111 recurringCostSummary over the user's ACTIVE expense reminders, normalized
 * to a monthly run-rate — the endpoint the T7 dashboard widget (eyes-on) will fetch. Goes through the
 * REAL stack (route → reminderRepository.findByUserId → reminder-cost helper). Pins:
 *   - a $100 monthly + a $1200 yearly expense reminder → count 2, monthlyTotal $200 ($100 + $100/mo),
 *   - a notification reminder contributes nothing (count/total unchanged),
 *   - a fresh user with no reminders → a clean zero,
 *   - the summary is user-scoped (another user's reminders don't leak in).
 *
 * createTestApp() rewrites env + dynamic-imports DB-bound modules, so keep static imports to the
 * harness + bun:test.
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
    // $100/mo monthly + $1200/yr yearly (=$100/mo) → $200/mo across 2 reminders.
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
    // A notification reminder carries no cost → must not change the summary.
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

    // A second, independent user sees only their own (empty) set.
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
