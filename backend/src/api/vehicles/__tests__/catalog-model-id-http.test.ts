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

interface VehicleRow {
  id: string;
  make: string;
  model: string;
  catalogModelId: string | null;
}

async function createVehicle(extra: Record<string, unknown> = {}): Promise<Response> {
  return ctx.authed('POST', '/api/v1/vehicles', {
    make: 'Honda',
    model: 'Civic EX',
    year: 2019,
    ...extra,
  });
}

async function createdId(extra: Record<string, unknown> = {}): Promise<string> {
  const res = await createVehicle(extra);
  const body = await json<DataEnvelope<VehicleRow>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data.id;
}

async function fetchVehicle(id: string): Promise<VehicleRow> {
  return (await json<DataEnvelope<VehicleRow>>(await ctx.authed('GET', `/api/v1/vehicles/${id}`)))
    .data;
}

describe('vehicle catalogModelId', () => {
  test('a vehicle created without it has a null catalogModelId', async () => {
    const id = await createdId();
    expect((await fetchVehicle(id)).catalogModelId).toBeNull();
  });

  test('create accepts a catalogue model and the response includes it', async () => {
    const res = await createVehicle({ catalogModelId: 'honda-civic' });
    const body = await json<DataEnvelope<VehicleRow>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);
    expect(body.data.catalogModelId).toBe('honda-civic');
    expect((await fetchVehicle(body.data.id)).catalogModelId).toBe('honda-civic');
  });

  test.each(['nope', 'honda', '', 'honda-civic '])(
    'create rejects the unknown catalogModelId %p with 400',
    async (catalogModelId) => {
      expect((await createVehicle({ catalogModelId })).status).toBe(400);
    }
  );

  test('a catalogue model of another make is rejected on create and update', async () => {
    expect((await createVehicle({ catalogModelId: 'toyota-camry' })).status).toBe(400);
    const id = await createdId({ catalogModelId: 'honda-civic' });
    const res = await ctx.authed('PUT', `/api/v1/vehicles/${id}`, {
      make: 'Toyota',
      catalogModelId: 'honda-civic',
    });
    expect(res.status).toBe(400);
    const switched = await ctx.authed('PUT', `/api/v1/vehicles/${id}`, {
      make: 'Toyota',
      model: 'Camry',
      catalogModelId: 'toyota-camry',
    });
    expect(switched.status, await switched.clone().text()).toBe(200);
    expect((await fetchVehicle(id)).catalogModelId).toBe('toyota-camry');
  });

  test('update sets, keeps and clears it', async () => {
    const id = await createdId();
    const set = await ctx.authed('PUT', `/api/v1/vehicles/${id}`, {
      catalogModelId: 'honda-civic',
    });
    expect(set.status, await set.clone().text()).toBe(200);
    expect((await fetchVehicle(id)).catalogModelId).toBe('honda-civic');

    await ctx.authed('PUT', `/api/v1/vehicles/${id}`, { nickname: 'Daily' });
    expect((await fetchVehicle(id)).catalogModelId).toBe('honda-civic');

    await ctx.authed('PUT', `/api/v1/vehicles/${id}`, { catalogModelId: null });
    expect((await fetchVehicle(id)).catalogModelId).toBeNull();
  });

  test('update rejects an unknown catalogModelId and keeps the stored one', async () => {
    const id = await createdId({ catalogModelId: 'honda-civic' });
    const res = await ctx.authed('PUT', `/api/v1/vehicles/${id}`, { catalogModelId: 'x-y' });
    expect(res.status).toBe(400);
    expect((await fetchVehicle(id)).catalogModelId).toBe('honda-civic');
  });

  test('renaming the make or model without a new catalogModelId clears the stale one', async () => {
    const id = await createdId({ catalogModelId: 'honda-civic' });
    await ctx.authed('PUT', `/api/v1/vehicles/${id}`, { model: 'Accord' });
    expect((await fetchVehicle(id)).catalogModelId).toBeNull();

    await ctx.authed('PUT', `/api/v1/vehicles/${id}`, {
      model: 'Civic',
      catalogModelId: 'honda-civic',
    });
    await ctx.authed('PUT', `/api/v1/vehicles/${id}`, { make: 'Honda', model: 'Civic' });
    expect((await fetchVehicle(id)).catalogModelId).toBe('honda-civic');
  });
});
