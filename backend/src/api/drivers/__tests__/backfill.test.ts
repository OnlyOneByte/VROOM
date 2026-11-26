import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { type Members, seedCar, seedMembers } from '../../../test-helpers/members';

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
  seedCar(ctx, CAR);
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

const tripDrivers = () =>
  (
    ctx.sqlite.query('SELECT driver_id AS d FROM trips ORDER BY start_odometer').all() as {
      d: string | null;
    }[]
  ).map((r) => r.d);

describe('backfilling past entries', () => {
  test('"who logged it" previews first, then credits each entry to the member who logged it', async () => {
    const preview = await post<Summary>(`${base}/backfill/preview`, { mode: 'logged' });
    const owner = await driverOf(ctx.user.id);
    const editor = await driverOf(m.editor.id);
    expect(preview.total).toBeGreaterThanOrEqual(3);
    expect(preview.expenses).toBe(1);
    expect(preview.byDriver.find((d) => d.driverId === editor)?.count).toBeGreaterThanOrEqual(2);
    expect(tripDrivers()).toEqual([null, null]);

    const applied = await post<Summary & { batchId: string }>(
      `${base}/backfill`,
      { mode: 'logged' },
      201
    );
    expect(applied.total).toBe(preview.total);
    expect(tripDrivers()).toEqual([owner, editor]);
  });

  test('undo reverts the whole batch, but leaves entries someone has changed since', async () => {
    const { batchId } = await post<{ batchId: string }>(
      `${base}/backfill`,
      { mode: 'logged' },
      201
    );
    const guest = await post<{ id: string }>(base, { name: 'Riley' }, 201);
    ctx.sqlite.run('UPDATE trips SET driver_id = ? WHERE start_odometer = 1100', [guest.id]);

    const recent = await ctx.authed('GET', `${base}/backfill`);
    expect((await json<DataEnvelope<{ id: string }[]>>(recent)).data.map((b) => b.id)).toEqual([
      batchId,
    ]);
    await post(`${base}/backfill/${batchId}/undo`);
    expect(tripDrivers()).toEqual([null, guest.id]);
    expect((await ctx.authed('POST', `${base}/backfill/${batchId}/undo`)).status).toBe(404);
  });

  test('a date range goes to one active driver, and only unattributed entries inside it change', async () => {
    const guest = await post<{ id: string }>(base, { name: 'Riley' }, 201);
    const range = {
      mode: 'range',
      driverId: guest.id,
      from: '2024-03-01T00:00:00.000Z',
      to: '2024-03-31T23:59:59.000Z',
    };
    const preview = await post<Summary>(`${base}/backfill/preview`, range);
    expect(preview.expenses).toBe(0);
    expect(preview.trips).toBe(2);
    await post(`${base}/backfill`, range, 201);
    expect(tripDrivers()).toEqual([guest.id, guest.id]);

    await ctx.authed('PATCH', `${base}/${guest.id}`, { archived: true });
    expect((await ctx.authed('POST', `${base}/backfill/preview`, range)).status).toBe(400);
  });

  test('only people who manage drivers can backfill', async () => {
    const res = await m.editor.request('POST', `${base}/backfill/preview`, { mode: 'logged' });
    expect(res.status).toBe(403);
  });
});
