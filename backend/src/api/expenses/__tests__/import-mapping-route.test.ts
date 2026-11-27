import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';
import { IMPORT_FORMATS } from '../import-mapping-presets';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
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
  '15/03/2024,"160,9344","37,8541","52,40",Gas',
].join('\n');

const FLAT_TRACKER_MAPPING = {
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
    await ctx.sql.run('UPDATE vehicles SET nickname = ? WHERE id = ?', [
      '  Daily Driver ',
      vehicleId,
    ]);
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
    columns: {},
    targetVehicle: 'Daily Driver',
    dateFormat: 'iso' as const,
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

describe('POST /import — mapped files with a vehicle column and locale numbers', () => {
  test('a km/liter file with a vehicle column is converted into that vehicle units', async () => {
    await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021, nickname: 'Daily Driver' });
    const csv = [
      'Date,Car,Odo,Litres,Price',
      '2024-03-15,Daily Driver,"160,9344","37,8541","1.250,00"',
    ].join('\n');
    const res = await ctx.authed('POST', '/api/v1/expenses/import', {
      csv,
      mapping: {
        columns: {
          date: 'Date',
          vehicle: 'Car',
          mileage: 'Odo',
          volume: 'Litres',
          amount: 'Price',
        },
        dateFormat: 'iso',
        distanceUnit: 'kilometers',
        volumeUnit: 'liters',
        defaultCategory: 'fuel',
      },
    });
    const body = await json<ImportResponse>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.imported, JSON.stringify(body.data.rows)).toBe(1);

    const [row] = await listExpenses();
    expect(row.expenseAmount).toBeCloseTo(1250, 2);
    expect(row.mileage).toBe(100);
    expect(row.volume).toBeCloseTo(10, 2);
  });

  test('the preview flags an ambiguous "1,250" and nothing is written', async () => {
    await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021, nickname: 'Daily Driver' });
    const csv = ['Date,Price,Odo', '2024-03-15,"1,250","45,120"'].join('\n');
    const mapping = {
      columns: { date: 'Date', amount: 'Price', mileage: 'Odo' },
      targetVehicle: 'Daily Driver',
      dateFormat: 'iso',
      distanceUnit: 'miles',
    };
    const preview = await json<ImportResponse>(
      await ctx.authed('POST', '/api/v1/expenses/import', { csv, mapping, dryRun: true })
    );
    expect(preview.data.readyCount).toBe(0);
    expect(preview.data.rows[0].message).toContain('could mean 1250 or 1.25');

    const commit = await json<ImportResponse>(
      await ctx.authed('POST', '/api/v1/expenses/import', { csv, mapping })
    );
    expect(commit.data.imported).toBe(0);
    expect((await listExpenses()).length).toBe(0);
  });
});

describe('POST /import — a mapped mileage of 0', () => {
  test('a 0 or rounds-to-0 reading is blank on a cost row and refused on a fuel row', async () => {
    await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021, nickname: 'Daily Driver' });
    const csv = [
      'Data,Odo (km),Fuel (litres),Price,Type',
      '15/03/2024,0,,20,Service',
      '16/03/2024,"0,4",,30,Service',
      '17/03/2024,"0,4","37,8541","52,40",Gas',
    ].join('\n');
    const res = await ctx.authed('POST', '/api/v1/expenses/import', {
      csv,
      mapping: { ...FLAT_TRACKER_MAPPING, categoryMap: { gas: 'fuel', service: 'maintenance' } },
    });
    const body = await json<ImportResponse>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.rows.map((r) => [r.status, r.message])).toEqual([
      ['ready', undefined],
      ['ready', undefined],
      ['error', 'Mileage must be greater than 0'],
    ]);

    const rows = await listExpenses();
    expect(rows.map((r) => [r.category, r.mileage])).toEqual([
      ['maintenance', null],
      ['maintenance', null],
    ]);
  });
});

describe('POST /import/detect and a detected format through /import', () => {
  const FUELIO_EXPORT = [
    '"## Vehicle"',
    '"Name","ImportCSVDateFormat"',
    '"Golf","yyyy-MM-dd"',
    '',
    '"## Log"',
    '"Data","Odo (km)","Fuel (litres)","Price (optional)"',
    '"2024-01-05","45210","42.10","68.90"',
  ].join('\n');

  test('detect reads the file sample and returns only the format id and label', async () => {
    const detect = (sample: string) =>
      ctx.authed('POST', '/api/v1/expenses/import/detect', { sample });

    const fuelio = await json<{ data: unknown }>(await detect(FUELIO_EXPORT));
    expect(fuelio.data).toEqual({ id: 'fuelio', label: 'Fuelio' });

    const fuelly = await json<{ data: unknown }>(await detect('Date,Odometer,Fill Amount,Price'));
    expect(fuelly.data).toEqual({ id: 'fuelly', label: 'Fuelly' });

    const unknown = await json<{ data: unknown }>(await detect('Date,Amount,Category,Vehicle'));
    expect(unknown.data).toBeNull();
  });

  test('formats lists every importable format and the file types the picker accepts', async () => {
    const res = await ctx.authed('GET', '/api/v1/expenses/import/formats');
    expect(res.status).toBe(200);
    const body = await json<{
      data: { formats: { id: string; label: string }[]; accept: string[] };
    }>(res);
    expect(body.data.formats.map((f) => f.id)).toEqual(IMPORT_FORMATS.map((f) => f.id));
    expect(body.data.formats[0]).toEqual({ id: 'fuelio', label: 'Fuelio' });
    expect(body.data.accept).toEqual(['.csv', 'text/csv']);
  });

  test('detect refuses a sample longer than the limit', async () => {
    const res = await ctx.authed('POST', '/api/v1/expenses/import/detect', {
      sample: 'x'.repeat(8193),
    });
    expect(res.status).toBe(400);
  });

  test('a Fuelio import with only the format id and a category remap commits', async () => {
    await seedVehicle(ctx, { make: 'Volkswagen', model: 'Golf', year: 2018, nickname: 'Golf' });
    const res = await ctx.authed('POST', '/api/v1/expenses/import', {
      csv: FUELIO_EXPORT,
      mapping: { source: 'fuelio', columns: {}, dateFormat: 'iso', targetVehicle: 'Golf' },
    });
    const body = await json<ImportResponse>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.imported).toBe(1);
    const [row] = await listExpenses();
    expect(row.category).toBe('fuel');
  });
});
