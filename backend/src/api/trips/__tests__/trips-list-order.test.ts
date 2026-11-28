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

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

describe('trips on the same day', () => {
  test('page in a fixed order: newest created first, then by id', async () => {
    const vehicleId = await seedVehicle(ctx);
    const day = Math.floor(Date.parse('2024-06-20T12:00:00.000Z') / 1000);
    const rows: [string, number, number][] = [
      ['t-b', 300, day + 20],
      ['t-z', 100, day + 10],
      ['t-a', 200, day + 20],
    ];
    for (const [id, start, createdAt] of rows) {
      await ctx.sql.run(
        `INSERT INTO trips (id, vehicle_id, user_id, start_odometer, end_odometer, purpose, trip_date, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'business', ?, ?, ?)`,
        [id, vehicleId, ctx.user.id, start, start + 50, day, createdAt, createdAt]
      );
    }

    const pageAt = async (offset: number) => {
      const res = await ctx.authed('GET', `/api/v1/trips?limit=1&offset=${offset}`);
      expect(res.status).toBe(200);
      return (await json<DataEnvelope<{ id: string }[]>>(res)).data.map((t) => t.id);
    };

    expect([...(await pageAt(0)), ...(await pageAt(1)), ...(await pageAt(2))]).toEqual([
      't-b',
      't-a',
      't-z',
    ]);
  });
});
