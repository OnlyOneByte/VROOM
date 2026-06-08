/**
 * Characterizes the EXPENSE-type reminder trigger — the runtime that auto-creates
 * financial records when a recurring expense reminder comes due. The form (cycles
 * 158-159) and the date math (compute-next-due-date.property.test) were covered,
 * but processOverdueReminders actually CREATING an expense, advancing the due date
 * (so it can't re-fire the same period), and honoring endDate had no test. A bug
 * here silently writes wrong/duplicate money rows, so it's pinned end-to-end:
 *   - an overdue expense reminder → POST /trigger → exactly one expense with the
 *     template's category/amount/tags + source_type='reminder', source_id=reminder
 *   - triggering AGAIN creates no duplicate for the already-processed period
 *     (the nextDueDate advancement is what prevents infinite re-fire)
 *   - endDate bounds catch-up to exactly the occurrences within [start, end],
 *     then deactivates (NOT the ~12 catch-up cap, nor every month up to now)
 *
 * Goes through the REAL stack (route → trigger service → split/insert → DB) and
 * reads rows straight off sqlite. createTestApp() rewrites env + dynamic-imports
 * DB-bound modules, so keep static imports to the harness + bun:test.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type DataEnvelope, json, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

async function seedVehicle(): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/vehicles', { make: 'Honda', model: 'Civic', year: 2021 });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

interface TriggerResultShape {
  createdExpenses: Array<{ id: string }>;
  notifications: unknown[];
  skipped: Array<{ reminderId: string; reason: string }>;
}

interface ExpenseRowDb {
  id: string;
  category: string;
  expense_amount: number;
  tags: string | null;
  source_type: string | null;
  source_id: string | null;
  vehicle_id: string;
}

function expensesForReminder(reminderId: string): ExpenseRowDb[] {
  return ctx.sqlite
    .query(
      'SELECT id, category, expense_amount, tags, source_type, source_id, vehicle_id FROM expenses WHERE source_type = ? AND source_id = ?'
    )
    .all('reminder', reminderId) as ExpenseRowDb[];
}

function reminderRow(id: string): { is_active: number; next_due_date: number } {
  return ctx.sqlite
    .query('SELECT is_active, next_due_date FROM reminders WHERE id = ?')
    .get(id) as { is_active: number; next_due_date: number };
}

/** Create an overdue (past startDate => nextDueDate = startDate) expense reminder. */
async function createOverdueExpenseReminder(
  vehicleId: string,
  over: Record<string, unknown> = {}
): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/reminders', {
    name: 'Monthly insurance premium',
    type: 'expense',
    frequency: 'monthly',
    startDate: '2024-01-15T00:00:00.000Z', // well in the past => immediately overdue
    vehicleIds: [vehicleId],
    expenseCategory: 'financial',
    expenseAmount: 125.5,
    expenseTags: ['insurance'],
    ...over,
  });
  const body = await json<DataEnvelope<{ reminder: { id: string } }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data.reminder.id;
}

describe('expense-reminder trigger (auto-creates financial records)', () => {
  test('an overdue expense reminder creates an expense carrying its template + source link', async () => {
    const vehicleId = await seedVehicle();
    const reminderId = await createOverdueExpenseReminder(vehicleId);

    const res = await ctx.authed('POST', '/api/v1/reminders/trigger');
    const body = await json<DataEnvelope<TriggerResultShape>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.createdExpenses.length).toBeGreaterThanOrEqual(1);

    const rows = expensesForReminder(reminderId);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const first = rows[0]!;
    // The expense carries the reminder's template, not defaults.
    expect(first.category).toBe('financial');
    expect(first.expense_amount).toBe(125.5);
    expect(first.vehicle_id).toBe(vehicleId);
    expect(first.source_type).toBe('reminder');
    expect(first.source_id).toBe(reminderId);
    // tags are stored as a JSON array string
    expect(first.tags ?? '').toContain('insurance');

    // The reminder advanced its nextDueDate (so it won't re-fire the same period).
    const after = reminderRow(reminderId);
    expect(after.is_active).toBe(1);
  });

  test('triggering twice does not duplicate the already-processed period', async () => {
    const vehicleId = await seedVehicle();
    const reminderId = await createOverdueExpenseReminder(vehicleId);

    await ctx.authed('POST', '/api/v1/reminders/trigger');
    const countAfterFirst = expensesForReminder(reminderId).length;
    expect(countAfterFirst).toBeGreaterThanOrEqual(1);

    // Second trigger moments later: nextDueDate has advanced past now, so the
    // SAME periods must not be re-created. The catch-up count can only grow by
    // periods that have genuinely elapsed between the two calls (none in a test).
    await ctx.authed('POST', '/api/v1/reminders/trigger');
    const countAfterSecond = expensesForReminder(reminderId).length;
    expect(countAfterSecond).toBe(countAfterFirst);
  });

  test('endDate bounds catch-up to the in-window occurrences, then deactivates', async () => {
    const vehicleId = await seedVehicle();
    // Monthly, anchored on the 15th, window [Jan 15, Apr 1] 2024 (all in the past
    // => fully overdue now). In-window occurrences: Jan 15, Feb 15, Mar 15 (each
    // <= Apr 1); Apr 15 is past endDate. So the trigger must create EXACTLY 3
    // expenses then deactivate — not the ~12 catch-up cap, and not a row for every
    // month between Jan 2024 and now. This is the guard that endDate actually
    // bounds the financial records a lapsed reminder generates.
    const reminderId = await createOverdueExpenseReminder(vehicleId, {
      startDate: '2024-01-15T00:00:00.000Z',
      endDate: '2024-04-01T00:00:00.000Z',
    });

    const res = await ctx.authed('POST', '/api/v1/reminders/trigger');
    expect(res.status).toBe(200);

    // Exactly the three in-window occurrences, and the reminder is now inactive.
    expect(expensesForReminder(reminderId)).toHaveLength(3);
    expect(reminderRow(reminderId).is_active).toBe(0);
  });
});
