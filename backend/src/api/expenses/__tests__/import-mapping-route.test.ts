import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, json, type TestApp } from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

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

const FLAT_TRACKER_CSV = [
  'Data,Odo (km),Fuel (litres),Price,Type',
  '15/03/2024,160.9344,37.854,"52,40",Gas',
].join('\n');

const FLAT_TRACKER_MAPPING = {
  source: 'fuelly',
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
    await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021, nickname: 'Daily Driver' });
    const csv = [
      'date,vehicle,category,amount',
      '2024-06-01T00:00:00.000Z,Daily Driver,misc,12.50',
    ].join('\n');
    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv });
    const body = await json<ImportResponse>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.imported).toBe(1);
    expect(body.data.unmappedCategories).toEqual([]);
  });
});

describe('POST /import — foreign-tracker mapping path', () => {
  test('a flat metric fuel log maps + converts into a miles/US-gal vehicle and commits', async () => {
    await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021, nickname: 'Daily Driver' });
    const res = await ctx.authed('POST', '/api/v1/expenses/import', {
      csv: FLAT_TRACKER_CSV,
      mapping: FLAT_TRACKER_MAPPING,
    });
    const body = await json<ImportResponse>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.imported).toBe(1);
    expect(body.data.errorCount).toBe(0);

    const [row] = await listExpenses();
    expect(row.category).toBe('fuel');
    expect(row.expenseAmount).toBeCloseTo(52.4, 2);
    expect(row.mileage).toBe(100);
    expect(row.volume).toBeCloseTo(10, 2);
  });

  test('a stored nickname with surrounding whitespace matches for both units and rows', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    ctx.sqlite.run('UPDATE vehicles SET nickname = ? WHERE id = ?', ['  Daily Driver ', vehicleId]);
    const res = await ctx.authed('POST', '/api/v1/expenses/import', {
      csv: FLAT_TRACKER_CSV,
      mapping: FLAT_TRACKER_MAPPING,
    });
    const body = await json<ImportResponse>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.imported, JSON.stringify(body.data.rows)).toBe(1);

    const [row] = await listExpenses();
    expect(row.mileage, 'converted into the matched vehicle units').toBe(100);
    expect(row.volume).toBeCloseTo(10, 2);
  });

  test('dry-run previews the mapped plan without writing', async () => {
    await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021, nickname: 'Daily Driver' });
    const res = await ctx.authed('POST', '/api/v1/expenses/import', {
      csv: FLAT_TRACKER_CSV,
      mapping: FLAT_TRACKER_MAPPING,
      dryRun: true,
    });
    const body = await json<ImportResponse>(res);
    expect(body.data.dryRun).toBe(true);
    expect(body.data.readyCount).toBe(1);
    expect(body.data.imported).toBe(0);
    expect((await listExpenses()).length).toBe(0);
  });

  test('re-importing the same mapped file is idempotent (inherits the native dedup)', async () => {
    await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021, nickname: 'Daily Driver' });
    const first = await json<ImportResponse>(
      await ctx.authed('POST', '/api/v1/expenses/import', {
        csv: FLAT_TRACKER_CSV,
        mapping: FLAT_TRACKER_MAPPING,
      })
    );
    expect(first.data.imported).toBe(1);
    const second = await json<ImportResponse>(
      await ctx.authed('POST', '/api/v1/expenses/import', {
        csv: FLAT_TRACKER_CSV,
        mapping: FLAT_TRACKER_MAPPING,
      })
    );
    expect(second.data.imported).toBe(0);
    expect(second.data.duplicates).toBe(1);
    expect((await listExpenses()).length).toBe(1);
  });

  test('an unmapped category word surfaces in unmappedCategories', async () => {
    await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021, nickname: 'Daily Driver' });
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
    expect(body.data.unmappedCategories).toEqual(['Parking']);
  });

  test('a malformed mapped row is reported per-row, not a whole-file 500', async () => {
    await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021, nickname: 'Daily Driver' });
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
    await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021, nickname: 'Daily Driver' });
    const res = await ctx.authed('POST', '/api/v1/expenses/import', {
      csv: 'a,b\n"unterminated,1',
      mapping: { columns: { date: 'a' }, dateFormat: 'iso' },
    });
    expect(res.status).toBe(400);
  });

  test('a mapping targeting an UNOWNED vehicle imports nothing (cross-tenant safe, no leak)', async () => {
    await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021, nickname: 'Daily Driver' });
    const res = await ctx.authed('POST', '/api/v1/expenses/import', {
      csv: ['Data,Odo (km),Fuel (litres),Price', '15/03/2024,160,37,52.40'].join('\n'),
      mapping: {
        columns: { date: 'Data', mileage: 'Odo (km)', volume: 'Fuel (litres)', amount: 'Price' },
        targetVehicle: "Somebody Else's Car",
        dateFormat: 'dmy',
        distanceUnit: 'kilometers',
        volumeUnit: 'liters',
        defaultCategory: 'fuel',
      },
      dryRun: true,
    });
    const body = await json<ImportResponse>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.readyCount).toBe(0);
    expect(body.data.errorCount).toBe(1);
    expect(body.data.rows[0].message).toMatch(/no vehicle named/i);
    expect((await listExpenses()).length).toBe(0);
  });
});

describe('POST /import — fuel-tracker defaultCategory commits through the route', () => {
  const FUELLY_NO_CATEGORY_CSV = [
    'Date,Odometer,Fill Amount,Price',
    '03/01/2026,30000,9,36.00',
  ].join('\n');
  const FUELLY_MAPPING = {
    source: 'fuelly',
    columns: { date: 'Date', mileage: 'Odometer', volume: 'Fill Amount', amount: 'Price' },
    targetVehicle: 'Daily Driver',
    dateFormat: 'mdy' as const,
    distanceUnit: 'miles' as const,
    volumeUnit: 'gallons_us' as const,
    defaultCategory: 'fuel' as const,
  };

  test('a detected fuel log with no category column commits as a fuel expense', async () => {
    await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021, nickname: 'Daily Driver' });
    const res = await ctx.authed('POST', '/api/v1/expenses/import', {
      csv: FUELLY_NO_CATEGORY_CSV,
      mapping: FUELLY_MAPPING,
    });
    const body = await json<ImportResponse>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.imported).toBe(1);
    expect(body.data.errorCount).toBe(0);
    const [row] = await listExpenses();
    expect(row.category).toBe('fuel');
    expect(row.mileage).toBe(30000);
    expect(row.volume).toBe(9);
  });

  test('dry-run preview of a defaulted fuel log reports ready rows without writing', async () => {
    await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021, nickname: 'Daily Driver' });
    const res = await ctx.authed('POST', '/api/v1/expenses/import', {
      csv: FUELLY_NO_CATEGORY_CSV,
      mapping: FUELLY_MAPPING,
      dryRun: true,
    });
    const body = await json<ImportResponse>(res);
    expect(body.data.readyCount).toBe(1);
    expect(body.data.imported).toBe(0);
    expect((await listExpenses()).length).toBe(0);
  });
});
