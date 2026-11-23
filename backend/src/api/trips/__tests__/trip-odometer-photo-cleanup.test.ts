import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
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

async function addManualReading(tripId: string, odometer: number): Promise<void> {
  const { vehicle_id } = ctx.sqlite
    .query('SELECT vehicle_id FROM trips WHERE id = ?')
    .get(tripId) as { vehicle_id: string };
  const res = await ctx.authed('POST', `/api/v1/odometer/${vehicle_id}`, {
    odometer,
    recordedAt: '2026-05-01T12:00:00.000Z',
  });
  expect(res.status).toBe(201);
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

  test.each([
    ['end odometer', { endOdometer: 650 }, 650, '2026-05-01T00:00:00.000Z'],
    ['date', { tripDate: '2026-05-03T00:00:00.000Z' }, 620, '2026-05-03T00:00:00.000Z'],
  ])(
    'editing the trip %s keeps the entry, its note and its photo',
    async (_, body, odometer, recordedAt) => {
      const { tripId, entryId } = await tripWithOdometerPhoto();
      const noteRes = await ctx.authed('PUT', `/api/v1/odometer/${entryId}`, {
        note: 'Dash photo',
      });
      expect(noteRes.status).toBe(200);

      const res = await ctx.authed('PUT', `/api/v1/trips/${tripId}`, body);

      expect(res.status).toBeLessThan(300);
      const entries = ctx.sqlite
        .query('SELECT id, odometer, recorded_at, note, source_trip_id FROM odometer_entries')
        .all() as {
        id: string;
        odometer: number;
        recorded_at: number;
        note: string;
        source_trip_id: string;
      }[];
      expect(entries).toEqual([
        {
          id: entryId,
          odometer,
          recorded_at: new Date(recordedAt).getTime() / 1000,
          note: 'Dash photo',
          source_trip_id: tripId,
        },
      ]);
      expect(photoCount()).toBe(1);
    }
  );

  test('moving the trip end onto an existing reading deletes the replaced entry photo', async () => {
    const { tripId, entryId } = await tripWithOdometerPhoto();
    await addManualReading(tripId, 650);

    const res = await ctx.authed('PUT', `/api/v1/trips/${tripId}`, { endOdometer: 650 });

    expect(res.status).toBeLessThan(300);
    const entries = ctx.sqlite.query('SELECT id, odometer FROM odometer_entries').all() as {
      id: string;
      odometer: number;
    }[];
    expect(entries.map((e) => e.odometer)).toEqual([650]);
    expect(entries.map((e) => e.id)).not.toContain(entryId);
    expect(photoCount()).toBe(0);
  });

  test('keeping the odometer entry keeps its photo', async () => {
    const { tripId } = await tripWithOdometerPhoto();
    const res = await ctx.authed('DELETE', `/api/v1/trips/${tripId}`);
    expect(res.status).toBeLessThan(300);
    expect(photoCount()).toBe(1);
  });
});

describe('a failed photo cleanup does not block the trip edit', () => {
  test('the trip still moves onto an existing reading when deleting the old photos throws', async () => {
    const { tripId, entryId } = await tripWithOdometerPhoto();
    await addManualReading(tripId, 700);
    const photoService = await import('../../photos/photo-service');
    const spy = spyOn(photoService, 'deletePhotosForEntities').mockRejectedValue(
      new Error('storage down')
    );
    try {
      const res = await ctx.authed('PUT', `/api/v1/trips/${tripId}`, { endOdometer: 700 });
      expect(res.status).toBeLessThan(300);
    } finally {
      spy.mockRestore();
    }
    const entries = ctx.sqlite.query('SELECT id, odometer FROM odometer_entries').all() as {
      id: string;
      odometer: number;
    }[];
    expect(entries.map((e) => e.odometer)).toEqual([700]);
    expect(entries.map((e) => e.id)).not.toContain(entryId);
  });
});
