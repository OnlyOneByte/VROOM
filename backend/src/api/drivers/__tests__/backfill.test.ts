import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { type Members, overrideOn, seedCar, seedMembers } from '../../../test-helpers/members';

let ctx: TestApp;
let m: Members;
const CAR = 'bf-car';
const base = `/api/v1/vehicles/${CAR}/drivers`;

interface Summary {
  total: number;
  trips: number;
  readings: number;
  expenses: number;
  byDriver: { driverId: string; name: string; count: number }[];
}

const trip = (start: number, date: string) => ({
  vehicleId: CAR,
  startOdometer: start,
  endOdometer: start + 50,
  purpose: 'personal',
  tripDate: date,
});

beforeEach(async () => {
  ctx = await createTestApp();
  await seedCar(ctx, CAR);
  m = await seedMembers(ctx, CAR, 'bf');
  await ctx.authed('POST', '/api/v1/trips', trip(1000, '2024-03-01'));
  await m.editor.request('POST', '/api/v1/trips', trip(1100, '2024-03-05'));
  await m.editor.request('POST', '/api/v1/expenses', {
    vehicleId: CAR,
    category: 'maintenance',
    date: '2024-04-02',
    expenseAmount: 30,
  });
  await ctx.authed('PUT', `/api/v1/vehicles/${CAR}/car-share`, { enabled: true });
}, 20_000);
afterEach(() => ctx.close());

async function driverOf(userId: string | null, name?: string): Promise<string> {
  const res = await ctx.authed('GET', base);
  const list = (
    await json<DataEnvelope<{ id: string; userId: string | null; name: string }[]>>(res)
  ).data;
  return list.find((d) => (userId ? d.userId === userId : d.name === name))?.id ?? '';
}

async function post<T>(path: string, body?: unknown, status = 200): Promise<T> {
  const res = await ctx.authed('POST', path, body);
  expect(res.status).toBe(status);
  return (await json<DataEnvelope<T>>(res)).data;
}

const insuranceExpense = async () =>
  await ctx.sql.run(
    "INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount, source_type) VALUES ('bf-ins', ?, ?, 'financial', ?, 90, 'insurance_term')",
    [CAR, ctx.user.id, Math.floor(Date.parse('2024-03-10') / 1000)]
  );

const payerOf = async (id: string) =>
  (
    (await ctx.sql.get('SELECT paid_by_driver_id AS d FROM expenses WHERE id = ?', [id])) as {
      d: string | null;
    }
  ).d;

const tripDrivers = async () =>
  (
    (await ctx.sql.all('SELECT driver_id AS d FROM trips ORDER BY start_odometer')) as {
      d: string | null;
    }[]
  ).map((r) => r.d);

describe('applying a planned backfill', () => {
  test('re-checks car sharing and the drivers inside its transaction', async () => {
    const { applyBackfill, undoBackfill } = await import('../backfill');
    const { asyncDb } = (await import('../../../app-context')).appContext();
    const tripId = ((await ctx.sql.get('SELECT id FROM trips LIMIT 1')) as { id: string }).id;
    await seedCar(ctx, 'bf-other-car');
    await ctx.sql.run(
      "INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount) VALUES ('bf-moved', 'bf-other-car', ?, 'maintenance', 1, 10)",
      [ctx.user.id]
    );
    const owner = await driverOf(ctx.user.id);
    const planned = [
      { kind: 'trip' as const, id: tripId, driverId: 'driver-of-another-car' },
      { kind: 'expense' as const, id: 'bf-moved', driverId: owner },
      { kind: 'trip' as const, id: tripId, driverId: owner },
    ];
    const applied = await applyBackfill(asyncDb, CAR, 'logged', planned, ctx.user.id, false);
    expect(applied.entries.map((e) => e.id)).toEqual([tripId]);
    expect(await payerOf('bf-moved')).toBeNull();

    await ctx.sql.run('UPDATE vehicles SET car_share_enabled = FALSE WHERE id = ?', [CAR]);
    await expect(
      applyBackfill(asyncDb, CAR, 'logged', planned, ctx.user.id, false)
    ).rejects.toThrow('Car sharing');
    await expect(undoBackfill(asyncDb, CAR, applied.batchId ?? '', false)).rejects.toThrow(
      'Car sharing'
    );
  });
});

