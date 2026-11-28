import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { createInvitee } from '../../../test-helpers/invitee';
import { seedVehicle } from '../../../test-helpers/seed';
import { addOdometerReading, seedMileageReminder } from './_helpers';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

type Row = { reminder: { id: string }; mileageDue?: boolean };

async function listed(): Promise<Map<string, boolean | undefined>> {
  const res = await ctx.authed('GET', '/api/v1/reminders');
  expect(res.status).toBe(200);
  const body = await json<DataEnvelope<Row[]>>(res);
  return new Map(body.data.map((row) => [row.reminder.id, row.mileageDue]));
}

describe('reminder list: mileage milestone reached', () => {
  test('a reminder whose milestone the car has reached is marked due', async () => {
    const vehicleId = await seedVehicle(ctx);
    await seedMileageReminder(ctx, 'rem-reached', vehicleId, 10000);
    await seedMileageReminder(ctx, 'rem-ahead', vehicleId, 20000);
    await addOdometerReading(ctx, vehicleId, 10000);

    const due = await listed();

    expect(due.get('rem-reached')).toBe(true);
    expect(due.get('rem-ahead')).toBe(false);
  });

  test('paused, time-only and multi-car reminders are not marked due', async () => {
    const vehicleId = await seedVehicle(ctx);
    const otherId = await seedVehicle(ctx);
    await seedMileageReminder(ctx, 'rem-paused', vehicleId, 10000);
    await ctx.sql.run("UPDATE reminders SET is_active = FALSE WHERE id = 'rem-paused'");
    await seedMileageReminder(ctx, 'rem-time', vehicleId, 10000);
    await ctx.sql.run("UPDATE reminders SET trigger_mode = 'time' WHERE id = 'rem-time'");
    await seedMileageReminder(ctx, 'rem-two-cars', vehicleId, 10000);
    await ctx.sql.run('INSERT INTO reminder_vehicles (reminder_id, vehicle_id) VALUES (?, ?)', [
      'rem-two-cars',
      otherId,
    ]);
    await addOdometerReading(ctx, vehicleId, 12000);

    const due = await listed();

    expect(due.get('rem-paused')).toBe(false);
    expect(due.get('rem-time')).toBe(false);
    expect(due.get('rem-two-cars')).toBe(false);
  });

  test('a car with no reading is not due', async () => {
    const vehicleId = await seedVehicle(ctx);
    await seedMileageReminder(ctx, 'rem-none', vehicleId, 10000);

    expect((await listed()).get('rem-none')).toBe(false);
  });

  test('someone the car is shared with sees it due from the owner readings', async () => {
    const vehicleId = await seedVehicle(ctx);
    await seedMileageReminder(ctx, 'rem-shared', vehicleId, 10000);
    await addOdometerReading(ctx, vehicleId, 10500);
    const viewer = await createInvitee(ctx, 'mileage-viewer');
    await viewer.acceptShare(vehicleId, 'viewer');

    const res = await viewer.request('GET', `/api/v1/reminders?vehicleId=${vehicleId}`);
    expect(res.status).toBe(200);
    const body = await json<DataEnvelope<Row[]>>(res);

    expect(body.data.find((row) => row.reminder.id === 'rem-shared')?.mileageDue).toBe(true);
  });
});
