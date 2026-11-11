import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

interface OdometerEntry {
  id: string;
  odometer: number;
  note: string | null;
}

async function createEntry(vehicleId: string, odometer: number, note?: string): Promise<string> {
  const res = await ctx.authed('POST', `/api/v1/odometer/${vehicleId}`, {
    odometer,
    recordedAt: '2024-06-01T00:00:00.000Z',
    note,
  });
  const body = await json<DataEnvelope<OdometerEntry>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data.id;
}

function rowOdometer(id: string): { odometer: number; note: string | null } {
  return ctx.sqlite.query('SELECT odometer, note FROM odometer_entries WHERE id = ?').get(id) as {
    odometer: number;
    note: string | null;
  };
}

describe('odometer PUT /:id (update contract)', () => {
  test('a valid update persists the new reading', async () => {
    const vehicleId = await seedVehicle(ctx);
    const id = await createEntry(vehicleId, 30_000, 'before service');

    const res = await ctx.authed('PUT', `/api/v1/odometer/${id}`, { odometer: 31_500 });
    expect(res.status, await res.text()).toBe(200);
    expect(rowOdometer(id).odometer).toBe(31_500);
  });

  test('a future recordedAt is rejected on edit (partial schema keeps the refine)', async () => {
    const vehicleId = await seedVehicle(ctx);
    const id = await createEntry(vehicleId, 30_000);

    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const res = await ctx.authed('PUT', `/api/v1/odometer/${id}`, { recordedAt: future });
    expect(res.status).toBe(400);
    expect(rowOdometer(id).odometer).toBe(30_000);
  });

  test('a negative odometer is rejected on edit', async () => {
    const vehicleId = await seedVehicle(ctx);
    const id = await createEntry(vehicleId, 30_000);

    const res = await ctx.authed('PUT', `/api/v1/odometer/${id}`, { odometer: -5 });
    expect(res.status).toBe(400);
    expect(rowOdometer(id).odometer).toBe(30_000);
  });

  test('a non-integer odometer is rejected on edit', async () => {
    const vehicleId = await seedVehicle(ctx);
    const id = await createEntry(vehicleId, 30_000);

    const res = await ctx.authed('PUT', `/api/v1/odometer/${id}`, { odometer: 30_000.5 });
    expect(res.status).toBe(400);
    expect(rowOdometer(id).odometer).toBe(30_000);
  });

  test('updating only the note leaves the odometer reading intact', async () => {
    const vehicleId = await seedVehicle(ctx);
    const id = await createEntry(vehicleId, 42_000, 'original');

    const res = await ctx.authed('PUT', `/api/v1/odometer/${id}`, { note: 'corrected note' });
    expect(res.status, await res.text()).toBe(200);
    const row = rowOdometer(id);
    expect(row.odometer, 'odometer untouched by a note-only edit').toBe(42_000);
    expect(row.note).toBe('corrected note');
  });

  test('GET /entry/:id returns 404 for a non-existent id', async () => {
    const res = await ctx.authed('GET', '/api/v1/odometer/entry/does-not-exist');
    expect(res.status).toBe(404);
  });

  test('PUT /:id returns 404 for a non-existent id', async () => {
    const res = await ctx.authed('PUT', '/api/v1/odometer/does-not-exist', { odometer: 1000 });
    expect(res.status).toBe(404);
  });

  test('DELETE /:id returns 404 for a non-existent id', async () => {
    const res = await ctx.authed('DELETE', '/api/v1/odometer/does-not-exist');
    expect(res.status).toBe(404);
  });
});
