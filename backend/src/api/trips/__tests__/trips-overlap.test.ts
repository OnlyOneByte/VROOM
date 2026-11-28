import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;
let vehicleId: string;

beforeEach(async () => {
  ctx = await createTestApp();
  vehicleId = await seedVehicle(ctx);
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

const log = (startOdometer: number, endOdometer: number, tripDate = '2024-06-20T12:00:00.000Z') =>
  ctx.authed('POST', '/api/v1/trips', {
    vehicleId,
    startOdometer,
    endOdometer,
    purpose: 'business',
    tripDate,
  });

describe('overlapping trips', () => {
  test('a trip whose distance overlaps another trip on the vehicle is refused', async () => {
    expect((await log(1000, 1100)).status).toBe(201);

    const res = await log(1050, 1200, '2024-06-21T12:00:00.000Z');

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('overlaps another trip');
  });

  test('trips that only touch end to start, or have no distance, are accepted', async () => {
    expect((await log(1000, 1100)).status).toBe(201);
    expect((await log(1100, 1200, '2024-06-21T12:00:00.000Z')).status).toBe(201);
    expect((await log(1200, 1200, '2024-06-21T13:00:00.000Z')).status).toBe(201);
  });

  test('an edit that makes a trip overlap another is refused and changes nothing', async () => {
    expect((await log(1000, 1100)).status).toBe(201);
    const second = await log(1100, 1200, '2024-06-21T12:00:00.000Z');
    const { id } = (await json<DataEnvelope<{ id: string }>>(second)).data;

    const res = await ctx.authed('PUT', `/api/v1/trips/${id}`, { startOdometer: 1080 });

    expect(res.status).toBe(400);
    const row = (await ctx.sql.get('SELECT start_odometer AS s FROM trips WHERE id = ?', [id])) as {
      s: number;
    };
    expect(row.s).toBe(1100);
  });
});
