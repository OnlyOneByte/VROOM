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

describe('non-fuel expense writes null the fuel-only fields', () => {
  test('POST a misc expense carrying stray volume/fuelType/mileage → stored with them nulled', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const res = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 40,
      date: '2024-06-01',
      volume: 12,
      fuelType: 'Regular',
      mileage: 99_999,
      missedFillup: true,
    });
    const body = await json<DataEnvelope<{ id: string }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);

    const row = expenseRow(body.data.id);
    expect(row.category).toBe('misc');
    expect(row.volume).toBeNull();
    expect(row.fuel_type).toBeNull();
    expect(row.mileage).toBeNull();
    expect(row.missed_fillup).toBe(0);
  });

  test('PUT switching a fuel expense to maintenance nulls its fuel fields', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
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
    expect(expenseRow(id).volume).toBe(10);

    const put = await ctx.authed('PUT', `/api/v1/expenses/${id}`, { category: 'maintenance' });
    expect(put.status).toBe(200);

    const row = expenseRow(id);
    expect(row.category).toBe('maintenance');
    expect(row.volume).toBeNull();
    expect(row.fuel_type).toBeNull();
    expect(row.mileage).toBeNull();
    expect(row.missed_fillup).toBe(0);
  });

  test('PUT writing a stray mileage onto an ALREADY-non-fuel row (no category sent) nulls it', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const created = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'maintenance',
      expenseAmount: 80,
      date: '2024-06-01',
    });
    const cbody = await json<DataEnvelope<{ id: string }>>(created);
    expect(created.status, JSON.stringify(cbody)).toBe(201);
    const id = cbody.data.id;
    expect(expenseRow(id).mileage).toBeNull();

    const put = await ctx.authed('PUT', `/api/v1/expenses/${id}`, {
      expenseAmount: 85,
      mileage: 99_999,
      volume: 7,
      fuelType: 'Regular',
    });
    expect(put.status).toBe(200);

    const row = expenseRow(id);
    expect(row.category).toBe('maintenance');
    expect(
      row.mileage,
      'a stray mileage on a non-fuel row must not persist (would poison getCurrentOdometer)'
    ).toBeNull();
    expect(row.volume).toBeNull();
    expect(row.fuel_type).toBeNull();
  });

  test('a genuine fuel expense keeps its fuel fields (no over-clear)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
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
