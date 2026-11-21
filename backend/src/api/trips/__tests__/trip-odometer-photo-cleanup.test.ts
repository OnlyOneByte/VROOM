import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

async function tripWithOdometerPhoto(): Promise<{ tripId: string; entryId: string }> {
  const vehRes = await ctx.authed('POST', '/api/v1/vehicles', {
    make: 'Honda',
    model: 'Fit',
    year: 2014,
  });
  const vehicle = await json<DataEnvelope<{ id: string }>>(vehRes);
  expect(vehRes.status, JSON.stringify(vehicle)).toBe(201);
  const tripRes = await ctx.authed('POST', '/api/v1/trips', {
    vehicleId: vehicle.data.id,
    startOdometer: 500,
    endOdometer: 620,
    purpose: 'business',
    tripDate: '2026-05-01T00:00:00.000Z',
  });
  const trip = await json<DataEnvelope<{ id: string }>>(tripRes);
  expect(tripRes.status, JSON.stringify(trip)).toBe(201);
  const entry = ctx.sqlite.query('SELECT id FROM odometer_entries').get() as { id: string };
  ctx.sqlite.run(
    `INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size)
     VALUES ('photo-dash', ?, 'odometer_entry', ?, 'dash.jpg', 'image/jpeg', 1)`,
    [ctx.user.id, entry.id]
  );
  return { tripId: trip.data.id, entryId: entry.id };
}

function photoCount(): number {
  return (ctx.sqlite.query('SELECT COUNT(*) AS n FROM photos').get() as { n: number }).n;
}

describe("a trip's linked odometer entry takes its photos with it", () => {
  test('deleting the trip with keepOdometer=false deletes the entry photo', async () => {
    const { tripId } = await tripWithOdometerPhoto();
    const res = await ctx.authed('DELETE', `/api/v1/trips/${tripId}?keepOdometer=false`);
    expect(res.status).toBeLessThan(300);
    expect(ctx.sqlite.query('SELECT COUNT(*) AS n FROM odometer_entries').get()).toEqual({ n: 0 });
    expect(photoCount()).toBe(0);
  });

  test('editing the trip end odometer deletes the replaced entry photo', async () => {
    const { tripId, entryId } = await tripWithOdometerPhoto();
    const res = await ctx.authed('PUT', `/api/v1/trips/${tripId}`, { endOdometer: 650 });
    expect(res.status).toBeLessThan(300);
    const ids = (ctx.sqlite.query('SELECT id FROM odometer_entries').all() as { id: string }[]).map(
      (r) => r.id
    );
    expect(ids).not.toContain(entryId);
    expect(photoCount()).toBe(0);
  });

  test('keeping the odometer entry keeps its photo', async () => {
    const { tripId } = await tripWithOdometerPhoto();
    const res = await ctx.authed('DELETE', `/api/v1/trips/${tripId}`);
    expect(res.status).toBeLessThan(300);
    expect(photoCount()).toBe(1);
  });
});