describe('backfilling past entries', () => {
  test('"who logged it" previews first, then credits each entry to the member who logged it', async () => {
    const preview = await post<Summary>(`${base}/backfill/preview`, { mode: 'logged' });
    const owner = await driverOf(ctx.user.id);
    const editor = await driverOf(m.editor.id);
    expect(preview.total).toBeGreaterThanOrEqual(3);
    expect(preview.expenses).toBe(1);
    expect(preview.byDriver.find((d) => d.driverId === editor)?.count).toBeGreaterThanOrEqual(2);
    expect(await tripDrivers()).toEqual([null, null]);

    const applied = await post<Summary & { batchId: string }>(
      `${base}/backfill`,
      { mode: 'logged' },
      201
    );
    expect(applied.total).toBe(preview.total);
    expect(await tripDrivers()).toEqual([owner, editor]);
  });

  test('undo reverts the whole batch, but leaves entries someone has changed since', async () => {
    const { batchId } = await post<{ batchId: string }>(
      `${base}/backfill`,
      { mode: 'logged' },
      201
    );
    const guest = await post<{ id: string }>(base, { name: 'Riley' }, 201);
    await ctx.sql.run('UPDATE trips SET driver_id = ? WHERE start_odometer = 1100', [guest.id]);

    const recent = await ctx.authed('GET', `${base}/backfill`);
    expect((await json<DataEnvelope<{ id: string }[]>>(recent)).data.map((b) => b.id)).toEqual([
      batchId,
    ]);
    await post(`${base}/backfill/${batchId}/undo`);
    expect(await tripDrivers()).toEqual([null, guest.id]);
    expect((await ctx.authed('POST', `${base}/backfill/${batchId}/undo`)).status).toBe(404);
  });

  test('a date range goes to one active driver, and only unattributed entries inside it change', async () => {
    const owner = await driverOf(ctx.user.id);
    await ctx.sql.run('UPDATE trips SET driver_id = ? WHERE start_odometer = 1000', [owner]);
    const guest = await post<{ id: string }>(base, { name: 'Riley' }, 201);
    const range = {
      mode: 'range',
      driverId: guest.id,
      from: '2024-03-01T00:00:00.000Z',
      to: '2024-03-31T23:59:59.000Z',
    };
    const preview = await post<Summary>(`${base}/backfill/preview`, range);
    expect(preview.expenses).toBe(0);
    expect(preview.trips).toBe(1);
    await post(`${base}/backfill`, range, 201);
    expect(await tripDrivers()).toEqual([owner, guest.id]);

    await ctx.authed('PATCH', `${base}/${guest.id}`, { archived: true });
    expect((await ctx.authed('POST', `${base}/backfill/preview`, range)).status).toBe(400);
  });

  test('a split leg it fills in moves past the version of its other legs', async () => {
    await seedCar(ctx, 'bf-car-2');
    const later = 4102444800;
    await ctx.sql.run(
      "INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount, group_id, group_total, split_method, updated_at) VALUES ('bf-leg-1', ?, ?, 'maintenance', ?, 50, 'bf-group', 100, 'even', ?)",
      [CAR, ctx.user.id, Math.floor(Date.parse('2024-03-10') / 1000), later - 100]
    );
    await ctx.sql.run(
      "INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount, group_id, group_total, split_method, updated_at) VALUES ('bf-leg-2', 'bf-car-2', ?, 'maintenance', ?, 50, 'bf-group', 100, 'even', ?)",
      [ctx.user.id, Math.floor(Date.parse('2024-03-10') / 1000), later]
    );
    const guest = await post<{ id: string }>(base, { name: 'Riley' }, 201);
    await post(
      `${base}/backfill`,
      {
        mode: 'range',
        driverId: guest.id,
        from: '2024-03-01T00:00:00.000Z',
        to: '2024-03-31T23:59:59.000Z',
      },
      201
    );

    expect(await payerOf('bf-leg-1')).toBe(guest.id);
    const leg = (await ctx.sql.get(
      "SELECT updated_at AS t FROM expenses WHERE id = 'bf-leg-1'"
    )) as {
      t: number;
    };
    expect(leg.t).toBeGreaterThan(later);
  });

  test('"who logged it" credits archived drivers and skips people who never drove the car', async () => {
    await ctx.sql.run(
      "INSERT INTO trips (id, vehicle_id, user_id, start_odometer, end_odometer, purpose, trip_date, created_by) VALUES ('bf-stranger', ?, ?, 1200, 1250, 'personal', ?, ?)",
      [CAR, ctx.user.id, Math.floor(Date.parse('2024-03-09') / 1000), m.stranger.id]
    );
    const editor = await driverOf(m.editor.id);
    await ctx.sql.run('UPDATE vehicle_drivers SET archived_at = 1 WHERE id = ?', [editor]);
    await post(`${base}/backfill`, { mode: 'logged' }, 201);
    expect(await tripDrivers()).toEqual([await driverOf(ctx.user.id), editor, null]);
  });

  test('a fill-in that changes nothing saves no batch and creates nothing', async () => {
    await post(`${base}/backfill`, { mode: 'logged' }, 201);
    const again = await post<{ batchId: string | null; total: number }>(
      `${base}/backfill`,
      { mode: 'logged' },
      200
    );
    expect(again).toMatchObject({ batchId: null, total: 0 });
    const recent = await ctx.authed('GET', `${base}/backfill`);
    expect((await json<DataEnvelope<unknown[]>>(recent)).data).toHaveLength(1);
  });

  test("an undo that skips expenses you can't read leaves the batch open for someone who can", async () => {
    await insuranceExpense();
    const { batchId } = await post<{ batchId: string }>(
      `${base}/backfill`,
      { mode: 'logged' },
      201
    );
    expect(await payerOf('bf-ins')).not.toBeNull();
    await overrideOn(ctx, CAR, m.coOwner, 'vehicle.insurance.read', 'deny');

    const partial = await m.coOwner.request('POST', `${base}/backfill/${batchId}/undo`);
    expect(partial.status).toBe(200);
    expect(await payerOf('bf-ins')).not.toBeNull();
    expect(await tripDrivers()).toEqual([null, null]);
    const left = await json<DataEnvelope<{ id: string; total: number }[]>>(
      await ctx.authed('GET', `${base}/backfill`)
    );
    expect(left.data).toEqual([expect.objectContaining({ id: batchId, total: 1 })]);

    await post(`${base}/backfill/${batchId}/undo`);
    expect(await payerOf('bf-ins')).toBeNull();
    const after = await json<DataEnvelope<unknown[]>>(await ctx.authed('GET', `${base}/backfill`));
    expect(after.data).toHaveLength(0);
  });

  test("skips expenses the manager can't read", async () => {
    await insuranceExpense();
    await overrideOn(ctx, CAR, m.coOwner, 'vehicle.insurance.read', 'deny');
    const range = {
      mode: 'range',
      driverId: await driverOf(ctx.user.id),
      from: '2024-01-01T00:00:00.000Z',
      to: '2024-12-31T23:59:59.000Z',
    };
    const asCoOwner = async (path: string) =>
      (await json<DataEnvelope<Summary>>(await m.coOwner.request('POST', path, range))).data;
    expect((await asCoOwner(`${base}/backfill/preview`)).expenses).toBe(1);
    expect((await post<Summary>(`${base}/backfill/preview`, range)).expenses).toBe(2);
    await asCoOwner(`${base}/backfill`);
    expect(await payerOf('bf-ins')).toBeNull();
  });

  test('stays within the car and only works while car sharing is on', async () => {
    const { batchId } = await post<{ batchId: string }>(
      `${base}/backfill`,
      { mode: 'logged' },
      201
    );
    await seedCar(ctx, 'bf-other');
    const other = '/api/v1/vehicles/bf-other/drivers';
    await ctx.authed('PUT', '/api/v1/vehicles/bf-other/car-share', { enabled: true });
    expect((await ctx.authed('POST', `${other}/backfill/${batchId}/undo`)).status).toBe(404);
    const foreign = {
      mode: 'range',
      driverId: await driverOf(ctx.user.id),
      from: '2024-01-01T00:00:00.000Z',
      to: '2024-12-31T23:59:59.000Z',
    };
    expect((await ctx.authed('POST', `${other}/backfill/preview`, foreign)).status).toBe(400);

    await ctx.authed('PUT', `/api/v1/vehicles/${CAR}/car-share`, { enabled: false });
    const off = await ctx.authed('POST', `${base}/backfill/preview`, { mode: 'logged' });
    expect(off.status).toBe(404);
  });

  test('only people who manage drivers can backfill', async () => {
    const res = await m.editor.request('POST', `${base}/backfill/preview`, { mode: 'logged' });
    expect(res.status).toBe(403);
  });
});
