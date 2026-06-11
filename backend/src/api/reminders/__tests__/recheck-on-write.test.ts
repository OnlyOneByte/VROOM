/**
 * T4 part 3 (cycle 37): mileage re-check on write (D5).
 *
 * A mileage reminder fires the moment a new odometer reading crosses its milestone — not only on the
 * next POST /trigger. The odometer-create and mileaged-expense-create routes call
 * reminderTriggerService.recheckMileageReminders(userId, vehicleId) after persisting. Pinned
 * end-to-end through the real route → trigger → repo → DB stack:
 *   - a manual odometer reading at/over the milestone fires the notification immediately (no /trigger)
 *   - a reading BELOW the milestone fires nothing
 *   - a mileaged EXPENSE crossing the milestone fires it too (expenses.mileage feeds getCurrentOdometer)
 *   - it's idempotent: a later /trigger does NOT double-fire what recheck already wrote
 *   - a NON-mileage write path is unaffected (no spurious notifications)
 *
 * Mileage reminders aren't seeded via the API for the below-milestone setup ordering, so seed the
 * reminder row directly via sqlite (matching the C25 pattern), then drive the REAL write routes.
 * createTestApp() rewrites env + dynamic-imports DB-bound modules; keep imports to harness + bun:test.
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
    make: 'Toyota',
    model: 'RAV4',
    year: 2022,
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

/** Seed a pure-mileage reminder with the given milestone, linked to one vehicle. */
function seedMileageReminder(id: string, vehicleId: string, nextDueOdometer: number): void {
  ctx.sqlite.run(
    `INSERT INTO reminders
       (id, user_id, name, type, action_mode, frequency, trigger_mode,
        interval_mileage, last_service_odometer, next_due_odometer, start_date, next_due_date, is_active)
     VALUES (?, ?, 'Oil change', 'notification', 'automatic', 'custom', 'mileage',
        5000, ?, ?, 0, NULL, 1)`,
    [id, ctx.user.id, nextDueOdometer - 5000, nextDueOdometer]
  );
  ctx.sqlite.run(`INSERT INTO reminder_vehicles (reminder_id, vehicle_id) VALUES (?, ?)`, [
    id,
    vehicleId,
  ]);
}

function mileageNotifCount(reminderId: string): number {
  return (
    ctx.sqlite
      .query(
        'SELECT COUNT(*) AS n FROM reminder_notifications WHERE reminder_id = ? AND due_odometer IS NOT NULL'
      )
      .get(reminderId) as { n: number }
  ).n;
}

async function addOdometerReading(vehicleId: string, odometer: number): Promise<void> {
  const res = await ctx.authed('POST', `/api/v1/odometer/${vehicleId}`, {
    odometer,
    recordedAt: '2024-06-01T00:00:00.000Z',
  });
  expect(res.status, `odometer ${odometer}`).toBe(201);
}

describe('mileage re-check on write (D5)', () => {
  test('an odometer reading crossing the milestone fires the notification immediately (no /trigger)', async () => {
    const vehicleId = await seedVehicle();
    seedMileageReminder('rw1', vehicleId, 35000);

    // Just the write — no POST /trigger. The recheck hook should fire it.
    await addOdometerReading(vehicleId, 35100);

    expect(mileageNotifCount('rw1')).toBe(1);
  });

  test('an odometer reading below the milestone fires nothing', async () => {
    const vehicleId = await seedVehicle();
    seedMileageReminder('rw2', vehicleId, 35000);

    await addOdometerReading(vehicleId, 34000);

    expect(mileageNotifCount('rw2')).toBe(0);
  });

  test('a mileaged expense crossing the milestone fires it too', async () => {
    const vehicleId = await seedVehicle();
    seedMileageReminder('rw3', vehicleId, 35000);

    const res = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'fuel',
      date: '2024-06-15T00:00:00.000Z',
      expenseAmount: 50,
      mileage: 35500,
      volume: 12,
    });
    expect(res.status, await res.text()).toBeLessThan(300);

    expect(mileageNotifCount('rw3')).toBe(1);
  });

  test('recheck-on-write is idempotent: a later /trigger does not double-fire', async () => {
    const vehicleId = await seedVehicle();
    seedMileageReminder('rw4', vehicleId, 35000);

    await addOdometerReading(vehicleId, 36000); // recheck fires it
    expect(mileageNotifCount('rw4')).toBe(1);

    await ctx.authed('POST', '/api/v1/reminders/trigger'); // must NOT add a second
    expect(mileageNotifCount('rw4')).toBe(1);
  });

  test('a non-mileaged expense write does not fire a mileage reminder', async () => {
    const vehicleId = await seedVehicle();
    seedMileageReminder('rw5', vehicleId, 35000);

    // An expense with NO mileage — even though the milestone is 35000, no reading exists.
    const res = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      date: '2024-06-15T00:00:00.000Z',
      expenseAmount: 20,
    });
    expect(res.status, await res.text()).toBeLessThan(300);

    expect(mileageNotifCount('rw5')).toBe(0);
  });
});

/**
 * #71 (C214): the recheck hook was wired on CREATE but NOT on the PUT/update paths, so EDITING a
 * reading upward across a milestone (a common correction) silently did NOT fire until the next
 * /trigger — breaking the D5 "fires the moment crossed" guarantee for edits. These pin the recheck on
 * both update routes (odometer PUT + mileaged-expense PUT).
 */
describe('mileage re-check on UPDATE (D5, #71)', () => {
  test('editing an odometer reading UP across the milestone fires immediately (no /trigger)', async () => {
    const vehicleId = await seedVehicle();
    seedMileageReminder('ru1', vehicleId, 35000);

    // Create a reading BELOW the milestone — fires nothing yet.
    const created = await ctx.authed('POST', `/api/v1/odometer/${vehicleId}`, {
      odometer: 34000,
      recordedAt: '2024-06-01T00:00:00.000Z',
    });
    const body = await json<DataEnvelope<{ id: string }>>(created);
    expect(created.status, JSON.stringify(body)).toBe(201);
    expect(mileageNotifCount('ru1')).toBe(0);

    // EDIT it up across the milestone — the recheck hook must fire it now.
    const put = await ctx.authed('PUT', `/api/v1/odometer/${body.data.id}`, { odometer: 35200 });
    expect(put.status, await put.text()).toBe(200);
    expect(mileageNotifCount('ru1')).toBe(1);
  });

  test('editing a mileaged expense UP across the milestone fires immediately', async () => {
    const vehicleId = await seedVehicle();
    seedMileageReminder('ru2', vehicleId, 35000);

    // A fuel expense BELOW the milestone — fires nothing yet.
    const created = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'fuel',
      date: '2024-06-15T00:00:00.000Z',
      expenseAmount: 50,
      mileage: 34000,
      volume: 12,
    });
    const body = await json<DataEnvelope<{ id: string }>>(created);
    expect(created.status, JSON.stringify(body)).toBeLessThan(300);
    expect(mileageNotifCount('ru2')).toBe(0);

    // Correct the mileage up across the milestone — recheck must fire it.
    const put = await ctx.authed('PUT', `/api/v1/expenses/${body.data.id}`, { mileage: 35500 });
    expect(put.status, await put.text()).toBe(200);
    expect(mileageNotifCount('ru2')).toBe(1);
  });
});
