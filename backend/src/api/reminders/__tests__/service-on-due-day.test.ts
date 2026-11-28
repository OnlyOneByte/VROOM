import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Reminder } from '../../../db/schema';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';
import { zonedDayWindow } from '../../../utils/time-zone';
import { nextDueAfterService } from '../trigger-service';

const monthly = (overrides: Partial<Reminder>): Reminder =>
  ({
    id: 'rem-unit',
    frequency: 'monthly',
    intervalValue: null,
    intervalUnit: null,
    startDate: new Date('2099-04-01T12:00:00.000Z'),
    lastTriggeredAt: null,
    ...overrides,
  }) as Reminder;

describe('servicing after a reminder fired early on its day', () => {
  test('the next due date stays on the next period', () => {
    const reminder = monthly({ lastTriggeredAt: new Date('2099-05-01T08:00:00.000Z') });

    const next = nextDueAfterService(
      reminder,
      new Date('2099-06-01T12:00:00.000Z'),
      new Date('2099-05-10T09:00:00.000Z'),
      'UTC'
    );

    expect(next.toISOString()).toBe('2099-06-01T12:00:00.000Z');
  });
});

describe('marking a reminder serviced on its due day', () => {
  let ctx: TestApp;

  beforeEach(async () => {
    ctx = await createTestApp();
  }, SETUP_TIMEOUT_MS);
  afterEach(() => ctx.close());

  test('moves it past today, even before its time of day', async () => {
    const zone = 'Pacific/Kiritimati';
    const vehicleId = await seedVehicle(ctx);
    const { nextDay } = zonedDayWindow(new Date(), zone);
    const dueToday = Math.floor((nextDay.getTime() - 1000) / 1000);
    await ctx.sql.run(
      `INSERT INTO reminders
         (id, user_id, name, type, action_mode, frequency, trigger_mode,
          start_date, next_due_date, last_triggered_at, is_active)
       VALUES ('rem-today', ?, 'Wash', 'notification', 'automatic', 'weekly', 'time', ?, ?, ?, TRUE)`,
      [ctx.user.id, dueToday - 14 * 86_400, dueToday, dueToday - 7 * 86_400]
    );
    await ctx.sql.run(
      "INSERT INTO reminder_vehicles (reminder_id, vehicle_id) VALUES ('rem-today', ?)",
      [vehicleId]
    );

    const res = await ctx.authed(
      'POST',
      `/api/v1/reminders/rem-today/mark-serviced?timeZone=${zone}`
    );
    expect(res.status, await res.text()).toBe(200);

    const row = (await ctx.sql.get(
      "SELECT next_due_date AS d FROM reminders WHERE id = 'rem-today'"
    )) as { d: number };
    expect(row.d * 1000).toBeGreaterThanOrEqual(nextDay.getTime());
  });
});
