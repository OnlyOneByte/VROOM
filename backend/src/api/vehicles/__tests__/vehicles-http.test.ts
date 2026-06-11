/**
 * In-process HTTP tests for the vehicle update route — through the REAL stack
 * (middleware → auth → zValidator → handler → BaseRepository → DB).
 *
 * Focus: the clear-optional-field semantics on PUT /vehicles/:id (same data-loss
 * class as insurance claims/terms/policy-notes). An emptied optional field must
 * be sendable as null to clear the column; omitting it must preserve the prior
 * value. createTestApp() rewrites process.env + dynamic-imports the DB-bound
 * modules, so this file imports only the harness.
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

/** Seed a vehicle with every optional field populated. Returns its id. */
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

    // Omitting fields preserves them (only make changes here).
    const partial = await ctx.authed('PUT', `/api/v1/vehicles/${id}`, { make: 'Honda' });
    const partialBody = await json<DataEnvelope<VehicleRow>>(partial);
    expect(partial.status, JSON.stringify(partialBody)).toBe(200);
    expect(partialBody.data.make).toBe('Honda');
    expect(partialBody.data.nickname).toBe('Daily'); // preserved
    expect(partialBody.data.licensePlate).toBe('ABC-123'); // preserved
    expect(partialBody.data.purchasePrice).toBe(25000); // preserved

    // Explicit null clears the optional fields (user emptied them in the form).
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

describe('vehicle license-plate uniqueness is per-user, not global (C233 tenant-scope)', () => {
  // Raw-seed a DIFFERENT user who already owns a vehicle with plate SHARED-9. The plate-uniqueness
  // check that backs create/update must be scoped to the requesting user — a global lookup wrongly
  // 409'd this user AND leaked plate existence across tenants (the C168/#52 class). Two users may
  // legitimately share a plate string (reissued plates, sold-then-rebought cars).
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

  test('CREATE with a plate another tenant already owns succeeds (no cross-tenant 409)', async () => {
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

  test('CREATE still 409s on a plate the SAME user already owns (per-user constraint intact)', async () => {
    await seedFullVehicle(); // owns 'ABC-123'

    const res = await ctx.authed('POST', '/api/v1/vehicles', {
      make: 'Mazda',
      model: 'CX-5',
      year: 2024,
      licensePlate: 'ABC-123',
    });
    expect(res.status).toBe(409);
  });

  test('UPDATE to a plate another tenant owns succeeds (no cross-tenant 409)', async () => {
    seedForeignVehicleWithPlate('SHARED-9');
    const id = await seedFullVehicle(); // owns 'ABC-123'

    const res = await ctx.authed('PUT', `/api/v1/vehicles/${id}`, { licensePlate: 'SHARED-9' });
    const body = await json<DataEnvelope<VehicleRow>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.licensePlate).toBe('SHARED-9');
  });
});
