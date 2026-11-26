import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type RequestFn,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { type Members, overrideOn, seedCar, seedMembers } from '../../../test-helpers/members';

let ctx: TestApp;
let m: Members;
const CAR = 'odo-car';

function reading(id: string, odometer: number, createdBy: string | null, vehicleId = CAR): void {
  ctx.sqlite.run(
    'INSERT INTO odometer_entries (id, vehicle_id, user_id, odometer, recorded_at, created_by) VALUES (?, ?, (SELECT user_id FROM vehicles WHERE id = ?), ?, 1717200000, ?)',
    [id, vehicleId, vehicleId, odometer, createdBy]
  );
}

const list = (request: RequestFn, vehicleId = CAR) =>
  request('GET', `/api/v1/odometer/${vehicleId}`).then((res) => res.status);
const add = (request: RequestFn) =>
  request('POST', `/api/v1/odometer/${CAR}`, {
    odometer: 50000,
    recordedAt: '2024-07-01T00:00:00.000Z',
  }).then((res) => res.status);
const remove = (request: RequestFn, id: string) =>
  request('DELETE', `/api/v1/odometer/${id}`).then((res) => res.status);

beforeEach(async () => {
  ctx = await createTestApp();
  seedCar(ctx, CAR);
  m = await seedMembers(ctx, CAR, 'odo');
  reading('owners-reading', 1000, null);
  reading('editors-reading', 2000, m.editor.id);
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

describe('odometer resolves through can() for every role', () => {
  test('reads: members see readings, a stranger gets 404, a disabled member 403', async () => {
    for (const request of [ctx.authed, m.coOwner.request, m.editor.request, m.viewer.request]) {
      expect(await list(request)).toBe(200);
    }
    expect(await list(m.stranger.request)).toBe(404);
    expect(await list(m.disabled.request)).toBe(403);
    expect((await m.viewer.request('GET', '/api/v1/odometer/entry/owners-reading')).status).toBe(
      200
    );
  });

  test('writes: editors and co-owners add readings, viewers only with an allow override', async () => {
    expect(await add(m.editor.request)).toBe(201);
    expect(await add(m.coOwner.request)).toBe(201);
    expect(await add(m.viewer.request)).toBe(403);
    overrideOn(ctx, CAR, m.viewer, 'vehicle.odometer.write', 'allow');
    expect(await add(m.viewer.request)).toBe(201);
  });

  test('deletes: editors only their own, co-owners any; a deny override wins', async () => {
    expect(await remove(m.editor.request, 'owners-reading')).toBe(403);
    expect(await remove(m.editor.request, 'editors-reading')).toBe(200);
    overrideOn(ctx, CAR, m.coOwner, 'vehicle.odometer.delete', 'deny');
    expect(await remove(m.coOwner.request, 'owners-reading')).toBe(403);
    expect(await remove(m.viewer.request, 'owners-reading')).toBe(403);
    expect(await remove(m.stranger.request, 'owners-reading')).toBe(404);
    expect(await remove(ctx.authed, 'owners-reading')).toBe(200);
  });

  test('a deny override on read hides the readings from an editor', async () => {
    overrideOn(ctx, CAR, m.editor, 'vehicle.odometer.read', 'deny');
    expect(await list(m.editor.request)).toBe(403);
    expect(await add(m.editor.request)).toBe(403);
  });

  test('the history leaves out fill-ups for a member denied expense reads', async () => {
    ctx.sqlite.run(
      "INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount, mileage) VALUES ('fill-up', ?, ?, 'fuel', 1717300000, 4000, 1500)",
      [CAR, ctx.user.id]
    );
    const history = async (request: RequestFn) => {
      const res = await request('GET', `/api/v1/odometer/${CAR}/history`);
      const body = (await res.json()) as {
        data: { source: string }[];
        pagination: { totalCount: number };
      };
      return {
        sources: body.data.map((row) => row.source).sort(),
        total: body.pagination.totalCount,
      };
    };
    expect(await history(m.editor.request)).toEqual({
      sources: ['expense', 'manual', 'manual'],
      total: 3,
    });
    overrideOn(ctx, CAR, m.editor, 'vehicle.expense.read', 'deny');
    expect(await history(m.editor.request)).toEqual({ sources: ['manual', 'manual'], total: 2 });
  });

  test("another person's car stays out of reach", async () => {
    seedCar(ctx, 'their-car', m.stranger.id);
    reading('their-reading', 9000, null, 'their-car');
    expect(await list(ctx.authed, 'their-car')).toBe(404);
    expect((await ctx.authed('GET', '/api/v1/odometer/entry/their-reading')).status).toBe(404);
    expect(await remove(ctx.authed, 'their-reading')).toBe(404);
  });
});
