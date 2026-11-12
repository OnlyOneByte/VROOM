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

function mileageNotifCount(reminderId: string): number {
  return (
    ctx.sqlite
      .query(
        'SELECT COUNT(*) AS n FROM reminder_notifications WHERE reminder_id = ? AND due_odometer IS NOT NULL'
      )
      .get(reminderId) as { n: number }
  ).n;
}

describe('mileage re-check on write', () => {
  test('an odometer reading crossing the milestone fires the notification immediately (no /trigger)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'RAV4', year: 2022 });
    seedMileageReminder(ctx, 'rw1', vehicleId, 35000);

    await addOdometerReading(ctx, vehicleId, 35100);

    expect(mileageNotifCount('rw1')).toBe(1);
  });

  test('an odometer reading below the milestone fires nothing', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'RAV4', year: 2022 });
    seedMileageReminder(ctx, 'rw2', vehicleId, 35000);

    await addOdometerReading(ctx, vehicleId, 34000);

    expect(mileageNotifCount('rw2')).toBe(0);
  });

  test('a mileaged expense crossing the milestone fires it too', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'RAV4', year: 2022 });
    seedMileageReminder(ctx, 'rw3', vehicleId, 35000);

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
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'RAV4', year: 2022 });
    seedMileageReminder(ctx, 'rw4', vehicleId, 35000);

    await addOdometerReading(ctx, vehicleId, 36000);
    expect(mileageNotifCount('rw4')).toBe(1);

    await ctx.authed('POST', '/api/v1/reminders/trigger');
    expect(mileageNotifCount('rw4')).toBe(1);
  });

  test('a non-mileaged expense write does not fire a mileage reminder', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'RAV4', year: 2022 });
    seedMileageReminder(ctx, 'rw5', vehicleId, 35000);

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

describe('mileage re-check on update', () => {
  test('editing an odometer reading UP across the milestone fires immediately (no /trigger)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'RAV4', year: 2022 });
    seedMileageReminder(ctx, 'ru1', vehicleId, 35000);

    const created = await ctx.authed('POST', `/api/v1/odometer/${vehicleId}`, {
      odometer: 34000,
      recordedAt: '2024-06-01T00:00:00.000Z',
    });
    const body = await json<DataEnvelope<{ id: string }>>(created);
    expect(created.status, JSON.stringify(body)).toBe(201);
    expect(mileageNotifCount('ru1')).toBe(0);

    const put = await ctx.authed('PUT', `/api/v1/odometer/${body.data.id}`, { odometer: 35200 });
    expect(put.status, await put.text()).toBe(200);
    expect(mileageNotifCount('ru1')).toBe(1);
  });

  test('editing a mileaged expense UP across the milestone fires immediately', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'RAV4', year: 2022 });
    seedMileageReminder(ctx, 'ru2', vehicleId, 35000);

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

    const put = await ctx.authed('PUT', `/api/v1/expenses/${body.data.id}`, { mileage: 35500 });
    expect(put.status, await put.text()).toBe(200);
    expect(mileageNotifCount('ru2')).toBe(1);
  });
});

describe('deleting an odometer reading', () => {
  test('keeps an already-fired mileage notification and does not re-fire it', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'RAV4', year: 2022 });
    seedMileageReminder(ctx, 'rd1', vehicleId, 35000);

    const created = await ctx.authed('POST', `/api/v1/odometer/${vehicleId}`, {
      odometer: 36000,
      recordedAt: '2024-06-01T00:00:00.000Z',
    });
    const body = await json<DataEnvelope<{ id: string }>>(created);
    expect(created.status, JSON.stringify(body)).toBe(201);
    expect(mileageNotifCount('rd1')).toBe(1);

    const del = await ctx.authed('DELETE', `/api/v1/odometer/${body.data.id}`);
    expect(del.status, await del.text()).toBe(200);

    expect(mileageNotifCount('rd1')).toBe(1);

    await ctx.authed('POST', '/api/v1/reminders/trigger');
    expect(mileageNotifCount('rd1')).toBe(1);
  });
});
