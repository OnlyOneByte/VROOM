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

type TripRow = { vehicleId: string; driverId?: string | null };

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
