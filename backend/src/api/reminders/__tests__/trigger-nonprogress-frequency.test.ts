/**
 * Corrupt advance configs (unknown frequency, zero interval) must be skipped with zero expense rows.
 * Left unchecked, the catch-up loop would write up to maxCatchUp duplicates at the same date.
 * Zod blocks these on the API, so the rows are seeded directly via sqlite.
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
  createdExpenses: unknown[];
  notifications: unknown[];
  skipped: Array<{ reminderId: string; reason: string; message?: string }>;
}

/** Seeds an expense reminder with a corrupt advance config, lapsed past the catch-up cap. */
function seedCorruptExpenseReminder(
  id: string,
  vehicleId: string,
  opts: { frequency: string; intervalValue: number; intervalUnit: string }
): void {
  ctx.sqlite.run(
    `INSERT INTO reminders
       (id, user_id, name, type, action_mode, frequency, interval_value, interval_unit,
        trigger_mode, start_date, next_due_date, is_active, expense_amount, expense_category)
     VALUES (?, ?, 'Corrupt', 'expense', 'automatic', ?, ?, ?, 'time', 1577836800, 1577836800, 1, 100, 'misc')`,
    [id, ctx.user.id, opts.frequency, opts.intervalValue, opts.intervalUnit]
  );
  ctx.sqlite.run(`INSERT INTO reminder_vehicles (reminder_id, vehicle_id) VALUES (?, ?)`, [
    id,
    vehicleId,
  ]);
}

function expenseCount(reminderId: string): number {
  const row = ctx.sqlite
    .query('SELECT COUNT(*) AS n FROM expenses WHERE source_type = ? AND source_id = ?')
    .get('reminder', reminderId) as { n: number };
  return row.n;
}

describe('catch-up loop non-progress guard', () => {
  test('a corrupt top-level frequency is skipped with zero expenses', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Kia', model: 'Soul', year: 2019 });
    seedCorruptExpenseReminder('badfreq', vehicleId, {
      frequency: 'monthy',
      intervalValue: 1,
      intervalUnit: 'month',
    });

    const res = await ctx.authed('POST', '/api/v1/reminders/trigger');
    const body = await json<DataEnvelope<TriggerResultShape>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);

    const skip = body.data.skipped.find((s) => s.reminderId === 'badfreq');
    expect(skip?.reason).toBe('error');
    expect(skip?.message ?? '').toContain('frequency');
    expect(expenseCount('badfreq')).toBe(0);
  });

  test('a custom reminder with intervalValue 0 is skipped with zero expenses', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Kia', model: 'Soul', year: 2019 });
    seedCorruptExpenseReminder('zeroiv', vehicleId, {
      frequency: 'custom',
      intervalValue: 0,
      intervalUnit: 'month',
    });

    const res = await ctx.authed('POST', '/api/v1/reminders/trigger');
    const body = await json<DataEnvelope<TriggerResultShape>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);

    const skip = body.data.skipped.find((s) => s.reminderId === 'zeroiv');
    expect(skip?.reason).toBe('error');
    expect(skip?.message ?? '').toContain('intervalValue');
    expect(expenseCount('zeroiv')).toBe(0);
  });

  test('a corrupt reminder does not block a well-formed expense reminder in the same batch', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Kia', model: 'Soul', year: 2019 });
    seedCorruptExpenseReminder('badfreq2', vehicleId, {
      frequency: 'monthy',
      intervalValue: 1,
      intervalUnit: 'month',
    });
    const created = await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Healthy recurring',
      type: 'expense',
      frequency: 'monthly',
      startDate: '2024-01-15T00:00:00.000Z',
      vehicleIds: [vehicleId],
      expenseAmount: 25,
      expenseCategory: 'misc',
    });
    const cBody = await json<DataEnvelope<{ reminder: { id: string } }>>(created);
    expect(created.status, JSON.stringify(cBody)).toBe(201);
    const goodId = cBody.data.reminder.id;

    const res = await ctx.authed('POST', '/api/v1/reminders/trigger');
    expect(res.status).toBe(200);

    // Bad one skipped + zero rows; good one materialized at least one expense.
    expect(expenseCount('badfreq2')).toBe(0);
    expect(expenseCount(goodId)).toBeGreaterThanOrEqual(1);
  });
});
