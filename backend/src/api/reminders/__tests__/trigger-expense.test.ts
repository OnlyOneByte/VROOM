/**
 * The expense-reminder trigger creates expense rows when a recurring reminder comes due. Covers the
 * template, no duplicates across repeated triggers, and endDate bounding catch-up. Runs through the real
 * stack and reads rows from sqlite. Keep static imports to the harness and bun:test.
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
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const reminderId = await createOverdueExpenseReminder(vehicleId);

    const res = await ctx.authed('POST', '/api/v1/reminders/trigger');
    const body = await json<DataEnvelope<TriggerResultShape>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.createdExpenses.length).toBeGreaterThanOrEqual(1);

    const rows = expensesForReminder(reminderId);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const first = rows[0];
    // The expense carries the reminder's template, not defaults.
    expect(first.category).toBe('financial');
    expect(first.expense_amount).toBe(12550); // $125.50 stored as cents
    expect(first.vehicle_id).toBe(vehicleId);
    expect(first.source_type).toBe('reminder');
    expect(first.source_id).toBe(reminderId);
    // tags are stored as a JSON array string
    expect(first.tags ?? '').toContain('insurance');

    const after = reminderRow(reminderId);
    expect(after.is_active).toBe(1);
  });

  test('triggering twice does not duplicate the already-processed period', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const reminderId = await createOverdueExpenseReminder(vehicleId);

    await ctx.authed('POST', '/api/v1/reminders/trigger');
    const countAfterFirst = expensesForReminder(reminderId).length;
    expect(countAfterFirst).toBeGreaterThanOrEqual(1);

    // nextDueDate has already advanced past now, so the same periods must not be re-created.
    await ctx.authed('POST', '/api/v1/reminders/trigger');
    const countAfterSecond = expensesForReminder(reminderId).length;
    expect(countAfterSecond).toBe(countAfterFirst);
  });

  // The final catch-up advance can step past endDate without the in-loop check seeing it. Weekly history
  // with endDate just before the final step keeps the loop well under the catch-up cap.
  test('a bounded reminder whose endDate lands at the natural loop exit (under the catch-up cap) is deactivated, not left active', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });

    // Relative to the clock: occurrences at -24/-17/-10/-3 days, then a final advance to +4 days.
    // endDate sits between -3 days and +4 days, so only the post-loop guard sees it.
    const DAY = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const reminderId = await createOverdueExpenseReminder(vehicleId, {
      frequency: 'weekly',
      startDate: new Date(now - 24 * DAY).toISOString(),
      endDate: new Date(now - 1000).toISOString(),
    });

    const res = await ctx.authed('POST', '/api/v1/reminders/trigger');
    expect(res.status).toBe(200);

    const after = reminderRow(reminderId);
    // Past its endDate and fully lapsed → deactivated, NOT left active with a future nextDueDate.
    expect(after.is_active).toBe(0);
    // And triggering again creates no further expenses (it's inactive / findOverdue won't return it).
    const countAfter = expensesForReminder(reminderId).length;
    await ctx.authed('POST', '/api/v1/reminders/trigger');
    expect(expensesForReminder(reminderId).length).toBe(countAfter);
  });

  test('endDate bounds catch-up to the in-window occurrences, then deactivates', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    // Monthly from Jan 15 with endDate Apr 1: exactly the Jan, Feb, and Mar occurrences are materialized.
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

/** Seed two vehicles, return their ids. */
async function seedTwoVehicles(): Promise<[string, string]> {
  const a = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
  const b = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
  return [a, b];
}

interface SplitRowDb extends ExpenseRowDb {
  group_id: string | null;
  group_total: number | null;
  split_method: string | null;
}

function splitRowsForReminder(reminderId: string): SplitRowDb[] {
  return ctx.sqlite
    .query(
      'SELECT id, category, expense_amount, tags, source_type, source_id, vehicle_id, group_id, group_total, split_method FROM expenses WHERE source_type = ? AND source_id = ? ORDER BY vehicle_id'
    )
    .all('reminder', reminderId) as SplitRowDb[];
}

