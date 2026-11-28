import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { logger } from '../../../utils/logger';
import * as photoService from '../../photos/photo-service';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

async function tripWithOdometerPhoto(): Promise<string> {
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
  const entry = (await ctx.sql.get('SELECT id FROM odometer_entries')) as { id: string };
  await ctx.sql.run(
    `INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size)
     VALUES ('photo-dash', ?, 'odometer_entry', ?, 'dash.jpg', 'image/jpeg', 1)`,
    [ctx.user.id, entry.id]
  );
  return trip.data.id;
}

async function addManualReading(tripId: string, odometer: number): Promise<void> {
  const { vehicle_id } = (await ctx.sql.get('SELECT vehicle_id FROM trips WHERE id = ?', [
    tripId,
  ])) as { vehicle_id: string };
  const res = await ctx.authed('POST', `/api/v1/odometer/${vehicle_id}`, {
    odometer,
    recordedAt: '2026-05-01T00:01:00.000Z',
  });
  expect(res.status).toBe(201);
}

async function photoCount(): Promise<number> {
  return ((await ctx.sql.get('SELECT COUNT(*) AS n FROM photos')) as { n: number }).n;
}

function failTwiceThenRun() {
  const real = photoService.deletePhotosForEntities;
  return spyOn(photoService, 'deletePhotosForEntities')
    .mockImplementationOnce(() => Promise.reject(new Error('database is locked')))
    .mockImplementationOnce(() => Promise.reject(new Error('database is locked')))
    .mockImplementation(real);
}

describe('a trip photo cleanup that fails briefly is retried', () => {
  test('moving the trip end onto an existing reading still removes the replaced entry photo', async () => {
    const tripId = await tripWithOdometerPhoto();
    await addManualReading(tripId, 650);
    const spy = failTwiceThenRun();
    try {
      const res = await ctx.authed('PUT', `/api/v1/trips/${tripId}`, { endOdometer: 650 });
      expect(res.status).toBeLessThan(300);
      expect(spy).toHaveBeenCalledTimes(3);
    } finally {
      spy.mockRestore();
    }
    expect(await photoCount()).toBe(0);
  });

  test('deleting the trip with keepOdometer=false still removes the entry photo', async () => {
    const tripId = await tripWithOdometerPhoto();
    const spy = failTwiceThenRun();
    try {
      const res = await ctx.authed('DELETE', `/api/v1/trips/${tripId}?keepOdometer=false`);
      expect(res.status).toBeLessThan(300);
      expect(spy).toHaveBeenCalledTimes(3);
    } finally {
      spy.mockRestore();
    }
    expect(await photoCount()).toBe(0);
  });

  test('a cleanup that keeps failing gives up after three tries and logs the entry ids', async () => {
    const tripId = await tripWithOdometerPhoto();
    const entryId = ((await ctx.sql.get('SELECT id FROM odometer_entries')) as { id: string }).id;
    await addManualReading(tripId, 700);
    const spy = spyOn(photoService, 'deletePhotosForEntities').mockRejectedValue(
      new Error('storage down')
    );
    const warn = spyOn(logger, 'warn');
    try {
      const res = await ctx.authed('PUT', `/api/v1/trips/${tripId}`, { endOdometer: 700 });
      expect(res.status).toBeLessThan(300);
      expect(spy).toHaveBeenCalledTimes(3);
      const gaveUp = warn.mock.calls.find(([message]) =>
        String(message).includes('trip photo cleanup gave up')
      );
      expect(gaveUp?.[1]).toMatchObject({ tripId, odometerEntryIds: [entryId], attempts: 3 });
    } finally {
      spy.mockRestore();
      warn.mockRestore();
    }
    expect(await photoCount()).toBe(1);
  });
});
