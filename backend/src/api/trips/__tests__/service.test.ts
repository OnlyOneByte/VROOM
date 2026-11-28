import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { repos } from '../../../app-context';
import { NotFoundError } from '../../../errors';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../../test-helpers/http-client';
import { createTrip, deleteTrip, updateTrip } from '../service';

let ctx: TestApp;
let vehicleId: string;

const LA = 'America/Los_Angeles';

beforeEach(async () => {
  ctx = await createTestApp();
  vehicleId = 'v-service';
  await ctx.sql.run(
    'INSERT INTO vehicles (id, user_id, make, model, year) VALUES (?, ?, ?, ?, ?)',
    [vehicleId, ctx.user.id, 'Mazda', '3', 2020]
  );
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

const odoCount = async (): Promise<number> =>
  (
    (await ctx.sql.get('SELECT COUNT(*) AS n FROM odometer_entries WHERE vehicle_id = ?', [
      vehicleId,
    ])) as { n: number }
  ).n;

function trip(endOdometer: number, tripDate: string, timeZone?: string, distance = 200) {
  return createTrip(ctx.user.id, {
    vehicleId,
    startOdometer: endOdometer - distance,
    endOdometer,
    purpose: 'business',
    tripDate: new Date(tripDate),
    timeZone,
  });
}

describe('trips service keeps the linked odometer entry in sync', () => {
  test('editing a trip’s end reading moves the linked odometer entry', async () => {
    const created = await trip(5000, '2024-06-20T20:30:00.000Z');
    expect(await odoCount()).toBe(1);

    await updateTrip(ctx.user.id, created, { startOdometer: 100, endOdometer: 500 }, undefined);

    expect(await odoCount()).toBe(1);
    expect(await repos().odometer.getCurrentOdometer(vehicleId, ctx.user.id)).toBe(500);
  });

  test('create, edit and delete match the linked entry on the user’s day in their time zone', async () => {
    const evening = await trip(5000, '2024-06-21T03:00:00.000Z', LA);
    const morning = await trip(5000, '2024-06-20T08:00:00.000Z', LA, 0);
    expect(await odoCount(), 'both trips fall on 20 June in Los Angeles').toBe(1);

    const edited = await updateTrip(ctx.user.id, morning, { note: 'Commute' }, LA);

    await deleteTrip(ctx.user.id, evening, { keepOdometer: false, timeZone: LA });
    expect(await odoCount(), 'the morning trip still holds the entry').toBe(1);
    await deleteTrip(ctx.user.id, edited, { keepOdometer: false, timeZone: LA });
    expect(await odoCount()).toBe(0);
  });

  test('editing a trip onto the next day keeps the entry the other trip on its old day still needs', async () => {
    const evening = await trip(5000, '2024-06-21T03:00:00.000Z', LA);
    await trip(5000, '2024-06-20T08:00:00.000Z', LA, 0);
    expect(await odoCount()).toBe(1);

    await updateTrip(
      ctx.user.id,
      evening,
      { endOdometer: 5100, tripDate: new Date('2024-06-21T08:00:00.000Z') },
      LA
    );
    expect(await odoCount(), '20 June keeps its entry and 21 June gets one').toBe(2);
  });

  test('deleting a trip with keepOdometer leaves the linked entry', async () => {
    const created = await trip(5000, '2024-06-20T20:30:00.000Z');
    expect(await odoCount()).toBe(1);

    await deleteTrip(ctx.user.id, created, { keepOdometer: true, timeZone: undefined });

    expect(await odoCount()).toBe(1);
    expect(await repos().odometer.getCurrentOdometer(vehicleId, ctx.user.id)).toBe(5000);
  });
});

describe('trips service writes only the caller’s own trips', () => {
  test('a stranger cannot create on, edit or delete another user’s trip', async () => {
    const created = await trip(5000, '2024-06-20T20:30:00.000Z');
    await ctx.sql.run(
      "INSERT INTO users (id, email, display_name) VALUES ('u-other', 'o@x.com', 'O')"
    );

    await expect(
      createTrip('u-other', {
        vehicleId,
        startOdometer: 5000,
        endOdometer: 5100,
        purpose: 'business',
        tripDate: new Date('2024-06-21T20:30:00.000Z'),
      })
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      updateTrip('u-other', created, { endOdometer: 6000 }, undefined)
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      deleteTrip('u-other', created, { keepOdometer: false, timeZone: undefined })
    ).rejects.toBeInstanceOf(NotFoundError);

    const row = await ctx.sql.get('SELECT end_odometer FROM trips WHERE id = ?', [created.id]);
    expect(row).toEqual({ end_odometer: 5000 });
    expect(await odoCount()).toBe(1);
  });
});
