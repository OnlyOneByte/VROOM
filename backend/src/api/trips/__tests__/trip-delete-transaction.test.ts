import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';
import { odometerRepository } from '../../odometer/repository';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

async function createTrip(vehicleId: string): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/trips', {
    vehicleId,
    startOdometer: 1000,
    endOdometer: 1080,
    purpose: 'business',
    tripDate: '2026-05-01T12:00:00.000Z',
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data.id;
}

function tripIds(): string[] {
  return (ctx.sqlite.query('SELECT id FROM trips ORDER BY id').all() as { id: string }[]).map(
    (r) => r.id
  );
}

function readings(): { odometer: number; source_trip_id: string | null }[] {
  return ctx.sqlite
    .query('SELECT odometer, source_trip_id FROM odometer_entries ORDER BY odometer')
    .all() as { odometer: number; source_trip_id: string | null }[];
}

describe('a trip delete and its reading change commit or roll back together', () => {
  test('a failed reading delete keeps the trip and its reading', async () => {
    const vehicleId = await seedVehicle(ctx);
    const tripId = await createTrip(vehicleId);
    const spy = spyOn(odometerRepository, 'deleteLinkedTripEntry').mockImplementation(() => {
      throw new Error('disk I/O error');
    });
    try {
      const res = await ctx.authed('DELETE', `/api/v1/trips/${tripId}?keepOdometer=false`);
      expect(res.status).toBe(500);
    } finally {
      spy.mockRestore();
    }

    expect(tripIds()).toEqual([tripId]);
    expect(readings()).toEqual([{ odometer: 1080, source_trip_id: tripId }]);
  });

  test('a failed hand-over keeps the trip and leaves the reading linked to it', async () => {
    const vehicleId = await seedVehicle(ctx);
    const first = await createTrip(vehicleId);
    const second = await createTrip(vehicleId);
    const spy = spyOn(odometerRepository, 'handOverLinkedTripEntry').mockImplementation(() => {
      throw new Error('disk I/O error');
    });
    try {
      const res = await ctx.authed('DELETE', `/api/v1/trips/${first}`);
      expect(res.status).toBe(500);
    } finally {
      spy.mockRestore();
    }

    expect(tripIds()).toEqual([first, second].sort());
    expect(readings()).toEqual([{ odometer: 1080, source_trip_id: first }]);
  });

  test('a successful delete hands the shared reading to the other trip', async () => {
    const vehicleId = await seedVehicle(ctx);
    const first = await createTrip(vehicleId);
    const second = await createTrip(vehicleId);

    const res = await ctx.authed('DELETE', `/api/v1/trips/${first}`);

    expect(res.status).toBe(200);
    expect(tripIds()).toEqual([second]);
    expect(readings()).toEqual([{ odometer: 1080, source_trip_id: second }]);
  });
});
