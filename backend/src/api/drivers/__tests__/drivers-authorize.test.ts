import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type PaginatedEnvelope,
  type RequestFn,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { createInvitee } from '../../../test-helpers/invitee';
import { type Members, overrideOn, seedCar, seedMembers } from '../../../test-helpers/members';

let ctx: TestApp;
let m: Members;
const CAR = 'dr-car';
const OTHER = 'dr-other';
const drivers = `/api/v1/vehicles/${CAR}/drivers`;
const sharing = `/api/v1/vehicles/${CAR}/car-share`;

interface Driver {
  id: string;
  userId: string | null;
  name: string;
  color: string | null;
  archived: boolean;
}

beforeEach(async () => {
  ctx = await createTestApp();
  await seedCar(ctx, CAR);
  await seedCar(ctx, OTHER);
  m = await seedMembers(ctx, CAR, 'dr');
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

const status = (request: RequestFn, method: string, path: string, body?: unknown) =>
  request(method, path, body).then((res) => res.status);

async function listDrivers(request: RequestFn = ctx.authed): Promise<Driver[]> {
  const res = await request('GET', drivers);
  expect(res.status).toBe(200);
  return (await json<DataEnvelope<Driver[]>>(res)).data;
}

const driverOf = (list: Driver[], userId: string) => list.find((d) => d.userId === userId);

const trip = (extra: Record<string, unknown> = {}) => ({
  vehicleId: CAR,
  startOdometer: 100,
  endOdometer: 150,
  purpose: 'personal',
  tripDate: '2024-03-01',
  ...extra,
});

describe('turning car sharing on and managing drivers', () => {
  test('only managers turn it on, and it creates a driver for the owner and each member', async () => {
    expect(await status(ctx.authed, 'GET', drivers)).toBe(404);
    expect(await status(m.editor.request, 'PUT', sharing, { enabled: true })).toBe(403);
    expect(await status(m.viewer.request, 'PUT', sharing, { enabled: true })).toBe(403);
    expect(await status(m.stranger.request, 'PUT', sharing, { enabled: true })).toBe(404);
    expect(await status(m.coOwner.request, 'PUT', sharing, { enabled: true })).toBe(200);

    const list = await listDrivers();
    for (const userId of [ctx.user.id, m.coOwner.id, m.editor.id, m.viewer.id]) {
      expect(driverOf(list, userId)?.archived).toBe(false);
    }
    expect(await status(m.editor.request, 'GET', drivers)).toBe(200);
    expect(await status(m.viewer.request, 'GET', drivers)).toBe(403);
  });

  test('guests can be added, renamed, recoloured and archived; members keep their own name', async () => {
    await ctx.authed('PUT', sharing, { enabled: true });
    expect(await status(m.editor.request, 'POST', drivers, { name: 'Riley' })).toBe(403);
    const added = await m.coOwner.request('POST', drivers, { name: 'Riley', color: 'chart-3' });
    expect(added.status).toBe(201);
    const guest = (await json<DataEnvelope<Driver>>(added)).data;
    expect(guest).toMatchObject({ userId: null, name: 'Riley', color: 'chart-3' });

    expect(await status(ctx.authed, 'PATCH', `${drivers}/${guest.id}`, { name: 'Ri' })).toBe(200);
    expect(await status(ctx.authed, 'PATCH', `${drivers}/${guest.id}`, { color: 'red' })).toBe(400);
    expect(await status(ctx.authed, 'PATCH', `${drivers}/${guest.id}`, { archived: true })).toBe(
      200
    );
    const member = driverOf(await listDrivers(), m.editor.id);
    expect(await status(ctx.authed, 'PATCH', `${drivers}/${member?.id}`, { name: 'X' })).toBe(400);
    expect(
      await status(ctx.authed, 'PATCH', `${drivers}/${member?.id}`, { color: 'chart-5' })
    ).toBe(200);
  });

  test('accepting a share adds a driver, and declining it archives the driver', async () => {
    await ctx.authed('PUT', sharing, { enabled: true });
    const newcomer = await createInvitee(ctx, 'dr-newcomer');
    await newcomer.acceptShare(CAR, 'editor');
    expect(driverOf(await listDrivers(), newcomer.id)?.archived).toBe(false);
    const share = (await ctx.sql.get('SELECT id FROM vehicle_shares WHERE shared_with_id = ?', [
      newcomer.id,
    ])) as { id: string };
    expect(await status(newcomer.request, 'POST', `/api/v1/shares/${share.id}/decline`)).toBe(200);
    expect(driverOf(await listDrivers(), newcomer.id)?.archived).toBe(true);
  });
});

describe('recording who drove or paid', () => {
  test('an entry defaults to the person logging it, and recording someone else needs driver.record', async () => {
    await ctx.authed('PUT', sharing, { enabled: true });
    const list = await listDrivers();
    const editorDriver = driverOf(list, m.editor.id);
    const coOwnerDriver = driverOf(list, m.coOwner.id);

    const mine = await m.editor.request('POST', '/api/v1/trips', trip());
    expect(mine.status).toBe(201);
    expect((await json<DataEnvelope<{ driverId?: string }>>(mine)).data.driverId).toBe(
      editorDriver?.id
    );
    expect(
      await status(m.editor.request, 'POST', '/api/v1/trips', trip({ driverId: coOwnerDriver?.id }))
    ).toBe(201);

    await overrideOn(ctx, CAR, m.editor, 'vehicle.driver.record', 'deny');
    expect(
      await status(m.editor.request, 'POST', '/api/v1/trips', trip({ driverId: coOwnerDriver?.id }))
    ).toBe(403);
    const reading = await m.editor.request('POST', `/api/v1/odometer/${CAR}`, {
      odometer: 2000,
      recordedAt: '2024-04-01',
      driverId: editorDriver?.id,
    });
    expect(reading.status).toBe(201);
  });

  test('a driver must be active and drive this car, and car sharing must be on', async () => {
    expect(await status(ctx.authed, 'POST', '/api/v1/trips', trip({ driverId: 'nope' }))).toBe(400);
    await ctx.authed('PUT', sharing, { enabled: true });
    await ctx.sql.run(
      "INSERT INTO vehicle_drivers (id, vehicle_id, name) VALUES ('elsewhere', ?, 'X')",
      [OTHER]
    );
    expect(await status(ctx.authed, 'POST', '/api/v1/trips', trip({ driverId: 'elsewhere' }))).toBe(
      400
    );
    const guest = (
      await json<DataEnvelope<Driver>>(await ctx.authed('POST', drivers, { name: 'Riley' }))
    ).data;
    await ctx.authed('PATCH', `${drivers}/${guest.id}`, { archived: true });
    expect(await status(ctx.authed, 'POST', '/api/v1/trips', trip({ driverId: guest.id }))).toBe(
      400
    );
  });

  test('the payer is recorded on expenses and cleared when the expense moves to another car', async () => {
    await ctx.authed('PUT', sharing, { enabled: true });
    const own = driverOf(await listDrivers(), ctx.user.id);
    const created = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId: CAR,
      category: 'maintenance',
      date: '2024-03-01',
      expenseAmount: 40,
    });
    const expense = (await json<DataEnvelope<{ id: string; paidByDriverId?: string }>>(created))
      .data;
    expect(expense.paidByDriverId).toBe(own?.id);
    await ctx.authed('PUT', `/api/v1/expenses/${expense.id}`, { vehicleId: OTHER });
    expect(
      await ctx.sql.get('SELECT paid_by_driver_id FROM expenses WHERE id = ?', [expense.id])
    ).toEqual({ paid_by_driver_id: null });
  });

  test('people who neither record drivers nor see driver figures get no driver fields', async () => {
    await ctx.authed('PUT', sharing, { enabled: true });
    await ctx.authed('POST', '/api/v1/trips', trip());
    const rows = async (request: RequestFn) =>
      (
        await json<PaginatedEnvelope<Record<string, unknown>>>(
          await request('GET', `/api/v1/trips?vehicleId=${CAR}`)
        )
      ).data;
    expect((await rows(m.editor.request))[0]).toHaveProperty('driverId');
    expect((await rows(m.viewer.request))[0]).not.toHaveProperty('driverId');
  });

  test('split expenses keep the payer hidden from people who cannot see drivers', async () => {
    await ctx.authed('PUT', sharing, { enabled: true });
    const res = await ctx.authed('POST', '/api/v1/expenses/split', {
      splitConfig: { method: 'even', vehicleIds: [CAR] },
      category: 'maintenance',
      totalAmount: 60,
      date: '2024-06-01T00:00:00.000Z',
    });
    const { groupId } = (await json<DataEnvelope<{ groupId: string }>>(res)).data;
    const own = driverOf(await listDrivers(), ctx.user.id);
    await ctx.sql.run('UPDATE expenses SET paid_by_driver_id = ? WHERE group_id = ?', [
      own?.id ?? null,
      groupId,
    ]);
    const legs = async (request: RequestFn) =>
      (
        await json<DataEnvelope<{ siblings: Record<string, unknown>[] }>>(
          await request('GET', `/api/v1/expenses/split/${groupId}`)
        )
      ).data.siblings;
    expect((await legs(m.editor.request))[0]?.paidByDriverId).toBe(own?.id);
    expect((await legs(m.viewer.request))[0]).not.toHaveProperty('paidByDriverId');
  });

  test("moving an expense to another car can't clear someone else's payer without driver.record", async () => {
    await ctx.authed('PUT', sharing, { enabled: true });
    await seedCarShared();
    const own = driverOf(await listDrivers(), ctx.user.id);
    const created = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId: CAR,
      category: 'maintenance',
      date: '2024-03-01',
      expenseAmount: 40,
    });
    const expense = (await json<DataEnvelope<{ id: string }>>(created)).data;
    await overrideOn(ctx, CAR, m.editor, 'vehicle.driver.record', 'deny');
    expect(
      await status(m.editor.request, 'PUT', `/api/v1/expenses/${expense.id}`, { vehicleId: OTHER })
    ).toBe(403);
    expect(
      await ctx.sql.get('SELECT paid_by_driver_id FROM expenses WHERE id = ?', [expense.id])
    ).toEqual({ paid_by_driver_id: own?.id });
  });

  test('each split leg defaults its payer to the person logging it', async () => {
    await ctx.authed('PUT', sharing, { enabled: true });
    const res = await ctx.authed('POST', '/api/v1/expenses/split', {
      splitConfig: { method: 'even', vehicleIds: [CAR, OTHER] },
      category: 'maintenance',
      totalAmount: 60,
      date: '2024-06-01T00:00:00.000Z',
    });
    const legs = (await json<DataEnvelope<{ siblings: Record<string, unknown>[] }>>(res)).data
      .siblings;
    const own = driverOf(await listDrivers(), ctx.user.id);
    expect(legs.find((leg) => leg.vehicleId === CAR)?.paidByDriverId).toBe(own?.id);
    expect(legs.find((leg) => leg.vehicleId === OTHER)?.paidByDriverId).toBeNull();
  });

  test("each split leg's payer is the logger's driver on that leg's car", async () => {
    await ctx.authed('PUT', sharing, { enabled: true });
    await ctx.authed('PUT', `/api/v1/vehicles/${OTHER}/car-share`, { enabled: true });
    const own = driverOf(await listDrivers(), ctx.user.id);
    const otherRes = await ctx.authed('GET', `/api/v1/vehicles/${OTHER}/drivers`);
    const otherOwn = driverOf((await json<DataEnvelope<Driver[]>>(otherRes)).data, ctx.user.id);
    expect(own?.id).toBeDefined();
    expect(otherOwn?.id).toBeDefined();
    expect(otherOwn?.id).not.toBe(own?.id);
    const res = await ctx.authed('POST', '/api/v1/expenses/split', {
      splitConfig: { method: 'even', vehicleIds: [CAR, OTHER] },
      category: 'maintenance',
      totalAmount: 60,
      date: '2024-06-01T00:00:00.000Z',
    });
    expect(res.status).toBe(201);
    const legs = (await json<DataEnvelope<{ siblings: Record<string, unknown>[] }>>(res)).data
      .siblings;
    expect(legs.find((leg) => leg.vehicleId === CAR)?.paidByDriverId).toBe(own?.id);
    expect(legs.find((leg) => leg.vehicleId === OTHER)?.paidByDriverId).toBe(otherOwn?.id);
  });

  test('moving an expense still needs driver.record after car sharing is turned off', async () => {
    await ctx.authed('PUT', sharing, { enabled: true });
    await seedCarShared();
    const created = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId: CAR,
      category: 'maintenance',
      date: '2024-03-01',
      expenseAmount: 40,
    });
    const expense = (await json<DataEnvelope<{ id: string }>>(created)).data;
    await ctx.authed('PUT', sharing, { enabled: false });
    await overrideOn(ctx, CAR, m.editor, 'vehicle.driver.record', 'deny');
    expect(
      await status(m.editor.request, 'PUT', `/api/v1/expenses/${expense.id}`, { vehicleId: OTHER })
    ).toBe(403);
  });

  test('the car and the car list tell the app whether sharing is on and what you may do', async () => {
    const carShare = async (request: RequestFn) =>
      (
        await json<DataEnvelope<{ carShare: unknown }>>(
          await request('GET', `/api/v1/vehicles/${CAR}`)
        )
      ).data.carShare;
    const listed = async (request: RequestFn) =>
      (
        await json<DataEnvelope<{ id: string; carShare: unknown }[]>>(
          await request('GET', '/api/v1/vehicles?include=shared')
        )
      ).data.find((v) => v.id === CAR)?.carShare;
    const access = (enabled: boolean, manage: boolean, record: boolean) => ({
      enabled,
      manage,
      record,
    });
    expect(await carShare(ctx.authed)).toEqual(access(false, true, true));
    await ctx.authed('PUT', sharing, { enabled: true });
    expect(await carShare(m.coOwner.request)).toEqual(access(true, true, true));
    expect(await carShare(m.editor.request)).toEqual(access(true, false, true));
    expect(await listed(m.viewer.request)).toEqual(access(true, false, false));
    expect(await listed(ctx.authed)).toEqual(access(true, true, true));
  });

  async function seedCarShared(): Promise<void> {
    await ctx.sql.run(
      "INSERT INTO vehicle_shares (id, vehicle_id, owner_id, shared_with_id, level, status) VALUES ('other-share', ?, ?, ?, 'editor', 'accepted')",
      [OTHER, ctx.user.id, m.editor.id]
    );
    await ctx.sql.run(
      "INSERT INTO role_assignments (id, user_id, role_id, scope_id, granted_by) VALUES ('other-ra', ?, 'builtin_editor', ?, ?)",
      [m.editor.id, OTHER, ctx.user.id]
    );
  }
});
