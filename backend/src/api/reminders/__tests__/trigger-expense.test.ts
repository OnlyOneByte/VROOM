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

async function createOverdueExpenseReminder(
  vehicleId: string,
  over: Record<string, unknown> = {}
): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/reminders', {
    name: 'Monthly insurance premium',
    type: 'expense',
    frequency: 'monthly',
    startDate: '2024-01-15T00:00:00.000Z',
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
    expect(first.category).toBe('financial');
    expect(first.expense_amount).toBe(12550);
    expect(first.vehicle_id).toBe(vehicleId);
    expect(first.source_type).toBe('reminder');
    expect(first.source_id).toBe(reminderId);
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

    await ctx.authed('POST', '/api/v1/reminders/trigger');
    const countAfterSecond = expensesForReminder(reminderId).length;
    expect(countAfterSecond).toBe(countAfterFirst);
  });

  test('a bounded reminder whose endDate lands at the natural loop exit (under the catch-up cap) is deactivated, not left active', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });

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
    expect(after.is_active).toBe(0);
    const countAfter = expensesForReminder(reminderId).length;
    await ctx.authed('POST', '/api/v1/reminders/trigger');
    expect(expensesForReminder(reminderId).length).toBe(countAfter);
  });

  test('endDate bounds catch-up to the in-window occurrences, then deactivates', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const reminderId = await createOverdueExpenseReminder(vehicleId, {
      startDate: '2024-01-15T00:00:00.000Z',
      endDate: '2024-04-01T00:00:00.000Z',
    });

    const res = await ctx.authed('POST', '/api/v1/reminders/trigger');
    expect(res.status).toBe(200);

    expect(expensesForReminder(reminderId)).toHaveLength(3);
    expect(reminderRow(reminderId).is_active).toBe(0);
  });
});

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
      expect(sum).toBe(10000);
      for (const r of siblings) {
        expect(r.expense_amount).toBe(5000);
        expect(r.split_method).toBe('even');
        expect(r.group_total).toBe(10000);
        expect(r.source_type).toBe('reminder');
        expect(r.source_id).toBe(reminderId);
      }
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
      expect(sum).toBe(20000);
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

describe('a split reminder naming a deleted vehicle is contained to that reminder', () => {
  test('the deleted vehicle never gets a sibling + the reminder is reported skipped; an independent reminder still fires; run returns 200', async () => {
    const [v1, v2] = await seedTwoVehicles();
    const v3 = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });

    const splitReminderId = await createOverdueExpenseReminder(v1, {
      vehicleIds: [v1, v2],
      expenseAmount: 100,
      expenseSplitConfig: { method: 'even', vehicleIds: [v1, v2] },
    });
    const okReminderId = await createOverdueExpenseReminder(v3, { expenseAmount: 40 });

    const del = await ctx.authed('DELETE', `/api/v1/vehicles/${v2}`);
    expect(del.status, await del.text()).toBe(200);

    const res = await ctx.authed('POST', '/api/v1/reminders/trigger');
    expect(res.status).toBe(200);
    const body = await json<DataEnvelope<TriggerResultShape>>(res);

    const rows = splitRowsForReminder(splitReminderId);
    expect(rows.some((r) => r.vehicle_id === v2)).toBe(false);
    expect(body.data.skipped.some((s) => s.reminderId === splitReminderId)).toBe(true);

    expect(expensesForReminder(okReminderId).length).toBeGreaterThanOrEqual(1);
  });
});
