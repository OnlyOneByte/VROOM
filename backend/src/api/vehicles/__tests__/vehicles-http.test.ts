/**
 * HTTP tests for vehicle updates: an optional field can be cleared with null, omitting it keeps the
 * stored value, and license plates are unique per user. createTestApp() must run before any DB-bound
 * import, so this file imports only the harness.
 */

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
  licensePlate: string | null;
  nickname: string | null;
  vin: string | null;
  purchasePrice: number | null;
}

async function seedFullVehicle(): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/vehicles', {
    make: 'Toyota',
    model: 'Camry',
    year: 2022,
    licensePlate: 'ABC-123',
    nickname: 'Daily',
    vin: '1HGCM82633A004352',
    purchasePrice: 25000,
  });
  const body = await json<DataEnvelope<VehicleRow>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

describe('vehicle update HTTP route — clear-optional-field semantics', () => {
  test('explicit null clears a vehicle field; omitting it preserves the prior value', async () => {
    const id = await seedFullVehicle();

    const partial = await ctx.authed('PUT', `/api/v1/vehicles/${id}`, { make: 'Honda' });
    const partialBody = await json<DataEnvelope<VehicleRow>>(partial);
    expect(partial.status, JSON.stringify(partialBody)).toBe(200);
    expect(partialBody.data.make).toBe('Honda');
    expect(partialBody.data.nickname).toBe('Daily');
    expect(partialBody.data.licensePlate).toBe('ABC-123');
    expect(partialBody.data.purchasePrice).toBe(25000);

    const cleared = await ctx.authed('PUT', `/api/v1/vehicles/${id}`, {
      licensePlate: null,
      nickname: null,
      vin: null,
      purchasePrice: null,
    });
    const clearedBody = await json<DataEnvelope<VehicleRow>>(cleared);
    expect(cleared.status, JSON.stringify(clearedBody)).toBe(200);
    expect(clearedBody.data.licensePlate).toBeNull();
    expect(clearedBody.data.nickname).toBeNull();
    expect(clearedBody.data.vin).toBeNull();
    expect(clearedBody.data.purchasePrice).toBeNull();
  });
});

describe('vehicle license-plate uniqueness is per-user, not global', () => {
  function seedForeignVehicleWithPlate(plate: string): void {
    ctx.sqlite.run(
      `INSERT INTO users (id, email, display_name) VALUES ('other-user', 'other@test.com', 'Other')`
    );
    ctx.sqlite.run(
      `INSERT INTO vehicles (id, user_id, make, model, year, license_plate)
       VALUES ('foreign-veh', 'other-user', 'Honda', 'Civic', 2020, ?)`,
      [plate]
    );
  }

  test('CREATE with a plate another tenant owns succeeds', async () => {
    seedForeignVehicleWithPlate('SHARED-9');

    const res = await ctx.authed('POST', '/api/v1/vehicles', {
      make: 'Toyota',
      model: 'Corolla',
      year: 2023,
      licensePlate: 'SHARED-9',
    });
    const body = await json<DataEnvelope<VehicleRow>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);
    expect(body.data.licensePlate).toBe('SHARED-9');
  });

  test('CREATE with a plate the same user already owns returns 409', async () => {
    await seedFullVehicle(); // owns 'ABC-123'

    const res = await ctx.authed('POST', '/api/v1/vehicles', {
      make: 'Mazda',
      model: 'CX-5',
      year: 2024,
      licensePlate: 'ABC-123',
    });
    expect(res.status).toBe(409);
  });

  test('UPDATE to a plate another tenant owns succeeds', async () => {
    seedForeignVehicleWithPlate('SHARED-9');
    const id = await seedFullVehicle(); // owns 'ABC-123'

    const res = await ctx.authed('PUT', `/api/v1/vehicles/${id}`, { licensePlate: 'SHARED-9' });
    const body = await json<DataEnvelope<VehicleRow>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.licensePlate).toBe('SHARED-9');
  });

  test('UPDATE re-saving a vehicle without changing its plate does not 409 against itself', async () => {
    const id = await seedFullVehicle();

    const res = await ctx.authed('PUT', `/api/v1/vehicles/${id}`, {
      licensePlate: 'ABC-123',
      nickname: 'Renamed',
    });
    const body = await json<DataEnvelope<VehicleRow>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.licensePlate).toBe('ABC-123');
  });

  test('UPDATE to a plate the same user owns on another vehicle returns 409', async () => {
    await seedFullVehicle();
    const idB = await ctx
      .authed('POST', '/api/v1/vehicles', {
        make: 'Kia',
        model: 'Niro',
        year: 2023,
        licensePlate: 'XYZ-789',
      })
      .then((r) => json<DataEnvelope<VehicleRow>>(r))
      .then((b) => b.data.id);

    const res = await ctx.authed('PUT', `/api/v1/vehicles/${idB}`, { licensePlate: 'ABC-123' });
    expect(res.status).toBe(409);
  });
});
