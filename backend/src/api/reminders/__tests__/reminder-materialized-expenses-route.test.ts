/**
 * HTTP characterization of GET /api/v1/reminders/:id/expenses (recurring-expenses T6 backend, C122).
 *
 * The route lists the expense rows a reminder has MATERIALIZED (via findBySource('reminder', id,
 * userId)) — the read seam the T6 "this reminder created N expenses" UI will fetch. Goes through the
 * REAL stack (route → ownership check → expenseRepository.findBySource). Pins:
 *   - an expense reminder → trigger → GET /:id/expenses returns the materialized rows, all
 *     source-linked to the reminder ($125.50 template),
 *   - a notification reminder (materializes nothing) → [],
 *   - ownership-scoped: a random/foreign reminder id → 404, and one user's reminder is invisible to
 *     another user.
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

interface ExpenseRow {
  id: string;
  expenseAmount: number;
  sourceType: string | null;
  sourceId: string | null;
}

async function createReminder(over: Record<string, unknown>): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/reminders', {
    name: 'R',
    frequency: 'monthly',
    startDate: '2024-01-15T00:00:00.000Z',
    ...over,
  });
  const body = await json<DataEnvelope<{ reminder: { id: string } }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data.reminder.id;
}

async function getMaterialized(reminderId: string): Promise<Response> {
  return ctx.authed('GET', `/api/v1/reminders/${reminderId}/expenses`);
}

describe('GET /reminders/:id/expenses — materialized expense rows', () => {
  test('an expense reminder returns its materialized, source-linked rows after a trigger', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const reminderId = await createReminder({
      type: 'expense',
      vehicleIds: [vehicleId],
      expenseCategory: 'financial',
      expenseAmount: 125.5,
    });
    // Materialize: process overdue reminders (startDate is in the past → immediately due).
    await ctx.authed('POST', '/api/v1/reminders/trigger');

    const res = await getMaterialized(reminderId);
    const body = await json<DataEnvelope<ExpenseRow[]>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    // Every returned row is genuinely linked to THIS reminder.
    for (const row of body.data) {
      expect(row.sourceType).toBe('reminder');
      expect(row.sourceId).toBe(reminderId);
      expect(row.expenseAmount).toBeCloseTo(125.5, 2);
    }
  });

  test('a notification reminder (materializes nothing) returns an empty list', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const reminderId = await createReminder({ type: 'notification', vehicleIds: [vehicleId] });
    await ctx.authed('POST', '/api/v1/reminders/trigger');

    const res = await getMaterialized(reminderId);
    const body = await json<DataEnvelope<ExpenseRow[]>>(res);
    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
  });

  test('a non-existent reminder id is a 404 (ownership-checked)', async () => {
    const res = await getMaterialized('rem-does-not-exist');
    expect(res.status).toBe(404);
  });

  test("another user's reminder is invisible (404, not a cross-tenant read)", async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const reminderId = await createReminder({
      type: 'expense',
      vehicleIds: [vehicleId],
      expenseCategory: 'financial',
      expenseAmount: 99,
    });
    // A second, independent user must not be able to read user 1's reminder's expenses.
    const other = await createTestApp();
    try {
      const res = await other.authed('GET', `/api/v1/reminders/${reminderId}/expenses`);
      expect(res.status).toBe(404);
    } finally {
      other.close();
    }
  });
});
