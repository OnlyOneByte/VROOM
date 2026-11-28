import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type RequestFn,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { createInvitee } from '../../../test-helpers/invitee';
import { type Members, overrideOn, seedCar, seedMembers } from '../../../test-helpers/members';

let ctx: TestApp;
let m: Members;
const CAR = 'de-car';
const OTHER = 'de-other';
const drivers = `/api/v1/vehicles/${CAR}/drivers`;
const sharing = `/api/v1/vehicles/${CAR}/car-share`;

interface Driver {
  id: string;
  userId: string | null;
}

beforeEach(async () => {
  ctx = await createTestApp();
  await seedCar(ctx, CAR);
  await seedCar(ctx, OTHER);
  m = await seedMembers(ctx, CAR, 'de');
  await ctx.authed('PUT', sharing, { enabled: true });
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

const status = (request: RequestFn, method: string, path: string, body?: unknown) =>
  request(method, path, body).then((res) => res.status);

async function driverOf(userId: string): Promise<string> {
  const list = (await json<DataEnvelope<Driver[]>>(await ctx.authed('GET', drivers))).data;
  const found = list.find((d) => d.userId === userId);
  if (!found) throw new Error(`no driver for ${userId}`);
  return found.id;
}

async function addGuest(): Promise<string> {
  const res = await ctx.authed('POST', drivers, { name: 'Riley' });
  return (await json<DataEnvelope<{ id: string }>>(res)).data.id;
}

async function created(request: RequestFn, path: string, body: unknown): Promise<string> {
  const res = await request('POST', path, body);
  expect(res.status).toBe(201);
  return (await json<DataEnvelope<{ id: string }>>(res)).data.id;
}

const trip = (extra: Record<string, unknown> = {}) => ({
  vehicleId: CAR,
  startOdometer: 100,
  endOdometer: 150,
  purpose: 'personal',
  tripDate: '2024-03-01',
  ...extra,
});

const column = async (table: string, field: string, id: string) =>
  ((await ctx.sql.get(`SELECT ${field} AS v FROM ${table} WHERE id = ?`, [id])) as { v: unknown })
    .v;

describe('changing the driver on an existing entry', () => {
  test('a trip can be re-credited and cleared, and the reading it creates carries the driver', async () => {
    const guest = await addGuest();
    const id = await created(m.editor.request, '/api/v1/trips', trip({ driverId: guest }));
    expect(
      await ctx.sql.get('SELECT driver_id FROM odometer_entries WHERE vehicle_id = ?', [CAR])
    ).toEqual({ driver_id: guest });

    const editorDriver = await driverOf(m.editor.id);
    expect(
      await status(m.editor.request, 'PUT', `/api/v1/trips/${id}`, { driverId: editorDriver })
    ).toBe(200);
    expect(await column('trips', 'driver_id', id)).toBe(editorDriver);
    const readingDriver = async () =>
      (
        (await ctx.sql.get('SELECT driver_id AS v FROM odometer_entries WHERE source_trip_id = ?', [
          id,
        ])) as { v: string | null }
      ).v;
    expect(await readingDriver()).toBe(editorDriver);
    expect(await status(m.editor.request, 'PUT', `/api/v1/trips/${id}`, { driverId: null })).toBe(
      200
    );
    expect(await column('trips', 'driver_id', id)).toBeNull();
    expect(await readingDriver()).toBeNull();
  });

  test("without driver.record, someone else's reading can't be re-credited", async () => {
    const coOwnerDriver = await driverOf(m.coOwner.id);
    const id = await created(ctx.authed, `/api/v1/odometer/${CAR}`, {
      odometer: 2000,
      recordedAt: '2024-04-01',
      driverId: coOwnerDriver,
    });
    await overrideOn(ctx, CAR, m.editor, 'vehicle.driver.record', 'deny');
    const editorDriver = await driverOf(m.editor.id);
    expect(
      await status(m.editor.request, 'PUT', `/api/v1/odometer/${id}`, { driverId: editorDriver })
    ).toBe(403);
    expect(await status(m.editor.request, 'PUT', `/api/v1/odometer/${id}`, { note: 'ok' })).toBe(
      200
    );
    expect(await column('odometer_entries', 'driver_id', id)).toBe(coOwnerDriver);
  });

  test('a trip edit leaves a reading that now belongs to another trip alone', async () => {
    const guest = await addGuest();
    const first = await created(m.editor.request, '/api/v1/trips', trip({ driverId: guest }));
    const second = await created(m.editor.request, '/api/v1/trips', trip({ driverId: guest }));
    const editorDriver = await driverOf(m.editor.id);

    expect(
      await status(m.editor.request, 'PUT', `/api/v1/trips/${first}`, {
        driverId: editorDriver,
        endOdometer: 160,
      })
    ).toBe(200);

    const drivers = (await ctx.sql.all(
      'SELECT odometer AS o, driver_id AS d FROM odometer_entries WHERE vehicle_id = ? ORDER BY odometer',
      [CAR]
    )) as { o: number; d: string | null }[];
    expect(drivers).toEqual([
      { o: 150, d: guest },
      { o: 160, d: editorDriver },
    ]);
    expect(await column('trips', 'driver_id', second)).toBe(guest);
  });

  test("a trip's driver change keeps a reading someone else re-credited", async () => {
    const editorDriver = await driverOf(m.editor.id);
    const id = await created(m.editor.request, '/api/v1/trips', trip({ driverId: editorDriver }));
    const guest = await addGuest();
    const reading = (await ctx.sql.get('SELECT id FROM odometer_entries WHERE source_trip_id = ?', [
      id,
    ])) as { id: string };
    expect(
      await status(ctx.authed, 'PUT', `/api/v1/odometer/${reading.id}`, { driverId: guest })
    ).toBe(200);

    expect(await status(m.editor.request, 'PUT', `/api/v1/trips/${id}`, { driverId: null })).toBe(
      200
    );

    expect(await column('odometer_entries', 'driver_id', reading.id)).toBe(guest);
  });

  test.each([
    [
      'reading',
      `/api/v1/odometer/${CAR}`,
      { odometer: 2000, recordedAt: '2024-04-01' },
      'driverId',
    ],
    [
      'expense',
      '/api/v1/expenses',
      { vehicleId: CAR, category: 'maintenance', date: '2024-03-01', expenseAmount: 40 },
      'paidByDriverId',
    ],
  ])("a new %s can't name another car's driver", async (_kind, path, body, field) => {
    await ctx.sql.run(
      "INSERT INTO vehicle_drivers (id, vehicle_id, name) VALUES ('elsewhere', ?, 'X')",
      [OTHER]
    );
    expect(await status(ctx.authed, 'POST', path, { ...body, [field]: 'elsewhere' })).toBe(400);
  });
});

describe('drivers while car sharing is off, and members who come back', () => {
  test('drivers cannot be added or changed while car sharing is off', async () => {
    const guest = await addGuest();
    await ctx.authed('PUT', sharing, { enabled: false });
    expect(await status(ctx.authed, 'POST', drivers, { name: 'Sam' })).toBe(404);
    expect(await status(ctx.authed, 'PATCH', `${drivers}/${guest}`, { name: 'Ri' })).toBe(404);
  });

  test('someone who leaves and is shared the car again keeps the same driver', async () => {
    const newcomer = await createInvitee(ctx, 'de-newcomer');
    await newcomer.acceptShare(CAR, 'editor');
    const before = await driverOf(newcomer.id);
    const share = (await ctx.sql.get('SELECT id FROM vehicle_shares WHERE shared_with_id = ?', [
      newcomer.id,
    ])) as { id: string };
    expect(await status(ctx.authed, 'DELETE', `/api/v1/shares/${share.id}`)).toBe(200);
    expect(await column('vehicle_drivers', 'archived_at', before)).not.toBeNull();

    await newcomer.acceptShare(CAR, 'editor');
    expect(await driverOf(newcomer.id)).toBe(before);
    expect(await column('vehicle_drivers', 'archived_at', before)).toBeNull();
  });
});
