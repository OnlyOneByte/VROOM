/**
 * TRUE backup → restore round-trip for the maintenance-schedule reminder fields, through the REAL
 * stack (T5 "Remaining", cycle 27 guard). Data-safety quality bar #1: no silent loss.
 *
 * C22/C25 added five columns to the reminder graph — reminders.{triggerMode, intervalMileage,
 * lastServiceOdometer, nextDueOdometer} and reminderNotifications.dueOdometer — plus made
 * next_due_date / due_date nullable so a mileage-only reminder/notification carries no date. The
 * CSV backup is schema-derived, so these are *supposed* to ride along automatically — but the
 * coerceRow boundary (integer + nullable columns, and a NULL due_date that must NOT coerce to 0 or
 * "") is exactly where a column silently drops or mangles on the round-trip (the C3 clientId class).
 * Nothing proved a mileage reminder survives export → import intact. This does, and it's a
 * merge-surviving lock: it fails the moment any maintenance field is dropped from the serialize or
 * restore path.
 *
 * Mileage reminders aren't API-creatable yet (validation is T4), so seed the reminder + notification
 * rows directly via sqlite, then run the REAL exportAsZip (CSV serialize) → restoreFromBackup (CSV
 * parse + coerce + FK-ordered insert) and read the rows back. createTestApp() rewrites env then
 * dynamic-imports DB-bound modules, so import backup/restore dynamically AFTER createTestApp.
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

interface ReminderRowDb {
  id: string;
  trigger_mode: string;
  interval_mileage: number | null;
  last_service_odometer: number | null;
  next_due_odometer: number | null;
  next_due_date: number | null;
}

interface NotifRowDb {
  id: string;
  due_date: number | null;
  due_odometer: number | null;
}

function reminderRow(id: string): ReminderRowDb {
  return ctx.sqlite
    .query(
      'SELECT id, trigger_mode, interval_mileage, last_service_odometer, next_due_odometer, next_due_date FROM reminders WHERE id = ?'
    )
    .get(id) as ReminderRowDb;
}

function notifRow(id: string): NotifRowDb {
  return ctx.sqlite
    .query('SELECT id, due_date, due_odometer FROM reminder_notifications WHERE id = ?')
    .get(id) as NotifRowDb;
}

async function roundTrip(): Promise<void> {
  const { backupService } = await import('../backup');
  const { restoreService } = await import('../restore');
  const zip = await backupService.exportAsZip(ctx.user.id);
  const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
  expect(result.success, JSON.stringify(result)).toBe(true);
}

describe('backup → restore round-trip preserves maintenance-schedule fields', () => {
  test('a mileage-only reminder + its mileage notification survive with every field intact', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Subaru', model: 'Forester', year: 2021 });

    // A pure-mileage reminder: NULL next_due_date, the four mileage columns populated.
    ctx.sqlite.run(
      `INSERT INTO reminders
         (id, user_id, name, type, action_mode, frequency, trigger_mode,
          interval_mileage, last_service_odometer, next_due_odometer,
          start_date, next_due_date, is_active)
       VALUES ('mr1', ?, 'Oil change', 'notification', 'automatic', 'custom', 'mileage',
          5000, 30000, 35000, 0, NULL, 1)`,
      [ctx.user.id]
    );
    ctx.sqlite.run(`INSERT INTO reminder_vehicles (reminder_id, vehicle_id) VALUES ('mr1', ?)`, [
      vehicleId,
    ]);
    // A mileage-fired notification: NULL due_date, milestone in due_odometer.
    ctx.sqlite.run(
      `INSERT INTO reminder_notifications (id, reminder_id, user_id, due_date, due_odometer, is_read)
       VALUES ('mn1', 'mr1', ?, NULL, 35000, 0)`,
      [ctx.user.id]
    );

    await roundTrip();

    // The reminder survived with all four mileage columns + the NULL date intact.
    const r = reminderRow('mr1');
    expect(r, 'reminder survived the round-trip').toBeTruthy();
    expect(r.trigger_mode).toBe('mileage');
    expect(r.interval_mileage).toBe(5000);
    expect(r.last_service_odometer).toBe(30000);
    expect(r.next_due_odometer).toBe(35000);
    expect(
      r.next_due_date,
      'a mileage-only reminder keeps a NULL date (not coerced to 0)'
    ).toBeNull();

    // The mileage notification survived: NULL due_date preserved, dueOdometer milestone intact.
    const n = notifRow('mn1');
    expect(n, 'notification survived the round-trip').toBeTruthy();
    expect(n.due_date, 'a mileage notification keeps a NULL due_date').toBeNull();
    expect(n.due_odometer).toBe(35000);
  });

  test('a time+mileage (both) reminder preserves both axes through the round-trip', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Subaru', model: 'Forester', year: 2021 });

    // triggerMode 'both': a real next_due_date AND the mileage columns.
    ctx.sqlite.run(
      `INSERT INTO reminders
         (id, user_id, name, type, action_mode, frequency, trigger_mode,
          interval_mileage, last_service_odometer, next_due_odometer,
          start_date, next_due_date, is_active)
       VALUES ('mr2', ?, 'Major service', 'notification', 'automatic', 'monthly', 'both',
          10000, 40000, 50000, 1700000000, 1800000000, 1)`,
      [ctx.user.id]
    );
    ctx.sqlite.run(`INSERT INTO reminder_vehicles (reminder_id, vehicle_id) VALUES ('mr2', ?)`, [
      vehicleId,
    ]);

    await roundTrip();

    const r = reminderRow('mr2');
    expect(r.trigger_mode).toBe('both');
    expect(r.interval_mileage).toBe(10000);
    expect(r.last_service_odometer).toBe(40000);
    expect(r.next_due_odometer).toBe(50000);
    expect(r.next_due_date, 'the time axis date is preserved for a both-reminder').toBe(1800000000);
  });

  test('a plain time reminder restores with mileage columns NULL (not 0 or empty)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Subaru', model: 'Forester', year: 2021 });

    // A normal time reminder created via the real API → triggerMode defaults to 'time',
    // mileage columns are all NULL. They must come back NULL, not coerced to 0.
    const created = await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Registration renewal',
      type: 'notification',
      frequency: 'yearly',
      startDate: '2024-02-01T00:00:00.000Z',
      vehicleIds: [vehicleId],
    });
    const body = await json<DataEnvelope<{ reminder: { id: string } }>>(created);
    expect(created.status, JSON.stringify(body)).toBe(201);
    const id = body.data.reminder.id;

    await roundTrip();

    const r = reminderRow(id);
    expect(r.trigger_mode).toBe('time');
    expect(r.interval_mileage, 'unset mileage interval stays NULL').toBeNull();
    expect(r.last_service_odometer).toBeNull();
    expect(r.next_due_odometer).toBeNull();
    expect(r.next_due_date, 'a time reminder keeps its real date').not.toBeNull();
  });
});
