import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

function vehicleNameOf(make: string, model: string, year: number): string {
  return `${year} ${make} ${model}`;
}

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

interface ExpenseDb {
  location: string | null;
}

describe('expense location CSV export and import round-trip', () => {
  test('export: a created location appears in the CSV header + data row', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const create = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 12.5,
      date: '2024-06-01T00:00:00.000Z',
      location: 'Shell, Main St',
    });
    expect(create.status, await create.clone().text()).toBe(201);

    const res = await ctx.authed('GET', '/api/v1/expenses/export');
    expect(res.status).toBe(200);
    const csv = await res.text();
    const header = csv.trim().split('\n')[0] ?? '';
    expect(header).toContain('location');
    expect(csv).toContain('Shell, Main St');
  });

  test('import: a native CSV with a location column persists it', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    expect(vehicleId).toBeTruthy();
    const vehicleName = vehicleNameOf('Toyota', 'Camry', 2022);

    const csv = [
      'date,vehicle,category,amount,currency,mileage,volume,fuelType,description,location,tags,missedFillup,createdAt',
      `2024-06-02T00:00:00.000Z,${vehicleName},misc,15.00,USD,,,,A note,Downtown garage,,false,`,
    ].join('\n');

    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv, dryRun: false });
    expect(res.status, await res.clone().text()).toBe(200);

    const rows = ctx.sqlite
      .query("SELECT location FROM expenses WHERE location = 'Downtown garage'")
      .all() as ExpenseDb[];
    expect(rows.length).toBe(1);
    expect(rows[0]?.location).toBe('Downtown garage');
  });

  test('re-importing a location CSV is a no-op', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Mazda', model: 'CX5', year: 2023 });
    expect(vehicleId).toBeTruthy();
    const vehicleName = vehicleNameOf('Mazda', 'CX5', 2023);
    const csv = [
      'date,vehicle,category,amount,currency,mileage,volume,fuelType,description,location,tags,missedFillup,createdAt',
      `2024-06-03T00:00:00.000Z,${vehicleName},misc,9.00,USD,,,,,Trailhead lot,,false,`,
    ].join('\n');

    const first = await ctx.authed('POST', '/api/v1/expenses/import', { csv, dryRun: false });
    expect(first.status).toBe(200);
    const countAfterFirst = (
      ctx.sqlite.query('SELECT COUNT(*) as n FROM expenses').get() as { n: number }
    ).n;

    const second = await ctx.authed('POST', '/api/v1/expenses/import', { csv, dryRun: false });
    expect(second.status).toBe(200);
    const countAfterSecond = (
      ctx.sqlite.query('SELECT COUNT(*) as n FROM expenses').get() as { n: number }
    ).n;
    expect(countAfterSecond).toBe(countAfterFirst);
    const rows = ctx.sqlite
      .query("SELECT location FROM expenses WHERE location = 'Trailhead lot'")
      .all() as ExpenseDb[];
    expect(rows.length).toBe(1);
  });
});
