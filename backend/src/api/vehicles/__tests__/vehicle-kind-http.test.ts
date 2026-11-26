import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { VEHICLE_KINDS } from '../../../db/types';
import {
  createTestApp,
  type DataEnvelope,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

interface VehicleRow {
  id: string;
  vehicleKind: string;
  vehicleType: string;
}

function createVehicle(extra: Record<string, unknown> = {}): Promise<Response> {
  return ctx.authed('POST', '/api/v1/vehicles', {
    make: 'Honda',
    model: 'Civic',
    year: 2019,
    ...extra,
  });
}

async function created(extra: Record<string, unknown> = {}): Promise<VehicleRow> {
  const res = await createVehicle(extra);
  const body = await json<DataEnvelope<VehicleRow>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data;
}

async function fetchVehicle(id: string): Promise<VehicleRow> {
  return (await json<DataEnvelope<VehicleRow>>(await ctx.authed('GET', `/api/v1/vehicles/${id}`)))
    .data;
}

describe('vehicle vehicleKind', () => {
  test('a vehicle created without a kind is a car', async () => {
    const vehicle = await created();
    expect(vehicle.vehicleKind).toBe('car');
    expect((await fetchVehicle(vehicle.id)).vehicleKind).toBe('car');
  });

  test.each([...VEHICLE_KINDS])('create accepts %p', async (vehicleKind) => {
    const vehicle = await created({ vehicleKind });
    expect((await fetchVehicle(vehicle.id)).vehicleKind).toBe(vehicleKind);
  });

  test.each(['motorbike', 'Car', '', 'bus', 7])(
    'create rejects the kind %p with 400',
    async (vehicleKind) => {
      const res = await createVehicle({ vehicleKind });
      expect(res.status).toBe(400);
    }
  );

  test('the kind and the powertrain are independent', async () => {
    const vehicle = await created({ vehicleKind: 'motorcycle', vehicleType: 'electric' });
    expect(vehicle.vehicleKind).toBe('motorcycle');
    expect(vehicle.vehicleType).toBe('electric');
  });

  test('update changes the kind, and an update without it keeps it', async () => {
    const vehicle = await created({ vehicleKind: 'van' });

    const res = await ctx.authed('PUT', `/api/v1/vehicles/${vehicle.id}`, { vehicleKind: 'rv' });
    expect(res.status).toBe(200);
    expect((await fetchVehicle(vehicle.id)).vehicleKind).toBe('rv');

    const rename = await ctx.authed('PUT', `/api/v1/vehicles/${vehicle.id}`, { nickname: 'Home' });
    expect(rename.status).toBe(200);
    expect((await fetchVehicle(vehicle.id)).vehicleKind).toBe('rv');
  });

  test('update rejects an unknown kind and keeps the stored one', async () => {
    const vehicle = await created({ vehicleKind: 'truck' });
    const res = await ctx.authed('PUT', `/api/v1/vehicles/${vehicle.id}`, {
      vehicleKind: 'boat',
    });
    expect(res.status).toBe(400);
    expect((await fetchVehicle(vehicle.id)).vehicleKind).toBe('truck');
  });
});
