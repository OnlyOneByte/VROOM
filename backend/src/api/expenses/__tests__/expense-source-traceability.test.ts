/**
 * recurring-expenses T1 (C96) — pins the SOURCE-TRACEABILITY contract on the expense
 * READ path: a reminder-materialized expense must surface `sourceType`/`sourceId` in the
 * GET *HTTP response*, not merely in the DB row.
 *
 * Why this is distinct from trigger-expense.test.ts: that test reads `source_type` straight
 * off sqlite (bypassing serialization), so it stays green even if a future response mapper
 * stripped the field — which would silently break the T6 "Recurring" badge + the T3 cascade
 * UI that key off `sourceType==='reminder'` / `sourceId`. This locks the OBSERVABLE response
 * (the C91-class positive-contract test: the field IS echoed to the client), and the
 * manual-expense case pins that the value reflects reality (null when there's no source),
 * not a hardcoded literal.
 *
 * Goes through the REAL stack (route → trigger service → split/insert → DB → GET serialize).
 * createTestApp() rewrites env + dynamic-imports DB-bound modules, so keep static imports to
 * the harness + bun:test (mirrors trigger-expense.test.ts).
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

/** Minimal shape we assert on — the source-link fields T3/T6 depend on. */
interface ExpenseResponse {
  id: string;
  vehicleId: string;
  category: string;
  amount: number;
  sourceType?: string | null;
  sourceId?: string | null;
}

interface PaginatedExpenses {
  success: true;
  data: ExpenseResponse[];
  pagination: { totalCount: number; limit: number; offset: number; hasMore: boolean };
}

interface TriggerResultShape {
  createdExpenses: Array<{ id: string }>;
  notifications: unknown[];
  skipped: Array<{ reminderId: string; reason: string }>;
}

async function seedVehicle(): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/vehicles', {
    make: 'Honda',
    model: 'Civic',
    year: 2021,
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

/** Create an overdue (past startDate => nextDueDate = startDate) expense reminder. */
async function createOverdueExpenseReminder(vehicleId: string): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/reminders', {
    name: 'Monthly insurance premium',
    type: 'expense',
    frequency: 'monthly',
    startDate: '2024-01-15T00:00:00.000Z', // well in the past => immediately overdue
    vehicleIds: [vehicleId],
    expenseCategory: 'financial',
    expenseAmount: 125.5,
    expenseTags: ['insurance'],
  });
  const body = await json<DataEnvelope<{ reminder: { id: string } }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data.reminder.id;
}

/** Materialize the reminder's due expense(s) via the real trigger path. */
async function triggerAndGetExpenseId(): Promise<void> {
  const res = await ctx.authed('POST', '/api/v1/reminders/trigger');
  const body = await json<DataEnvelope<TriggerResultShape>>(res);
  expect(res.status, JSON.stringify(body)).toBe(200);
  expect(body.data.createdExpenses.length).toBeGreaterThanOrEqual(1);
}

describe('expense source traceability (recurring-expenses T1 — read-path surfacing)', () => {
  test('GET /expenses list echoes sourceType/sourceId for a reminder-materialized expense', async () => {
    const vehicleId = await seedVehicle();
    const reminderId = await createOverdueExpenseReminder(vehicleId);
    await triggerAndGetExpenseId();

    const res = await ctx.authed('GET', '/api/v1/expenses');
    const body = await json<PaginatedExpenses>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);

    const materialized = body.data.find((e) => e.sourceType === 'reminder');
    // The source link is visible in the RESPONSE (not just the DB row) — this is the
    // contract the T6 "Recurring" badge reads. A dropped mapper would fail HERE.
    expect(materialized, 'no expense with sourceType=reminder in GET response').toBeDefined();
    expect(materialized?.sourceId).toBe(reminderId);
  });

  test('GET /expenses/:id echoes the source link', async () => {
    const vehicleId = await seedVehicle();
    const reminderId = await createOverdueExpenseReminder(vehicleId);
    await triggerAndGetExpenseId();

    // Find the materialized row via the list, then fetch it by id.
    const listRes = await ctx.authed('GET', '/api/v1/expenses');
    const list = await json<PaginatedExpenses>(listRes);
    const id = list.data.find((e) => e.sourceType === 'reminder')?.id;
    expect(id, 'no materialized expense found to fetch by id').toBeDefined();

    const res = await ctx.authed('GET', `/api/v1/expenses/${id}`);
    const body = await json<DataEnvelope<ExpenseResponse>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.sourceType).toBe('reminder');
    expect(body.data.sourceId).toBe(reminderId);
  });

  test('a manually-created expense reports no source (null, not a hardcoded value)', async () => {
    const vehicleId = await seedVehicle();
    // Create a plain expense through the API (no reminder source).
    const createRes = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc', // no fuel-specific volume/mileage refinement; a plain manual expense
      expenseAmount: 42,
      date: '2024-03-10T00:00:00.000Z',
    });
    const created = await json<DataEnvelope<ExpenseResponse>>(createRes);
    expect(createRes.status, JSON.stringify(created)).toBe(201);

    const res = await ctx.authed('GET', `/api/v1/expenses/${created.data.id}`);
    const body = await json<DataEnvelope<ExpenseResponse>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    // The field reflects reality — a non-recurring expense has no source link.
    expect(body.data.sourceType ?? null).toBeNull();
    expect(body.data.sourceId ?? null).toBeNull();
  });
});
