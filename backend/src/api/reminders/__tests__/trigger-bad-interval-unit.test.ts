/**
 * An invalid custom intervalUnit must not hang the trigger. The bad reminder is reported as a per-reminder
 * skip, and well-formed reminders in the same batch still process. Zod blocks bad units on write, so the
 * row is seeded directly via sqlite.
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
  notifications: Array<{ id: string }>;
  skipped: Array<{ reminderId: string; reason: string; message?: string }>;
}

/** Seeds a custom reminder with a corrupt intervalUnit, overdue since 2020, with a linked vehicle. */
function seedCorruptCustomReminder(id: string, vehicleId: string): void {
  ctx.sqlite.run(
    `INSERT INTO reminders
       (id, user_id, name, type, action_mode, frequency, interval_value, interval_unit,
        trigger_mode, start_date, next_due_date, is_active)
     VALUES (?, ?, 'Corrupt', 'notification', 'automatic', 'custom', 1, 'fortnight',
        'time', 1577836800, 1577836800, 1)`, // 2020-01-01
    [id, ctx.user.id]
  );
  ctx.sqlite.run(`INSERT INTO reminder_vehicles (reminder_id, vehicle_id) VALUES (?, ?)`, [
    id,
    vehicleId,
  ]);
}

describe('invalid custom intervalUnit is skipped, never hangs', () => {
  test('a corrupt-intervalUnit reminder is reported in skipped', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Kia', model: 'Soul', year: 2018 });
    seedCorruptCustomReminder('bad1', vehicleId);

    const res = await ctx.authed('POST', '/api/v1/reminders/trigger');
    const body = await json<DataEnvelope<TriggerResultShape>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);

    const skip = body.data.skipped.find((s) => s.reminderId === 'bad1');
    expect(skip, 'the corrupt reminder is reported as skipped').toBeTruthy();
    expect(skip?.reason).toBe('error');
    expect(skip?.message ?? '').toContain('intervalUnit');
  });

  test('a corrupt reminder does not block a well-formed one in the same batch', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Kia', model: 'Soul', year: 2018 });
    seedCorruptCustomReminder('bad2', vehicleId);

    // A normal monthly notification reminder, also overdue (startDate in the past).
    const created = await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Healthy monthly',
      type: 'notification',
      frequency: 'monthly',
      startDate: '2024-01-15T00:00:00.000Z',
      vehicleIds: [vehicleId],
    });
    const cBody = await json<DataEnvelope<{ reminder: { id: string } }>>(created);
    expect(created.status, JSON.stringify(cBody)).toBe(201);
    const goodId = cBody.data.reminder.id;

    const res = await ctx.authed('POST', '/api/v1/reminders/trigger');
    const body = await json<DataEnvelope<TriggerResultShape>>(res);
    expect(res.status).toBe(200);

    // Bad one skipped...
    expect(body.data.skipped.some((s) => s.reminderId === 'bad2')).toBe(true);
    const goodNotifs = ctx.sqlite
      .query('SELECT COUNT(*) AS n FROM reminder_notifications WHERE reminder_id = ?')
      .get(goodId) as { n: number };
    expect(goodNotifs.n).toBeGreaterThanOrEqual(1);
  });
});
