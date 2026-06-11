/**
 * In-process HTTP tests for the import-trackers ROUTE extension (spec T3): POST /import with an
 * optional `mapping` + POST /import/detect. Proves the foreign-tracker path is BACKWARD-COMPATIBLE
 * (no mapping → today's native path unchanged), that a mapped file is translated then run through
 * the EXISTING buildImportPlan/dryRun/importExpenses flow (so idempotency/atomicity/tenant-safety
 * are inherited), unit conversion targets the resolved vehicle's units (C60 wiring risk), unmapped
 * categories surface, malformed rows still report per-row, and detect identifies a preset.
 *
 * createTestApp() rewrites env + dynamic-imports DB-bound modules — import only the harness here.
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

/** Seed a vehicle (default unit prefs = miles / US gallons). Returns its id. */
async function seedVehicle(nickname: string): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/vehicles', {
    make: 'Honda',
    model: 'Civic',
    year: 2021,
    nickname,
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

async function listExpenses(): Promise<
  Array<{ category: string; expenseAmount: number; mileage: number | null; volume: number | null }>
> {
  const res = await ctx.authed('GET', '/api/v1/expenses?limit=100');
  const body = await json<{
    data: Array<{
      category: string;
      expenseAmount: number;
      mileage: number | null;
      volume: number | null;
    }>;
  }>(res);
  return body.data;
}

interface ImportResponse {
  data: {
    dryRun: boolean;
    imported: number;
    duplicates?: number;
    readyCount: number;
    errorCount: number;
    unmappedCategories?: string[];
    rows: Array<{ row: number; status: string; message?: string }>;
  };
}

// A Fuelio-shaped metric file: dmy dates, km odometer, litres, comma decimals, no vehicle column.
const FUELIO_CSV = [
  'Data,Odo (km),Fuel (litres),Price,Type',
  '15/03/2024,160.9344,37.854,"52,40",Gas',
].join('\n');

const FUELIO_MAPPING = {
  source: 'fuelio',
  columns: {
    date: 'Data',
    mileage: 'Odo (km)',
    volume: 'Fuel (litres)',
    amount: 'Price',
    category: 'Type',
  },
  targetVehicle: 'Daily Driver',
  dateFormat: 'dmy' as const,
  distanceUnit: 'kilometers' as const,
  volumeUnit: 'liters' as const,
  categoryMap: { gas: 'fuel' as const },
};

describe('POST /import — backward compatibility (no mapping)', () => {
  test('a native VROOM CSV still imports unchanged when no mapping is sent', async () => {
    await seedVehicle('Daily Driver');
    const csv = [
      'date,vehicle,category,amount',
      '2024-06-01T00:00:00.000Z,Daily Driver,misc,12.50',
    ].join('\n');
    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv });
    const body = await json<ImportResponse>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.imported).toBe(1);
    expect(body.data.unmappedCategories).toEqual([]); // present + empty on the native path
  });
});

describe('POST /import — foreign-tracker mapping path (T3)', () => {
  test('a Fuelio metric file maps + converts into a miles/US-gal vehicle and commits', async () => {
    await seedVehicle('Daily Driver');
    const res = await ctx.authed('POST', '/api/v1/expenses/import', {
      csv: FUELIO_CSV,
      mapping: FUELIO_MAPPING,
    });
    const body = await json<ImportResponse>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.imported).toBe(1);
    expect(body.data.errorCount).toBe(0);

    const [row] = await listExpenses();
    expect(row.category).toBe('fuel'); // 'Gas' → fuel via categoryMap
    expect(row.expenseAmount).toBeCloseTo(52.4, 2); // comma decimal normalized
    expect(row.mileage).toBe(100); // 160.9344 km → 100 mi (converted into the vehicle's unit)
    expect(row.volume).toBeCloseTo(10, 2); // 37.854 L → ~10 US gal
  });

  test('dry-run previews the mapped plan without writing', async () => {
    await seedVehicle('Daily Driver');
    const res = await ctx.authed('POST', '/api/v1/expenses/import', {
      csv: FUELIO_CSV,
      mapping: FUELIO_MAPPING,
      dryRun: true,
    });
    const body = await json<ImportResponse>(res);
    expect(body.data.dryRun).toBe(true);
    expect(body.data.readyCount).toBe(1);
    expect(body.data.imported).toBe(0);
    expect((await listExpenses()).length).toBe(0); // nothing written
  });

  test('re-importing the same mapped file is idempotent (inherits the native dedup)', async () => {
    await seedVehicle('Daily Driver');
    const first = await json<ImportResponse>(
      await ctx.authed('POST', '/api/v1/expenses/import', {
        csv: FUELIO_CSV,
        mapping: FUELIO_MAPPING,
      })
    );
    expect(first.data.imported).toBe(1);
    const second = await json<ImportResponse>(
      await ctx.authed('POST', '/api/v1/expenses/import', {
        csv: FUELIO_CSV,
        mapping: FUELIO_MAPPING,
      })
    );
    expect(second.data.imported).toBe(0);
    expect(second.data.duplicates).toBe(1);
    expect((await listExpenses()).length).toBe(1); // still 1, not 2
  });

  test('an unmapped category word surfaces in unmappedCategories (D2 visible note)', async () => {
    await seedVehicle('Daily Driver');
    const csv = ['Data,Price,Type', '15/03/2024,"10,00",Parking'].join('\n');
    const res = await ctx.authed('POST', '/api/v1/expenses/import', {
      csv,
      mapping: {
        columns: { date: 'Data', amount: 'Price', category: 'Type' },
        targetVehicle: 'Daily Driver',
        dateFormat: 'dmy',
      },
    });
    const body = await json<ImportResponse>(res);
    expect(body.data.unmappedCategories).toEqual(['Parking']); // mapped to misc + reported
  });

  test('a malformed mapped row is reported per-row, not a whole-file 500', async () => {
    await seedVehicle('Daily Driver');
    // Fuel row with a non-numeric amount → buildImportPlan flags it as a row error.
    const csv = ['Data,Price,Type', '15/03/2024,not-a-number,Gas'].join('\n');
    const res = await ctx.authed('POST', '/api/v1/expenses/import', {
      csv,
      mapping: {
        columns: { date: 'Data', amount: 'Price', category: 'Type' },
        targetVehicle: 'Daily Driver',
        dateFormat: 'dmy',
        categoryMap: { gas: 'fuel' },
      },
    });
    const body = await json<ImportResponse>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.errorCount).toBe(1);
    expect(body.data.rows[0].status).toBe('error');
  });

  test('an unparseable foreign file → 400 (not 500)', async () => {
    await seedVehicle('Daily Driver');
    const res = await ctx.authed('POST', '/api/v1/expenses/import', {
      csv: 'a,b\n"unterminated,1',
      mapping: { columns: { date: 'a' }, dateFormat: 'iso' },
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /import/detect', () => {
  test('identifies a Fuelio file from its headers', async () => {
    const res = await ctx.authed('POST', '/api/v1/expenses/import/detect', {
      headers: ['Data', 'Odo (km)', 'Fuel (litres)', 'Price'],
    });
    const body = await json<DataEnvelope<{ id: string } | null>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data?.id).toBe('fuelio');
  });

  test('returns null for an unknown file (→ manual mapping)', async () => {
    const res = await ctx.authed('POST', '/api/v1/expenses/import/detect', {
      headers: ['Date', 'Amount', 'Category'],
    });
    const body = await json<DataEnvelope<unknown>>(res);
    expect(body.data).toBeNull();
  });
});
