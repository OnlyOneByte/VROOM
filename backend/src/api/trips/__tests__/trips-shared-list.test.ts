import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { type Members, overrideOn, seedCar, seedMembers } from '../../../test-helpers/members';

let ctx: TestApp;
let m: Members;
const CAR = 'tsl-car';

beforeEach(async () => {
  ctx = await createTestApp();
  await seedCar(ctx, CAR);
  m = await seedMembers(ctx, CAR, 'tsl');
  const res = await ctx.authed('POST', '/api/v1/trips', {
    vehicleId: CAR,
    startOdometer: 100,
    endOdometer: 160,
    purpose: 'business',
    tripDate: '2024-03-01',
  });
  expect(res.status).toBe(201);
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

type TripRow = {
  id: string;
  vehicleId: string;
  driverId?: string | null;
  access?: { edit: boolean; delete: boolean };
};

async function listedBy(member: Members['viewer']): Promise<TripRow[]> {
  const res = await member.request('GET', '/api/v1/trips');
  expect(res.status).toBe(200);
  return (await json<DataEnvelope<TripRow[]>>(res)).data;
}

async function summaryTripsBy(member: Members['viewer']): Promise<number> {
  const res = await member.request('GET', '/api/v1/trips/summary');
  expect(res.status).toBe(200);
  return (await json<DataEnvelope<{ tripCount: number }>>(res)).data.tripCount;
}

describe('trips list and summary across cars', () => {
  test('a member who may read trips on a shared car sees them', async () => {
    expect((await listedBy(m.viewer)).map((t) => t.vehicleId)).toEqual([CAR]);
    expect(await summaryTripsBy(m.viewer)).toBe(1);
  });

  test('a member who may not read trips there sees none', async () => {
    await overrideOn(ctx, CAR, m.viewer, 'vehicle.trip.read', 'deny');

    expect(await listedBy(m.viewer)).toEqual([]);
    expect(await summaryTripsBy(m.viewer)).toBe(0);
  });

  test('driver fields follow the member permissions on each car', async () => {
    await overrideOn(ctx, CAR, m.viewer, 'vehicle.driver.record', 'deny');
    await overrideOn(ctx, CAR, m.viewer, 'vehicle.driver_stats.read', 'deny');

    const [row] = await listedBy(m.viewer);
    expect(row).toBeDefined();
    expect(row && 'driverId' in row).toBe(false);
  });
});

describe('trip rows for members of a shared car', () => {
  test('carry no user ids, while the owner still gets them', async () => {
    const [shared] = await listedBy(m.viewer);
    expect(shared && ('userId' in shared || 'createdBy' in shared)).toBe(false);

    const own = (
      await json<DataEnvelope<Record<string, unknown>[]>>(await ctx.authed('GET', '/api/v1/trips'))
    ).data[0];
    expect(own?.['userId']).toBe(ctx.user.id);
  });

  test('say what each member may do with each trip', async () => {
    const res = await m.editor.request('POST', '/api/v1/trips', {
      vehicleId: CAR,
      startOdometer: 160,
      endOdometer: 200,
      purpose: 'personal',
      tripDate: '2024-03-02',
    });
    expect(res.status).toBe(201);
    const created = (await json<DataEnvelope<TripRow>>(res)).data;
    expect(created.access).toEqual({ edit: true, delete: true });

    const rows = await listedBy(m.editor);
    const ownersTrip = rows.find((row) => row.id !== created.id);
    expect(ownersTrip?.access).toEqual({ edit: true, delete: false });
    expect((await listedBy(m.viewer))[0]?.access).toEqual({ edit: false, delete: false });
  });

  test('shared cars say whether the member may log trips on them', async () => {
    const writes = async (member: Members['viewer']) => {
      const res = await member.request('GET', '/api/v1/vehicles?include=shared');
      const list = (
        await json<DataEnvelope<{ id: string; sharedAccess?: { writesTrips: boolean } }[]>>(res)
      ).data;
      return list.find((v) => v.id === CAR)?.sharedAccess?.writesTrips;
    };
    expect(await writes(m.viewer)).toBe(false);
    expect(await writes(m.editor)).toBe(true);
    await overrideOn(ctx, CAR, m.viewer, 'vehicle.trip.write', 'allow');
    expect(await writes(m.viewer)).toBe(true);
  });
});
