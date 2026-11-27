import { expect } from 'bun:test';
import type { TestApp } from '../../../test-helpers/http-client';

export async function addOdometerReading(
  ctx: TestApp,
  vehicleId: string,
  odometer: number
): Promise<void> {
  const res = await ctx.authed('POST', `/api/v1/odometer/${vehicleId}`, {
    odometer,
    recordedAt: '2024-06-01T00:00:00.000Z',
  });
  expect(res.status, `odometer create ${odometer}`).toBe(201);
}

export async function seedMileageReminder(
  ctx: TestApp,
  id: string,
  vehicleId: string,
  nextDueOdometer: number
): Promise<void> {
  await ctx.sql.run(
    `INSERT INTO reminders
       (id, user_id, name, type, action_mode, frequency, trigger_mode,
        interval_mileage, last_service_odometer, next_due_odometer,
        start_date, next_due_date, is_active)
     VALUES (?, ?, 'Oil change', 'notification', 'automatic', 'custom', 'mileage',
        5000, ?, ?, 0, NULL, TRUE)`,
    [id, ctx.user.id, nextDueOdometer - 5000, nextDueOdometer]
  );
  await ctx.sql.run(`INSERT INTO reminder_vehicles (reminder_id, vehicle_id) VALUES (?, ?)`, [
    id,
    vehicleId,
  ]);
}
