import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { repos } from '../../../app-context';
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

async function tripIds(): Promise<string[]> {
  return ((await ctx.sql.all('SELECT id FROM trips ORDER BY id')) as { id: string }[]).map(
    (r) => r.id
  );
}

async function readings(): Promise<{ odometer: number; source_trip_id: string | null }[]> {
  return (await ctx.sql.all(
    'SELECT odometer, source_trip_id FROM odometer_entries ORDER BY odometer'
  )) as { odometer: number; source_trip_id: string | null }[];
}

describe('a trip delete and its reading change commit or roll back together', () => {
  test('a failed reading delete keeps the trip and its reading', async () => {
    const vehicleId = await seedVehicle(ctx);
    const tripId = await createTrip(vehicleId);
    const spy = spyOn(repos().odometer, 'deleteLinkedTripEntry').mockImplementation(() => {
      throw new Error('disk I/O error');
    });
    try {
      const res = await ctx.authed('DELETE', `/api/v1/trips/${tripId}?keepOdometer=false`);
      expect(res.status).toBe(500);
    } finally {
      spy.mockRestore();
    }

    expect(await tripIds()).toEqual([tripId]);
    expect(await readings()).toEqual([{ odometer: 1080, source_trip_id: tripId }]);
  });

  test('a failed hand-over keeps the trip and leaves the reading linked to it', async () => {
    const vehicleId = await seedVehicle(ctx);
    const first = await createTrip(vehicleId);
    const second = await createTrip(vehicleId);
    const spy = spyOn(repos().odometer, 'handOverLinkedTripEntry').mockImplementation(() => {
      throw new Error('disk I/O error');
    });
    try {
      const res = await ctx.authed('DELETE', `/api/v1/trips/${first}`);
      expect(res.status).toBe(500);
    } finally {
      spy.mockRestore();
    }

    expect(await tripIds()).toEqual([first, second].sort());
    expect(await readings()).toEqual([{ odometer: 1080, source_trip_id: first }]);
  });

  test('a successful delete hands the shared reading to the other trip', async () => {
    const vehicleId = await seedVehicle(ctx);
    const first = await createTrip(vehicleId);
    const second = await createTrip(vehicleId);

    const res = await ctx.authed('DELETE', `/api/v1/trips/${first}`);

    expect(res.status).toBe(200);
    expect(await tripIds()).toEqual([second]);
    expect(await readings()).toEqual([{ odometer: 1080, source_trip_id: second }]);
  });
});

describe('the shared-reading lookup runs inside the reading change transaction', () => {
  function spyInTransaction(): { inTransaction: boolean[]; restore: () => void } {
    const inTransaction: boolean[] = [];
    const real = repos().trips.findOtherAtOdometerKey.bind(repos().trips);
    const spy = spyOn(repos().trips, 'findOtherAtOdometerKey').mockImplementation((args, db) => {
      inTransaction.push(ctx.sqlite.inTransaction);
      return real(args, db);
    });
    return { inTransaction, restore: () => spy.mockRestore() };
  }

  test('on delete', async () => {
    const vehicleId = await seedVehicle(ctx);
    const first = await createTrip(vehicleId);
    await createTrip(vehicleId);
    const lookup = spyInTransaction();
    try {
      const res = await ctx.authed('DELETE', `/api/v1/trips/${first}`);
      expect(res.status).toBe(200);
    } finally {
      lookup.restore();
    }
    expect(lookup.inTransaction).toEqual([true]);
  });

  test('on an end mileage edit', async () => {
    const vehicleId = await seedVehicle(ctx);
    const first = await createTrip(vehicleId);
    await createTrip(vehicleId);
    const lookup = spyInTransaction();
    try {
      const res = await ctx.authed('PUT', `/api/v1/trips/${first}`, { endOdometer: 1100 });
      expect(res.status).toBe(200);
    } finally {
      lookup.restore();
    }
    expect(lookup.inTransaction).toEqual([true]);
  });
});