describe('expense-reminder trigger — split materialization', () => {
  test('an even-split expense reminder materializes one sibling per vehicle, shares summing to the amount, all source-linked', async () => {
    const [v1, v2] = await seedTwoVehicles();
    const reminderId = await createOverdueExpenseReminder(v1, {
      vehicleIds: [v1, v2],
      expenseAmount: 100,
      expenseSplitConfig: { method: 'even', vehicleIds: [v1, v2] },
    });

    const res = await ctx.authed('POST', '/api/v1/reminders/trigger');
    expect(res.status).toBe(200);

    // First period materializes 2 siblings (one per vehicle). The reminder may catch up
    // additional months (overdue since Jan 2024) — assert on the FIRST period's group.
    const rows = splitRowsForReminder(reminderId);
    expect(rows.length).toBeGreaterThanOrEqual(2);

    // Group the rows by groupId; each group is one period's split.
    const byGroup = new Map<string, SplitRowDb[]>();
    for (const r of rows) {
      const g = r.group_id ?? 'none';
      byGroup.set(g, [...(byGroup.get(g) ?? []), r]);
    }
    // Every group: 2 siblings, 5000c each, summing to the 10000c ($100) template, both source-linked.
    for (const siblings of byGroup.values()) {
      expect(siblings).toHaveLength(2);
      const sum = siblings.reduce((s, r) => s + r.expense_amount, 0);
      expect(sum).toBe(10000); // $100 → 10000 cents
      for (const r of siblings) {
        expect(r.expense_amount).toBe(5000);
        expect(r.split_method).toBe('even');
        expect(r.group_total).toBe(10000);
        expect(r.source_type).toBe('reminder');
        expect(r.source_id).toBe(reminderId);
      }
      // Siblings cover distinct vehicles.
      expect(new Set(siblings.map((r) => r.vehicle_id)).size).toBe(2);
    }
  });

  test('a percentage-split expense reminder materializes shares by percentage, summing to the amount', async () => {
    const [v1, v2] = await seedTwoVehicles();
    const reminderId = await createOverdueExpenseReminder(v1, {
      vehicleIds: [v1, v2],
      expenseAmount: 200,
      expenseSplitConfig: {
        method: 'percentage',
        allocations: [
          { vehicleId: v1, percentage: 75 },
          { vehicleId: v2, percentage: 25 },
        ],
      },
    });

    const res = await ctx.authed('POST', '/api/v1/reminders/trigger');
    expect(res.status).toBe(200);

    const rows = splitRowsForReminder(reminderId);
    expect(rows.length).toBeGreaterThanOrEqual(2);

    const byGroup = new Map<string, SplitRowDb[]>();
    for (const r of rows) {
      const g = r.group_id ?? 'none';
      byGroup.set(g, [...(byGroup.get(g) ?? []), r]);
    }
    for (const siblings of byGroup.values()) {
      expect(siblings).toHaveLength(2);
      const sum = siblings.reduce((s, r) => s + r.expense_amount, 0);
      expect(sum).toBe(20000); // $200 → 20000 cents
      // v1 gets 75% = 15000c, v2 gets 25% = 5000c.
      const byVehicle = new Map(siblings.map((r) => [r.vehicle_id, r.expense_amount]));
      expect(byVehicle.get(v1)).toBe(15000);
      expect(byVehicle.get(v2)).toBe(5000);
      for (const r of siblings) {
        expect(r.split_method).toBe('percentage');
        expect(r.source_id).toBe(reminderId);
      }
    }
  });
});

// A split config keeps its vehicle ids in a JSON blob, so deleting a vehicle leaves a stale leg behind.
// The next trigger's insert for that leg fails on the foreign key. This characterizes that failure and
// pins that it stays contained to the one reminder.
describe('a split reminder naming a deleted vehicle is contained to that reminder', () => {
  test('the deleted vehicle never gets a sibling + the reminder is reported skipped; an independent reminder still fires; run returns 200', async () => {
    const [v1, v2] = await seedTwoVehicles();
    const v3 = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });

    // A split reminder over v1+v2, and an independent single-vehicle reminder on v3 (the control).
    const splitReminderId = await createOverdueExpenseReminder(v1, {
      vehicleIds: [v1, v2],
      expenseAmount: 100,
      expenseSplitConfig: { method: 'even', vehicleIds: [v1, v2] },
    });
    const okReminderId = await createOverdueExpenseReminder(v3, { expenseAmount: 40 });

    // Delete v2 — the junction row is FK-cascade-cleaned, but expenseSplitConfig still names v2.
    const del = await ctx.authed('DELETE', `/api/v1/vehicles/${v2}`);
    expect(del.status, await del.text()).toBe(200);

    const res = await ctx.authed('POST', '/api/v1/reminders/trigger');
    // The run does NOT 500 — the per-reminder catch contains the FK violation.
    expect(res.status).toBe(200);
    const body = await json<DataEnvelope<TriggerResultShape>>(res);

    // The deleted vehicle never gets a sibling, and the reminder is reported as skipped.
    const rows = splitRowsForReminder(splitReminderId);
    expect(rows.some((r) => r.vehicle_id === v2)).toBe(false);
    expect(body.data.skipped.some((s) => s.reminderId === splitReminderId)).toBe(true);

    // The CONTAINMENT guarantee: the independent reminder still fired despite the bad one.
    expect(expensesForReminder(okReminderId).length).toBeGreaterThanOrEqual(1);
  });
});
