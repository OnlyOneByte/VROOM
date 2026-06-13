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

  // C256: the mileage dedup is per-MILESTONE (the rn_reminder_odo_idx partial unique is on
  // (reminderId, dueOdometer)), NOT per-reminder. After mark-serviced re-arms to a NEW milestone,
  // crossing THAT must fire a fresh notification — a regression making the index reminderId-only
  // would silently block every future milestone. This pins the distinct-milestone invariant the
  // existing idempotent-re-trigger test (same milestone → still 1) doesn't cover.
  test('a DISTINCT milestone after mark-serviced fires a NEW notification (per-milestone dedup)', async () => {
    const vehicleId = await seedVehicle();
    await addOdometerReading(vehicleId, 35200); // past the first 35000 milestone
    seedMileageReminder('rm6', vehicleId, 35000);

    await trigger();
    const first = mileageNotifs('rm6');
    expect(first).toHaveLength(1);
    expect(first[0]?.due_odometer).toBe(35000);

    // Mark serviced now: re-anchors lastServiceOdometer to the current odometer (35200) and
    // recomputes nextDueOdometer = 35200 + intervalMileage(5000) = 40200.
    const serviced = await ctx.authed('POST', '/api/v1/reminders/rm6/mark-serviced');
    expect(serviced.status).toBe(200);

    // Still at 35200 → below the NEW 40200 milestone → no new notification yet.
    await trigger();
    expect(mileageNotifs('rm6')).toHaveLength(1);

    // Drive past the new milestone → a SECOND notification at the new dueOdometer.
    await addOdometerReading(vehicleId, 40500);
    await trigger();
    const after = mileageNotifs('rm6').sort(
      (a, b) => (a.due_odometer ?? 0) - (b.due_odometer ?? 0)
    );
    expect(after).toHaveLength(2);
    expect(after.map((n) => n.due_odometer)).toEqual([35000, 40200]);
  });

  // C317 deep-review: a `both` (whichever-comes-first) reminder that is SIMULTANEOUSLY time-overdue
  // AND mileage-past-milestone must fire TWO distinct notifications in one trigger — one on the time
  // axis (dueDate set, dueOdometer null) and one on the mileage axis (dueOdometer set, dueDate null).
  // This is exactly what the TWO partial unique indexes enable (rn_reminder_due_idx on dueDate +
  // rn_reminder_odo_idx partial-on-dueOdometer): the two notifications live in disjoint index domains
  // so neither collides. A regression collapsing them into one (reminderId, dueDate) unique — or a
  // single (reminderId) unique — would silently drop the mileage notification with no other failing
  // test (the existing tests cover each axis in ISOLATION, never the coexistence). Pin it.
  test('a `both` reminder overdue on BOTH axes fires two distinct notifications (time + mileage, no collision)', async () => {
    const vehicleId = await seedVehicle();
    await addOdometerReading(vehicleId, 36000); // past the 35000 milestone

    // A `both`-type reminder: past odometer milestone (35000) AND a past next_due_date (time-overdue).
    // start_date in the past + a monthly cadence so the time axis materializes a period notification.
    const pastDate = Math.floor(new Date('2024-01-01T00:00:00.000Z').getTime() / 1000);
    ctx.sqlite.run(
      `INSERT INTO reminders
         (id, user_id, name, type, action_mode, frequency, trigger_mode,
          interval_mileage, last_service_odometer, next_due_odometer,
          start_date, next_due_date, is_active)
       VALUES ('rm-both', ?, 'Service', 'notification', 'automatic', 'monthly', 'both',
          5000, 30000, 35000, ?, ?, 1)`,
      [ctx.user.id, pastDate, pastDate]
    );
    ctx.sqlite.run(
      `INSERT INTO reminder_vehicles (reminder_id, vehicle_id) VALUES ('rm-both', ?)`,
      [vehicleId]
    );

    await trigger();

    const all = ctx.sqlite
      .query('SELECT id, due_date, due_odometer FROM reminder_notifications WHERE reminder_id = ?')
      .all('rm-both') as NotifRow[];

    // Exactly one mileage-axis notification (dueOdometer set, dueDate null)...
    const mileage = all.filter((n) => n.due_odometer !== null);
    expect(mileage).toHaveLength(1);
    expect(mileage[0]?.due_odometer).toBe(35000);
    expect(mileage[0]?.due_date).toBeNull();

    // ...AND at least one time-axis notification (dueDate set, dueOdometer null) — the two axes coexist.
    const time = all.filter((n) => n.due_date !== null);
    expect(time.length).toBeGreaterThanOrEqual(1);
    expect(time.every((n) => n.due_odometer === null)).toBe(true);
  });
});
