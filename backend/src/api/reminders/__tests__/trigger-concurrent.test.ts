/**
 * Concurrency guard for POST /reminders/trigger: a reminder period is materialized AT MOST ONCE,
 * no matter how many triggers run at the same time.
 *
 * Two triggers overlap routinely — the root layout fires `maybeTriggerRecurring()` on every authed
 * load (its once-per-day stamp is written only AFTER the POST resolves) while the user can press
 * "Run due reminders" on /reminders, and two tabs or two devices do it on their own. Both requests
 * read the same `nextDueDate` from `findOverdue`, so without a real claim both materialize every
 * overdue period: a 12-period monthly reminder writes 24 expense rows and doubles every total.
 *
 * The invariant this pins: each period is claimed by a compare-and-swap on `nextDueDate` INSIDE the
 * same synchronous transaction that writes the money row, so the loser of the claim writes nothing
 * (and reports a `concurrent_trigger` skip) instead of duplicating the period.
 *
 * The second describe block pins the other half of that invariant — the claim and the money rows
 * commit or roll back TOGETHER — because a claim that outlives a failed insert is the mirror defect:
 * the period is marked done while nothing (or half a split group) was written.
 *
 * createTestApp() rewrites env + dynamic-imports DB-bound modules — keep static imports to the
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

async function createOverdueReminder(
  vehicleId: string,
  overrides: Record<string, unknown> = {}
): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/reminders', {
    name: 'Monthly premium',
    type: 'expense',
    frequency: 'monthly',
    startDate: '2024-01-15T00:00:00.000Z', // long past => many overdue periods
    vehicleIds: [vehicleId],
    expenseCategory: 'financial',
    expenseAmount: 100,
    ...overrides,
  });
  const body = await json<DataEnvelope<{ reminder: { id: string } }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data.reminder.id;
}

function materializedRows(reminderId: string): Array<{ date: number; n: number }> {
  return ctx.sqlite
    .query(
      `SELECT date, COUNT(*) AS n FROM expenses
       WHERE source_type = 'reminder' AND source_id = ?
       GROUP BY date ORDER BY date`
    )
    .all(reminderId) as Array<{ date: number; n: number }>;
}

function notificationRows(reminderId: string): Array<{ due_date: number; n: number }> {
  return ctx.sqlite
    .query(
      `SELECT due_date, COUNT(*) AS n FROM reminder_notifications
       WHERE reminder_id = ? GROUP BY due_date ORDER BY due_date`
    )
    .all(reminderId) as Array<{ due_date: number; n: number }>;
}

describe('POST /reminders/trigger under concurrency', () => {
  test('two overlapping triggers materialize each expense period exactly once', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const reminderId = await createOverdueReminder(vehicleId);

    const [a, b] = await Promise.all([
      ctx.authed('POST', '/api/v1/reminders/trigger'),
      ctx.authed('POST', '/api/v1/reminders/trigger'),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    const periods = materializedRows(reminderId);
    expect(periods.length).toBeGreaterThan(1); // the reminder really was multi-period overdue
    const duplicated = periods.filter((p) => p.n !== 1);
    expect(duplicated).toEqual([]);

    // The union of what the two responses report is exactly what landed in the DB — neither
    // request claims a row it did not write.
    const bodyA = await json<DataEnvelope<{ createdExpenses: unknown[] }>>(a);
    const bodyB = await json<DataEnvelope<{ createdExpenses: unknown[] }>>(b);
    const reported = bodyA.data.createdExpenses.length + bodyB.data.createdExpenses.length;
    expect(reported).toBe(periods.length);
  });

  test('two overlapping triggers write each notification period exactly once', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const reminderId = await createOverdueReminder(vehicleId, {
      type: 'notification',
      expenseCategory: null,
      expenseAmount: null,
    });

    const [a, b] = await Promise.all([
      ctx.authed('POST', '/api/v1/reminders/trigger'),
      ctx.authed('POST', '/api/v1/reminders/trigger'),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    const periods = notificationRows(reminderId);
    expect(periods.length).toBeGreaterThan(1);
    expect(periods.filter((p) => p.n !== 1)).toEqual([]);
  });

  test('a split reminder keeps its legs summing to the group total under concurrency', async () => {
    const first = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const second = await seedVehicle(ctx, { make: 'Mazda', model: '3', year: 2019 });
    const reminderId = await createOverdueReminder(first, {
      vehicleIds: [first, second],
      expenseSplitConfig: { method: 'even', vehicleIds: [first, second] },
    });

    await Promise.all([
      ctx.authed('POST', '/api/v1/reminders/trigger'),
      ctx.authed('POST', '/api/v1/reminders/trigger'),
    ]);

    // Every split group is complete (both legs present) and sums to its own groupTotal — a
    // half-written group is the failure mode an insert that aborts mid-split would leave behind.
    const groups = ctx.sqlite
      .query(
        `SELECT group_id, COUNT(*) AS legs, SUM(expense_amount) AS total, MAX(group_total) AS declared
         FROM expenses WHERE source_type = 'reminder' AND source_id = ? GROUP BY group_id`
      )
      .all(reminderId) as Array<{ legs: number; total: number; declared: number }>;
    expect(groups.length).toBeGreaterThan(1);
    for (const group of groups) {
      expect(group.legs).toBe(2);
      expect(group.total).toBe(group.declared);
    }

    // One group per period, not two.
    const perDate = materializedRows(reminderId);
    expect(perDate.filter((p) => p.n !== 2)).toEqual([]);
  });
});

describe('a reminder period commits all-or-nothing', () => {
  test('a split leg that cannot be written leaves no partial group and keeps the period due', async () => {
    const live = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const doomed = await seedVehicle(ctx, { make: 'Mazda', model: '3', year: 2019 });
    // One overdue period only, so the assertions below are about a single period's materialization.
    const dueDate = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const reminderId = await createOverdueReminder(live, {
      startDate: dueDate,
      vehicleIds: [live, doomed],
      expenseSplitConfig: { method: 'even', vehicleIds: [live, doomed] },
    });

    // Delete the second vehicle WITHOUT the route's split-config prune, so the reminder's split
    // config still names it: the first leg inserts fine and the second violates the vehicle FK.
    ctx.sqlite.run('DELETE FROM vehicles WHERE id = ?', [doomed]);
    const dueBefore = ctx.sqlite
      .query('SELECT next_due_date, last_triggered_at FROM reminders WHERE id = ?')
      .get(reminderId) as { next_due_date: number; last_triggered_at: number | null };

    const res = await ctx.authed('POST', '/api/v1/reminders/trigger');
    expect(res.status).toBe(200);
    const body =
      await json<
        DataEnvelope<{ createdExpenses: unknown[]; skipped: Array<{ reminderId: string }> }>
      >(res);
    expect(body.data.createdExpenses).toEqual([]);
    expect(body.data.skipped.map((s) => s.reminderId)).toEqual([reminderId]);

    // Nothing survived the failed period — no orphan leg whose group cannot sum to its total.
    expect(materializedRows(reminderId)).toEqual([]);
    // And the period is still due, so a later trigger (once the config is pruned) can materialize
    // it — a period marked done with no money row is silent data loss.
    const dueAfter = ctx.sqlite
      .query('SELECT next_due_date, last_triggered_at FROM reminders WHERE id = ?')
      .get(reminderId) as { next_due_date: number; last_triggered_at: number | null };
    expect(dueAfter.next_due_date).toBe(dueBefore.next_due_date);
    expect(dueAfter.last_triggered_at).toBe(dueBefore.last_triggered_at);
  });
});
