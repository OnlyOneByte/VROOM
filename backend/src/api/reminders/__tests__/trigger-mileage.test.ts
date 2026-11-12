import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';
import { addOdometerReading, seedMileageReminder } from './_helpers';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

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
    const vehicleId = await seedVehicle(ctx, { make: 'Subaru', model: 'Outback', year: 2020 });
    await addOdometerReading(ctx, vehicleId, 35200);
    seedMileageReminder(ctx, 'rm1', vehicleId, 35000);

    await trigger();

    const notifs = mileageNotifs('rm1');
    expect(notifs).toHaveLength(1);
    expect(notifs[0]?.due_date).toBeNull();
    expect(notifs[0]?.due_odometer).toBe(35000);
  });

  test('current odometer exactly on the milestone fires', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Subaru', model: 'Outback', year: 2020 });
    await addOdometerReading(ctx, vehicleId, 35000);
    seedMileageReminder(ctx, 'rmEq', vehicleId, 35000);

    await trigger();

    const notifs = mileageNotifs('rmEq');
    expect(notifs).toHaveLength(1);
    expect(notifs[0]?.due_odometer).toBe(35000);
  });

  test('current odometer below the milestone fires nothing', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Subaru', model: 'Outback', year: 2020 });
    await addOdometerReading(ctx, vehicleId, 34000);
    seedMileageReminder(ctx, 'rm2', vehicleId, 35000);

    await trigger();

    expect(mileageNotifs('rm2')).toHaveLength(0);
  });

  test('re-triggering does not duplicate the milestone notification (idempotent, no re-arm)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Subaru', model: 'Outback', year: 2020 });
    await addOdometerReading(ctx, vehicleId, 36000);
    seedMileageReminder(ctx, 'rm3', vehicleId, 35000);

    await trigger();
    expect(mileageNotifs('rm3')).toHaveLength(1);

    await trigger();
    expect(mileageNotifs('rm3')).toHaveLength(1);
  });

  test('a mileage reminder with no linked vehicle is skipped, not errored', async () => {
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
    const vehicleId = await seedVehicle(ctx, { make: 'Subaru', model: 'Outback', year: 2020 });
    await addOdometerReading(ctx, vehicleId, 34000);
    const expRes = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'fuel',
      date: '2024-06-15T00:00:00.000Z',
      expenseAmount: 50,
      mileage: 35500,
      volume: 12,
    });
    expect(expRes.status, 'expense create').toBeLessThan(300);
    seedMileageReminder(ctx, 'rm5', vehicleId, 35000);

    await trigger();

    expect(mileageNotifs('rm5')).toHaveLength(1);
  });

  test('a new milestone after mark-serviced fires a new notification', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Subaru', model: 'Outback', year: 2020 });
    await addOdometerReading(ctx, vehicleId, 35200);
    seedMileageReminder(ctx, 'rm6', vehicleId, 35000);

    await trigger();
    const first = mileageNotifs('rm6');
    expect(first).toHaveLength(1);
    expect(first[0]?.due_odometer).toBe(35000);

    const serviced = await ctx.authed('POST', '/api/v1/reminders/rm6/mark-serviced');
    expect(serviced.status).toBe(200);

    await trigger();
    expect(mileageNotifs('rm6')).toHaveLength(1);

    await addOdometerReading(ctx, vehicleId, 40500);
    await trigger();
    const after = mileageNotifs('rm6').sort(
      (a, b) => (a.due_odometer ?? 0) - (b.due_odometer ?? 0)
    );
    expect(after).toHaveLength(2);
    expect(after.map((n) => n.due_odometer)).toEqual([35000, 40200]);
  });

  test('a `both` reminder overdue on BOTH axes fires two distinct notifications (time + mileage, no collision)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Subaru', model: 'Outback', year: 2020 });
    await addOdometerReading(ctx, vehicleId, 36000);

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

    const mileage = all.filter((n) => n.due_odometer !== null);
    expect(mileage).toHaveLength(1);
    expect(mileage[0]?.due_odometer).toBe(35000);
    expect(mileage[0]?.due_date).toBeNull();

    const time = all.filter((n) => n.due_date !== null);
    expect(time.length).toBeGreaterThanOrEqual(1);
    expect(time.every((n) => n.due_odometer === null)).toBe(true);
  });
});
