/**
 * expense-location T3 — the CSV export/import round-trip for the `location` column. Proves the field is
 * NOT silently dropped on the one-way export NOR on the native re-import:
 *  - export: a created expense's location appears in the CSV (header + the data row);
 *  - import: a native VROOM CSV carrying a `location` column persists it on the imported expense.
 * The backup/restore + Sheets-sync paths are schema-derived (covered by T1 + the column-drift guards);
 * this pins the explicit EXPORT_COLUMNS + the native importer (ImportableExpense/parseRow), which list
 * columns by hand and so would otherwise drop a new field.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

/** The importer matches a row's vehicle by the "year make model" string (import-csv.ts:383). */
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

describe('expense location — CSV export/import round-trip (expense-location T3)', () => {
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
    // The importer matches a row's vehicle by NAME within the user's own garage.
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    expect(vehicleId).toBeTruthy();
    const vehicleName = vehicleNameOf('Toyota', 'Camry', 2022);

    // A native VROOM CSV (the export shape) with a location column.
    const csv = [
      'date,vehicle,category,amount,currency,mileage,volume,fuelType,description,location,tags,missedFillup,createdAt',
      `2024-06-02T00:00:00.000Z,${vehicleName},misc,15.00,USD,,,,A note,Downtown garage,,false,`,
    ].join('\n');

    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv, dryRun: false });
    expect(res.status, await res.clone().text()).toBe(200);

    // The imported row carries the location (find it by its deterministic csv: clientId — simplest is to
    // read the single imported expense back).
    const rows = ctx.sqlite
      .query("SELECT location FROM expenses WHERE location = 'Downtown garage'")
      .all() as ExpenseDb[];
    expect(rows.length).toBe(1);
    expect(rows[0]?.location).toBe('Downtown garage');
  });

  test('import round-trips a re-import as a no-op (idempotency unaffected by the new column)', async () => {
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

    // Re-import the SAME CSV → the deterministic csv: clientId dedups; no new row.
    const second = await ctx.authed('POST', '/api/v1/expenses/import', { csv, dryRun: false });
    expect(second.status).toBe(200);
    const countAfterSecond = (
      ctx.sqlite.query('SELECT COUNT(*) as n FROM expenses').get() as { n: number }
    ).n;
    expect(countAfterSecond).toBe(countAfterFirst);
    // And the single imported row kept its location through the dedup.
    const rows = ctx.sqlite
      .query("SELECT location FROM expenses WHERE location = 'Trailhead lot'")
      .all() as ExpenseDb[];
    expect(rows.length).toBe(1);
  });
});
