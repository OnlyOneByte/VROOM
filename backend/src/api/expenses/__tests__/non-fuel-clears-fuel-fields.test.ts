/**
 * Backend #76 (C244): a NON-fuel expense write must not persist fuel-only fields. The FE C226 fix
 * clears volume/charge/fuelType/mileage on a category switch client-side, but the backend wrote
 * updateData/expenseData verbatim — so a direct API caller (or a future client) could store a
 * maintenance/misc row carrying volume/fuelType/missedFillup and, crucially, a stray `mileage` that
 * getCurrentOdometer reads CROSS-CATEGORY (no category filter in its UNION) → poisons the
 * reminder/lease odometer axis. clearFuelFieldsIfNotFuel nulls the four fuel columns on a non-fuel
 * write. These drive the REAL POST/PUT stack + read the row back via ctx.sqlite.
 *
 * createTestApp() rewrites env + dynamic-imports DB-bound modules — imports limited to harness + bun:test.
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

async function seedVehicle(): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/vehicles', {
    make: 'Honda',
    model: 'Civic',
    year: 2021,
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

interface FuelCols {
  category: string;
  volume: number | null;
  fuel_type: string | null;
  mileage: number | null;
  missed_fillup: number;
}

function expenseRow(id: string): FuelCols {
  return ctx.sqlite
    .query('SELECT category, volume, fuel_type, mileage, missed_fillup FROM expenses WHERE id = ?')
    .get(id) as FuelCols;
}

describe('non-fuel expense writes null the fuel-only fields (#76 backend)', () => {
  test('POST a misc expense carrying stray volume/fuelType/mileage → stored with them nulled', async () => {
    const vehicleId = await seedVehicle();
    const res = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 40,
      date: '2024-06-01',
      // Stray fuel fields a non-fuel expense should never carry (a direct API caller / stale client).
      volume: 12,
      fuelType: 'Regular',
      mileage: 99_999, // the dangerous one — would poison getCurrentOdometer cross-category
      missedFillup: true,
    });
    const body = await json<DataEnvelope<{ id: string }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);

    const row = expenseRow(body.data.id);
    expect(row.category).toBe('misc');
    expect(row.volume).toBeNull();
    expect(row.fuel_type).toBeNull();
    expect(row.mileage).toBeNull(); // not stored → can't poison the odometer axis
    expect(row.missed_fillup).toBe(0);
  });

  test('PUT switching a fuel expense to maintenance nulls its fuel fields', async () => {
    const vehicleId = await seedVehicle();
    // A valid fuel expense first (volume + mileage required by the create refinement).
    const created = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'fuel',
      expenseAmount: 50,
      date: '2024-06-01',
      volume: 10,
      fuelType: 'Regular',
      mileage: 30_000,
    });
    const cbody = await json<DataEnvelope<{ id: string }>>(created);
    expect(created.status, JSON.stringify(cbody)).toBe(201);
    const id = cbody.data.id;
    expect(expenseRow(id).volume).toBe(10); // sanity: fuel fields present pre-switch

    // Switch to maintenance, sending ONLY the category (the omit-the-fuel-fields case).
    const put = await ctx.authed('PUT', `/api/v1/expenses/${id}`, { category: 'maintenance' });
    expect(put.status).toBe(200);

    const row = expenseRow(id);
    expect(row.category).toBe('maintenance');
    expect(row.volume).toBeNull();
    expect(row.fuel_type).toBeNull();
    expect(row.mileage).toBeNull();
    expect(row.missed_fillup).toBe(0);
  });

  test('a genuine fuel expense keeps its fuel fields (no over-clear)', async () => {
    const vehicleId = await seedVehicle();
    const res = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'fuel',
      expenseAmount: 50,
      date: '2024-06-01',
      volume: 11,
      fuelType: 'Diesel',
      mileage: 31_000,
    });
    const body = await json<DataEnvelope<{ id: string }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);

    const row = expenseRow(body.data.id);
    expect(row.volume).toBe(11);
    expect(row.fuel_type).toBe('Diesel');
    expect(row.mileage).toBe(31_000);
  });
});
