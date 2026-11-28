import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  setSystemTime(new Date('2026-06-15T20:00:00.000Z'));
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => {
  ctx.close();
  setSystemTime();
});

const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);

describe('a reading that fires a time-or-mileage reminder', () => {
  test("re-arms the due date by the user's day, not the server's", async () => {
    const vehicleId = await seedVehicle(ctx);
    await ctx.sql.run(
      `INSERT INTO reminders
         (id, user_id, name, type, action_mode, frequency, trigger_mode, interval_mileage,
          last_service_odometer, next_due_odometer, start_date, next_due_date, last_triggered_at,
          is_active)
       VALUES ('rem-tz', ?, 'Service', 'notification', 'automatic', 'weekly', 'both', 5000,
          5000, 10000, ?, ?, ?, TRUE)`,
      [
        ctx.user.id,
        at('2026-06-02T05:00:00.000Z'),
        at('2026-06-16T05:00:00.000Z'),
        at('2026-06-09T05:00:00.000Z'),
      ]
    );
    await ctx.sql.run(
      "INSERT INTO reminder_vehicles (reminder_id, vehicle_id) VALUES ('rem-tz', ?)",
      [vehicleId]
    );

    const res = await ctx.authed('POST', `/api/v1/odometer/${vehicleId}`, {
      odometer: 10100,
      recordedAt: '2026-06-15T12:00:00.000Z',
      timeZone: 'Pacific/Kiritimati',
    });
    expect(res.status).toBe(201);

    const row = (await ctx.sql.get(
      "SELECT next_due_date AS d, next_due_odometer AS o FROM reminders WHERE id = 'rem-tz'"
    )) as { d: number; o: number };
    expect(row.o).toBe(15100);
    expect(row.d).toBe(at('2026-06-23T05:00:00.000Z'));
  });
});
