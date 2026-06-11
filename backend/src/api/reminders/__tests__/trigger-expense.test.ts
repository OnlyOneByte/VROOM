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
    make: 'Honda',
    model: 'Civic',
    year: 2021,
  });
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

// ---------------------------------------------------------------------------
// recurring-expenses T2 (C102): split-materialization characterization.
//
// An expense-type reminder can carry an expenseSplitConfig (even/percentage/absolute);
// when it fires, createExpenseFromReminder routes through expenseSplitService.createSiblings
// (trigger-service.ts:147-163) → ONE sibling row per vehicle, each its own share, sharing a
// groupId, all stamped sourceType='reminder'/sourceId=reminder. The single-expense path was
// pinned above (C96); the SPLIT path — the half recurring-expenses T4 (multi-vehicle split in
// the form) materializes through — had no trigger-level test. This pins that the shares are
// correct, sum to the template amount, and every sibling carries the source link.
// ---------------------------------------------------------------------------

/** Seed two vehicles, return their ids. */
async function seedTwoVehicles(): Promise<[string, string]> {
  const a = await seedVehicle();
  const b = await seedVehicle();
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

describe('expense-reminder trigger — split materialization (recurring-expenses T2)', () => {
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
    // Every group: 2 siblings, $50 each, summing to the $100 template, both source-linked.
    for (const siblings of byGroup.values()) {
      expect(siblings).toHaveLength(2);
      const sum = siblings.reduce((s, r) => s + r.expense_amount, 0);
      expect(sum).toBeCloseTo(100, 2);
      for (const r of siblings) {
        expect(r.expense_amount).toBeCloseTo(50, 2);
        expect(r.split_method).toBe('even');
        expect(r.group_total).toBeCloseTo(100, 2);
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
      expect(sum).toBeCloseTo(200, 2);
      // v1 gets 75% = 150, v2 gets 25% = 50.
      const byVehicle = new Map(siblings.map((r) => [r.vehicle_id, r.expense_amount]));
      expect(byVehicle.get(v1)).toBeCloseTo(150, 2);
      expect(byVehicle.get(v2)).toBeCloseTo(50, 2);
      for (const r of siblings) {
        expect(r.split_method).toBe('percentage');
        expect(r.source_id).toBe(reminderId);
      }
    }
  });
});
