import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type RequestFn, type TestApp } from '../../../test-helpers/http-client';
import { type Members, overrideOn, seedCar, seedMembers } from '../../../test-helpers/members';

let ctx: TestApp;
let m: Members;
const CAR = 'trip-car';

function trip(id: string, createdBy: string | null, vehicleId = CAR, end = 1200): void {
  ctx.sqlite.run(
    "INSERT INTO trips (id, vehicle_id, user_id, start_odometer, end_odometer, purpose, trip_date, created_by) VALUES (?, ?, (SELECT user_id FROM vehicles WHERE id = ?), 1000, ?, 'business', 1717200000, ?)",
    [id, vehicleId, vehicleId, end, createdBy]
  );
}

const list = (request: RequestFn, vehicleId = CAR) =>
  request('GET', `/api/v1/trips?vehicleId=${vehicleId}`).then((res) => res.status);
const log = (request: RequestFn, end: number) =>
  request('POST', '/api/v1/trips', {
    vehicleId: CAR,
    startOdometer: end - 50,
    endOdometer: end,
    tripDate: '2024-08-01T00:00:00.000Z',
    purpose: 'business',
  }).then((res) => res.status);
const remove = (request: RequestFn, id: string) =>
  request('DELETE', `/api/v1/trips/${id}`).then((res) => res.status);

beforeEach(async () => {
  ctx = await createTestApp();
  seedCar(ctx, CAR);
  m = await seedMembers(ctx, CAR, 'trip');
  trip('owners-trip', null);
  trip('editors-trip', m.editor.id);
});
afterEach(() => ctx.close());

describe('trips resolve through can() for every role', () => {
  test('reads: every member sees the trips, a stranger gets 404, a disabled member 403', async () => {
    for (const request of [ctx.authed, m.coOwner.request, m.editor.request, m.viewer.request]) {
      expect(await list(request)).toBe(200);
    }
    expect(await list(m.stranger.request)).toBe(404);
    expect(await list(m.disabled.request)).toBe(403);
    expect((await m.viewer.request('GET', `/api/v1/trips/summary?vehicleId=${CAR}`)).status).toBe(
      200
    );
  });

  test('writes: editors log trips on the owner’s books, viewers only with an allow override', async () => {
    expect(await log(m.editor.request, 5000)).toBe(201);
    const row = ctx.sqlite
      .query('SELECT user_id, created_by FROM trips WHERE end_odometer = 5000')
      .get() as { user_id: string; created_by: string };
    expect(row).toEqual({ user_id: ctx.user.id, created_by: m.editor.id });
    expect(await log(m.viewer.request, 6000)).toBe(403);
    overrideOn(ctx, CAR, m.viewer, 'vehicle.trip.write', 'allow');
    expect(await log(m.viewer.request, 6000)).toBe(201);
  });

  test('deletes: editors only their own, co-owners any; a deny override wins', async () => {
    expect(await remove(m.editor.request, 'owners-trip')).toBe(403);
    expect(await remove(m.editor.request, 'editors-trip')).toBe(200);
    expect(await remove(m.viewer.request, 'owners-trip')).toBe(403);
    overrideOn(ctx, CAR, m.coOwner, 'vehicle.trip.delete', 'deny');
    expect(await remove(m.coOwner.request, 'owners-trip')).toBe(403);
    expect(await remove(ctx.authed, 'owners-trip')).toBe(200);
  });

  test("the reading from an editor's trip stays theirs after the trip is deleted", async () => {
    expect(await log(m.editor.request, 7000)).toBe(201);
    const { id } = ctx.sqlite.query('SELECT id FROM trips WHERE end_odometer = 7000').get() as {
      id: string;
    };
    const deleted = await m.editor.request('DELETE', `/api/v1/trips/${id}?keepOdometer=true`);
    expect(deleted.status).toBe(200);
    const reading = ctx.sqlite
      .query('SELECT id, created_by FROM odometer_entries WHERE odometer = 7000')
      .get() as { id: string; created_by: string | null };
    expect(reading.created_by).toBe(m.editor.id);
    expect((await m.editor.request('DELETE', `/api/v1/odometer/${reading.id}`)).status).toBe(200);
  });

  test('a deny on trip reads hides them from a viewer', async () => {
    overrideOn(ctx, CAR, m.viewer, 'vehicle.trip.read', 'deny');
    expect(await list(m.viewer.request)).toBe(403);
  });

  test("another person's trips stay theirs", async () => {
    seedCar(ctx, 'their-car', m.stranger.id);
    trip('their-trip', null, 'their-car');
    expect(await list(ctx.authed, 'their-car')).toBe(404);
    expect(await remove(ctx.authed, 'their-trip')).toBe(404);
    const unfiltered = await ctx.authed('GET', '/api/v1/trips');
    const ids = ((await unfiltered.json()) as { data: { id: string }[] }).data.map((t) => t.id);
    expect(ids).not.toContain('their-trip');
  });
});
