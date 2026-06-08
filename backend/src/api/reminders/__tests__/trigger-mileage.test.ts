/**
 * Characterizes the MILEAGE axis of the reminder trigger (maintenance-schedule T3 part 2, cycle 25)
 * — the whichever-comes-first runtime that fires a service reminder when a vehicle's odometer
 * reaches a milestone, independent of any time/date axis.
 *
 * Mileage reminders aren't API-creatable yet (validation is T4), so these seed the reminder row
 * directly via sqlite, then drive the REAL trigger endpoint (route → service → odometer repo → DB)
 * and read notifications straight off sqlite. Pinned:
 *   - current odometer >= nextDueOdometer → exactly ONE mileage notification (null dueDate,
 *     dueOdometer set); below the milestone → none
 *   - re-triggering does NOT duplicate the milestone notification (idempotent; no auto-re-arm)
 *   - a mileage reminder with !=1 linked vehicle is skipped (D4), not errored
 *   - the current odometer is the MAX across expenses.mileage + odometer_entries (getCurrentOdometer)
 *
 * createTestApp() rewrites env + dynamic-imports DB-bound modules, so keep static imports to the
 * harness + bun:test.
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
    make: 'Subaru',
    model: 'Outback',
    year: 2020,
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

async function addOdometerReading(vehicleId: string, odometer: number): Promise<void> {
  const res = await ctx.authed('POST', `/api/v1/odometer/${vehicleId}`, {
    odometer,
    recordedAt: '2024-06-01T00:00:00.000Z',
  });
  expect(res.status, `odometer create ${odometer}`).toBe(201);
}

/**
 * Seed a mileage-tracking reminder directly (not yet API-creatable). triggerMode='mileage', a
 * single linked vehicle, and a nextDueOdometer milestone. next_due_date is NULL (pure mileage).
 */
function seedMileageReminder(
  reminderId: string,
  vehicleId: string,
  nextDueOdometer: number,
  triggerMode: 'mileage' | 'both' = 'mileage'
): void {
  ctx.sqlite.run(
    `INSERT INTO reminders
       (id, user_id, name, type, action_mode, frequency, trigger_mode,
        interval_mileage, last_service_odometer, next_due_odometer,
        start_date, next_due_date, is_active)
     VALUES (?, ?, 'Oil change', 'notification', 'automatic', 'custom', ?,
        5000, ?, ?, 0, NULL, 1)`,
    [reminderId, ctx.user.id, triggerMode, nextDueOdometer - 5000, nextDueOdometer]
  );
  ctx.sqlite.run(`INSERT INTO reminder_vehicles (reminder_id, vehicle_id) VALUES (?, ?)`, [
    reminderId,
    vehicleId,
  ]);
}

interface NotifRow {
  id: string;
  due_date: number | null;
  due_odometer: number | null;
}

function mileageNotifs(reminderId: string): NotifRow[] {
  return ctx.sqlite
    .query(
      'SELECT id, due_date, due_odometer FROM reminder_notifications WHERE reminder_id = ? AND due_odometer IS NOT NULL'
    )
    .all(reminderId) as NotifRow[];
}

async function trigger(): Promise<void> {
  const res = await ctx.authed('POST', '/api/v1/reminders/trigger');
  expect(res.status).toBe(200);
}

describe('mileage-reminder trigger (whichever-comes-first, odometer axis)', () => {
  test('current odometer at/over the milestone fires exactly one mileage notification', async () => {
    const vehicleId = await seedVehicle();
    await addOdometerReading(vehicleId, 35200); // past the 35000 milestone
    seedMileageReminder('rm1', vehicleId, 35000);

    await trigger();

    const notifs = mileageNotifs('rm1');
    expect(notifs).toHaveLength(1);
    expect(notifs[0]?.due_date).toBeNull(); // mileage axis carries no date
    expect(notifs[0]?.due_odometer).toBe(35000);
  });

  test('current odometer below the milestone fires nothing', async () => {
    const vehicleId = await seedVehicle();
    await addOdometerReading(vehicleId, 34000); // below 35000
    seedMileageReminder('rm2', vehicleId, 35000);

    await trigger();

    expect(mileageNotifs('rm2')).toHaveLength(0);
  });

  test('re-triggering does not duplicate the milestone notification (idempotent, no re-arm)', async () => {
    const vehicleId = await seedVehicle();
    await addOdometerReading(vehicleId, 36000);
    seedMileageReminder('rm3', vehicleId, 35000);

    await trigger();
    expect(mileageNotifs('rm3')).toHaveLength(1);

    await trigger();
    expect(mileageNotifs('rm3')).toHaveLength(1); // still one — stays due until marked serviced
  });

  test('a mileage reminder with no linked vehicle is skipped, not errored', async () => {
    // Seed the reminder row but NO junction row.
    ctx.sqlite.run(
      `INSERT INTO reminders
         (id, user_id, name, type, action_mode, frequency, trigger_mode,
          interval_mileage, last_service_odometer, next_due_odometer, start_date, next_due_date, is_active)
       VALUES ('rm4', ?, 'Orphan', 'notification', 'automatic', 'custom', 'mileage', 5000, 30000, 35000, 0, NULL, 1)`,
      [ctx.user.id]
    );

    const res = await ctx.authed('POST', '/api/v1/reminders/trigger');
    const body =
      await json<DataEnvelope<{ skipped: Array<{ reminderId: string; reason: string }> }>>(res);
    expect(res.status).toBe(200);
    expect(body.data.skipped.some((s) => s.reminderId === 'rm4')).toBe(true);
    expect(mileageNotifs('rm4')).toHaveLength(0);
  });

  test('current odometer is the MAX across expense mileage + odometer entries', async () => {
    const vehicleId = await seedVehicle();
    // A manual odometer entry below the milestone...
    await addOdometerReading(vehicleId, 34000);
    // ...but a fuel expense whose mileage is past it — the max-by-value should win.
    const expRes = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'fuel',
      date: '2024-06-15T00:00:00.000Z',
      expenseAmount: 50,
      mileage: 35500,
      volume: 12,
    });
    expect(expRes.status, 'expense create').toBeLessThan(300);
    seedMileageReminder('rm5', vehicleId, 35000);

    await trigger();

    expect(mileageNotifs('rm5')).toHaveLength(1);
  });
});
