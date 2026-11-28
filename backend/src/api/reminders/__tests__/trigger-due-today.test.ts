import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';
import { zonedDayWindow } from '../../../utils/time-zone';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

const ZONE = 'Pacific/Kiritimati';

async function seedDueAt(id: string, vehicleId: string, dueMs: number): Promise<void> {
  const due = Math.floor(dueMs / 1000);
  await ctx.sql.run(
    `INSERT INTO reminders
       (id, user_id, name, type, action_mode, frequency, trigger_mode,
        start_date, next_due_date, is_active)
     VALUES (?, ?, 'Registration', 'notification', 'automatic', 'monthly', 'time', ?, ?, TRUE)`,
    [id, ctx.user.id, due, due]
  );
  await ctx.sql.run('INSERT INTO reminder_vehicles (reminder_id, vehicle_id) VALUES (?, ?)', [
    id,
    vehicleId,
  ]);
}

const notified = async (id: string): Promise<number> =>
  (
    (await ctx.sql.get('SELECT COUNT(*) AS n FROM reminder_notifications WHERE reminder_id = ?', [
      id,
    ])) as { n: number }
  ).n;

describe('reminders due today', () => {
  test('one due later today fires on the first run of the day, one due tomorrow does not', async () => {
    const vehicleId = await seedVehicle(ctx);
    const { nextDay } = zonedDayWindow(new Date(), ZONE);
    await seedDueAt('rem-today', vehicleId, nextDay.getTime() - 1000);
    await seedDueAt('rem-tomorrow', vehicleId, nextDay.getTime() + 1000);

    const res = await ctx.authed('POST', `/api/v1/reminders/trigger?timeZone=${ZONE}`);
    expect(res.status).toBe(200);

    expect(await notified('rem-today')).toBe(1);
    expect(await notified('rem-tomorrow')).toBe(0);
  });
});
