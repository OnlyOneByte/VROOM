import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { parse } from 'csv-parse/sync';
import {
  createTestApp,
  type DataEnvelope,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { createInvitee } from '../../../test-helpers/invitee';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

const seedCivic = (nickname: string) =>
  seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021, nickname });

async function listExpenses(): Promise<
  Array<{ category: string; expenseAmount: number; date: string }>
> {
  const res = await ctx.authed('GET', '/api/v1/expenses?limit=100');
  const body = await json<{
    data: Array<{ category: string; expenseAmount: number; date: string }>;
  }>(res);
  return body.data;
}

interface RawExpenseRow {
  category: string;
  expense_amount: number;
  vehicle_id: string;
  mileage: number | null;
  volume: number | null;
  fuel_type: string | null;
  description: string | null;
  tags: string | null;
  missed_fillup: number;
  date_ms: number;
}
function listExpensesRaw(): RawExpenseRow[] {
  return ctx.sqlite
    .query(
      'SELECT category, expense_amount, vehicle_id, mileage, volume, fuel_type, description, tags, missed_fillup, date AS date_ms FROM expenses WHERE user_id = ? ORDER BY date'
    )
    .all(ctx.user.id) as RawExpenseRow[];
}

interface ImportResponse {
  data: {
    dryRun: boolean;
    imported: number;
    duplicates?: number;
    readyCount: number;
    errorCount: number;
    totalRows: number;
    rows: Array<{ row: number; status: string; message?: string }>;
    currencyWarning?: string;
  };
}

describe('POST /api/v1/expenses/import (CSV)', () => {
  test('401 without a session', async () => {
    const res = await ctx.anon('POST', '/api/v1/expenses/import', { csv: 'date\n2024-01-01' });
    expect(res.status).toBe(401);
  });

  test('round-trips a VROOM export: export → import → rows recreated', async () => {
    await seedCivic('Daily Driver');
    const csv = [
      'date,vehicle,category,amount,currency,mileage,volume,fuelType,description,tags,missedFillup,createdAt',
      '2024-06-01T00:00:00.000Z,Daily Driver,fuel,52.40,USD,30000,10,regular,Shell top-up,road; trip,false,',
      '2024-06-10T00:00:00.000Z,Daily Driver,maintenance,120,USD,,,,Oil change,,false,',
    ].join('\n');

    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv });
    const body = await json<ImportResponse>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.imported).toBe(2);
    expect(body.data.readyCount).toBe(2);
    expect(body.data.errorCount).toBe(0);

    const rows = await listExpenses();
    expect(rows.length).toBe(2);
    expect(rows.find((r) => r.category === 'fuel')?.expenseAmount).toBe(52.4);
    expect(rows.find((r) => r.category === 'maintenance')?.expenseAmount).toBe(120);
  });

  test('a populated fuel expense survives a full create→export→import round-trip with every field intact', async () => {
    const vehicleId = await seedCivic('Daily Driver');
    const createRes = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'fuel',
      expenseAmount: 52.4,
      date: '2024-06-15T00:00:00.000Z',
      mileage: 31234,
      volume: 11.5,
      fuelType: 'regular',
      description: 'Shell premium top-up',
      tags: ['road', 'trip'],
      missedFillup: true,
    });
    const created = await json<DataEnvelope<{ id: string }>>(createRes);
    expect(createRes.status, JSON.stringify(created)).toBeLessThan(300);

    const exportRes = await ctx.authed('GET', '/api/v1/expenses/export');
    expect(exportRes.status).toBe(200);
    const csv = await exportRes.text();

    ctx.sqlite.run('DELETE FROM expenses WHERE user_id = ?', [ctx.user.id]);
    expect(listExpensesRaw().length).toBe(0);

    const importRes = await ctx.authed('POST', '/api/v1/expenses/import', { csv });
    const importBody = await json<ImportResponse>(importRes);
    expect(importRes.status, JSON.stringify(importBody)).toBe(200);
    expect(importBody.data.imported).toBe(1);

    const [row] = listExpensesRaw();
    expect(row, 'the round-tripped expense exists').toBeDefined();
    expect(row?.category).toBe('fuel');
    expect(row?.expense_amount).toBe(5240);
    expect(row?.vehicle_id).toBe(vehicleId);
    expect(row?.mileage).toBe(31234);
    expect(row?.volume).toBeCloseTo(11.5, 2);
    expect(row?.fuel_type).toBe('regular');
    expect(row?.description).toBe('Shell premium top-up');
    expect(JSON.parse(row?.tags ?? '[]')).toEqual(['road', 'trip']);
    expect(row?.missed_fillup).toBe(1);
    const storedDay = new Date(Number(row?.date_ms) * 1000);
    expect(storedDay.getUTCFullYear()).toBe(2024);
  });

  test('a multi-tag cell splits on semicolons or commas into tags', async () => {
    await seedCivic('Daily Driver');
    const csv = [
      'date,vehicle,category,amount,currency,mileage,volume,fuelType,description,tags,missedFillup,createdAt',
      '2024-06-01T00:00:00.000Z,Daily Driver,misc,12,USD,,,,Semis,road; trip; toll,false,',
      '2024-06-02T00:00:00.000Z,Daily Driver,misc,13,USD,,,,Commas,"errand,grocery",false,',
    ].join('\n');

    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv });
    const body = await json<ImportResponse>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.imported).toBe(2);

    const rows = ctx.sqlite
      .query('SELECT description, tags FROM expenses WHERE user_id = ? ORDER BY date')
      .all(ctx.user.id) as Array<{ description: string; tags: string }>;
    const tagsOf = (desc: string) =>
      JSON.parse(rows.find((r) => r.description === desc)?.tags ?? '[]');
    expect(tagsOf('Semis')).toEqual(['road', 'trip', 'toll']);
    expect(tagsOf('Commas')).toEqual(['errand', 'grocery']);
  });

  test('missedFillup round-trips faithfully: the export `true`/`false` strings import to the stored boolean', async () => {
    await seedCivic('Daily Driver');
    const csv = [
      'date,vehicle,category,amount,currency,mileage,volume,fuelType,description,tags,missedFillup,createdAt',
      '2024-06-01T00:00:00.000Z,Daily Driver,fuel,40,USD,30000,10,regular,Missed one,,true,',
      '2024-06-05T00:00:00.000Z,Daily Driver,fuel,42,USD,30300,10,regular,Normal,,false,',
    ].join('\n');

    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv });
    const body = await json<ImportResponse>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.imported).toBe(2);

    const flags = ctx.sqlite
      .query('SELECT description, missed_fillup AS m FROM expenses WHERE user_id = ? ORDER BY date')
      .all(ctx.user.id) as Array<{ description: string; m: number }>;
    expect(flags.find((f) => f.description === 'Missed one')?.m).toBe(1);
    expect(flags.find((f) => f.description === 'Normal')?.m).toBe(0);
  });

  test('imports a BOM-prefixed CSV (Excel/Sheets/Numbers re-save); first column still resolves', async () => {
    await seedCivic('Daily Driver');
    const csv = `﻿${[
      'date,vehicle,category,amount',
      '2024-06-01T00:00:00.000Z,Daily Driver,misc,12.50',
    ].join('\n')}`;

    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv });
    const body = await json<ImportResponse>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.imported).toBe(1);
    expect(body.data.readyCount).toBe(1);
    expect(body.data.errorCount).toBe(0);
    expect(body.data.rows.every((r) => r.status === 'ready')).toBe(true);
    expect((await listExpenses()).length).toBe(1);
  });

  test('a DATE-ONLY cell keeps its calendar day (stored at UTC noon, no midnight day-shift)', async () => {
    await seedCivic('Daily Driver');
    const csv = ['date,vehicle,category,amount', '2024-03-15,Daily Driver,misc,20.00'].join('\n');

    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv });
    const body = await json<ImportResponse>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.imported).toBe(1);

    const [row] = await listExpenses();
    const stored = new Date(row.date);
    expect(stored.toISOString()).toBe('2024-03-15T12:00:00.000Z');
  });

  test('an OUT-OF-RANGE date-only cell is REJECTED, not silently rolled forward', async () => {
    await seedCivic('Daily Driver');
    const csv = [
      'date,vehicle,category,amount',
      '2024-13-45,Daily Driver,fuel,40.00',
      '2024-02-30,Daily Driver,misc,10.00',
    ].join('\n');

    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv });
    const body = await json<ImportResponse>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.imported).toBe(0);
    expect(body.data.errorCount).toBe(2);
    expect(
      body.data.rows.every((r) => (r.message ?? '').toLowerCase().includes('invalid date'))
    ).toBe(true);
    expect(await listExpenses()).toHaveLength(0);
  });

  test('a date that is not ISO, or outside 1900-2100, is rejected instead of guessed', async () => {
    await seedCivic('Daily Driver');
    const csv = [
      'date,vehicle,category,amount',
      '1,Daily Driver,misc,10',
      '0,Daily Driver,misc,10',
      'March 5,Daily Driver,misc,10',
      '1850-01-01,Daily Driver,misc,10',
      '9999-12-31,Daily Driver,misc,10',
      '2101-01-01T00:00:00.000Z,Daily Driver,misc,10',
      '1900-01-01,Daily Driver,misc,10',
      '2100-12-31T12:00:00.000Z,Daily Driver,misc,10',
    ].join('\n');

    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv, dryRun: true });
    const body = await json<ImportResponse>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.rows.map((r) => [r.status, r.message])).toEqual([
      ['error', 'Invalid date "1". Use YYYY-MM-DD'],
      ['error', 'Invalid date "0". Use YYYY-MM-DD'],
      ['error', 'Invalid date "March 5". Use YYYY-MM-DD'],
      ['error', 'Date must be between 1900 and 2100'],
      ['error', 'Date must be between 1900 and 2100'],
      ['error', 'Date must be between 1900 and 2100'],
      ['ready', undefined],
      ['ready', undefined],
    ]);
  });

  test('a full-ISO timestamp keeps its absolute instant', async () => {
    await seedCivic('Daily Driver');
    const iso = '2024-06-01T13:30:00.000Z';
    const csv = ['date,vehicle,category,amount', `${iso},Daily Driver,misc,12.50`].join('\n');

    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv });
    const body = await json<ImportResponse>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.imported).toBe(1);

    const [row] = await listExpenses();
    expect(new Date(row.date).getTime()).toBe(new Date(iso).getTime());
  });

  test('re-importing the same file is idempotent (no duplicate rows)', async () => {
    await seedCivic('Daily Driver');
    const csv = [
      'date,vehicle,category,amount',
      '2024-06-01T00:00:00.000Z,Daily Driver,misc,12.50',
      '2024-06-02T00:00:00.000Z,Daily Driver,regulatory,40',
      '2024-06-02T00:00:00.000Z,Daily Driver,maintenance,75',
    ].join('\n');

    const first = await json<ImportResponse>(
      await ctx.authed('POST', '/api/v1/expenses/import', { csv })
    );
    expect(first.data.imported).toBe(3);
    expect(first.data.duplicates).toBe(0);
    expect((await listExpenses()).length).toBe(3);

    const second = await json<ImportResponse>(
      await ctx.authed('POST', '/api/v1/expenses/import', { csv })
    );
    expect(second.data.imported).toBe(0);
    expect(second.data.duplicates).toBe(3);
    expect((await listExpenses()).length).toBe(3);
  });

  test('two genuinely identical rows in ONE file both import (occurrence-keyed)', async () => {
    await seedCivic('Daily Driver');
    const csv = [
      'date,vehicle,category,amount',
      '2024-06-01T00:00:00.000Z,Daily Driver,misc,10',
      '2024-06-01T00:00:00.000Z,Daily Driver,misc,10',
    ].join('\n');

    const body = await json<ImportResponse>(
      await ctx.authed('POST', '/api/v1/expenses/import', { csv })
    );
    expect(body.data.imported).toBe(2);
    expect(body.data.duplicates).toBe(0);
    expect((await listExpenses()).length).toBe(2);
  });

  test('dryRun validates + reports but writes NOTHING', async () => {
    await seedCivic('Daily Driver');
    const csv = [
      'date,vehicle,category,amount',
      '2024-06-01T00:00:00.000Z,Daily Driver,misc,12.50',
    ].join('\n');

    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv, dryRun: true });
    const body = await json<ImportResponse>(res);
    expect(res.status).toBe(200);
    expect(body.data.dryRun).toBe(true);
    expect(body.data.imported).toBe(0);
    expect(body.data.readyCount).toBe(1);

    expect((await listExpenses()).length).toBe(0);
  });

  test('a yen account flags fractional yen per row in the dry run, and the import keeps the good rows', async () => {
    await seedCivic('Daily Driver');
    expect((await ctx.authed('PUT', '/api/v1/settings', { currencyUnit: 'JPY' })).status).toBe(200);
    const csv = [
      'date,vehicle,category,amount',
      '2024-06-01T00:00:00.000Z,Daily Driver,misc,1200',
      '2024-06-02T00:00:00.000Z,Daily Driver,misc,12.50',
    ].join('\n');

    const preview = await json<ImportResponse>(
      await ctx.authed('POST', '/api/v1/expenses/import', { csv, dryRun: true })
    );
    expect(preview.data.readyCount).toBe(1);
    const [bad] = preview.data.rows.filter((r) => r.status === 'error');
    expect(bad?.row).toBe(3);
    expect(bad?.message).toMatch(/must be whole numbers/);

    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv });
    expect(res.status).toBe(200);
    expect((await json<ImportResponse>(res)).data.imported).toBe(1);
    expect((await listExpenses()).map((e) => e.expenseAmount)).toEqual([1200]);
  });

  test('a car shared with the importer cannot be an import target', async () => {
    const sharedId = await seedCivic('Owner Car');
    const b = await createInvitee(ctx, 'import-sharee', 'Sharee');
    const invite = await ctx.authed('POST', '/api/v1/shares', {
      vehicleId: sharedId,
      email: b.email,
      level: 'editor',
    });
    const inviteId = (await json<DataEnvelope<{ id: string }>>(invite)).data.id;
    expect((await b.request('POST', `/api/v1/shares/${inviteId}/accept`)).status).toBe(200);
    const own = await b.request('POST', '/api/v1/vehicles', {
      make: 'Mazda',
      model: '3',
      year: 2020,
      nickname: 'Own Car',
    });
    expect(own.status).toBeLessThan(300);

    const csv = [
      'date,vehicle,category,amount',
      '2024-06-01T00:00:00.000Z,Owner Car,misc,12.50',
      '2024-06-01T00:00:00.000Z,Own Car,misc,12.50',
    ].join('\n');
    const res = await b.request('POST', '/api/v1/expenses/import', { csv });
    const body = await json<ImportResponse>(res);
    expect(body.data.imported).toBe(1);
    expect(body.data.rows.find((r) => r.row === 2)?.status).toBe('error');
    expect(
      ctx.sqlite.query('SELECT COUNT(*) AS n FROM expenses WHERE vehicle_id = ?').get(sharedId)
    ).toEqual({ n: 0 });
  });

  test('reports per-row errors (bad category / amount / date) and imports the good ones', async () => {
    await seedCivic('Daily Driver');
    const csv = [
      'date,vehicle,category,amount',
      '2024-06-01T00:00:00.000Z,Daily Driver,misc,10',
      '2024-06-02T00:00:00.000Z,Daily Driver,banana,10',
      '2024-06-03T00:00:00.000Z,Daily Driver,misc,-5',
      'not-a-date,Daily Driver,misc,10',
    ].join('\n');

    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv });
    const body = await json<ImportResponse>(res);
    expect(res.status).toBe(200);
    expect(body.data.totalRows).toBe(4);
    expect(body.data.readyCount).toBe(1);
    expect(body.data.errorCount).toBe(3);
    expect(body.data.imported).toBe(1);
    expect((await listExpenses()).length).toBe(1);
    const errors = body.data.rows.filter((r) => r.status === 'error');
    expect(errors.length).toBe(3);
    expect(errors.every((e) => typeof e.message === 'string' && e.message.length > 0)).toBe(true);
  });

  test("rejects a vehicle name NOT in the user's garage (no cross-tenant attachment)", async () => {
    await seedCivic('Daily Driver');
    const csv = [
      'date,vehicle,category,amount',
      "2024-06-01T00:00:00.000Z,Someone Else's Car,misc,10",
    ].join('\n');

    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv });
    const body = await json<ImportResponse>(res);
    expect(res.status).toBe(200);
    expect(body.data.imported).toBe(0);
    expect(body.data.errorCount).toBe(1);
    expect(body.data.rows[0]?.message).toContain('No vehicle named');
    expect((await listExpenses()).length).toBe(0);
  });

  test('fuel rows missing volume/mileage are rejected (mirrors the create rule)', async () => {
    await seedCivic('Daily Driver');
    const csv = [
      'date,vehicle,category,amount,mileage,volume',
      '2024-06-01T00:00:00.000Z,Daily Driver,fuel,40,,',
    ].join('\n');

    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv });
    const body = await json<ImportResponse>(res);
    expect(res.status).toBe(200);
    expect(body.data.errorCount).toBe(1);
    expect(body.data.rows[0]?.message?.toLowerCase()).toContain('fuel');
    expect((await listExpenses()).length).toBe(0);
  });

  test('an amount with more than 2 decimals or a mileage over 10,000,000 is rejected, not rounded', async () => {
    await seedCivic('Daily Driver');
    const csv = [
      'date,vehicle,category,amount,mileage',
      '2024-06-01T00:00:00.000Z,Daily Driver,misc,12.345,',
      '2024-06-02T00:00:00.000Z,Daily Driver,misc,12.34,10000000',
      '2024-06-03T00:00:00.000Z,Daily Driver,misc,5,10000001',
    ].join('\n');

    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv });
    const body = await json<ImportResponse>(res);
    expect(res.status).toBe(200);
    expect(body.data.rows.map((r) => [r.status, r.message])).toEqual([
      [
        'error',
        'Amount "12.345" can have at most 2 decimal places. VROOM stores amounts to the cent',
      ],
      ['ready', undefined],
      ['error', 'Odometer must be 10,000,000 or less'],
    ]);
    expect((await listExpenses()).map((r) => r.expenseAmount)).toEqual([12.34]);
  });

  test('a mileage of 0 is blank on a non-fuel row and refused on a fuel row, never stored as a reading', async () => {
    await seedCivic('Daily Driver');
    const csv = [
      'date,vehicle,category,amount,mileage,volume',
      '2024-06-01T00:00:00.000Z,Daily Driver,misc,5,0,',
      '2024-06-02T00:00:00.000Z,Daily Driver,fuel,40,0,10',
      '2024-06-03T00:00:00.000Z,Daily Driver,misc,5,1,',
    ].join('\n');

    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv });
    const body = await json<ImportResponse>(res);
    expect(res.status).toBe(200);
    expect(body.data.rows.map((r) => [r.status, r.message])).toEqual([
      ['ready', undefined],
      ['error', 'Mileage must be greater than 0'],
      ['ready', undefined],
    ]);
    expect(listExpensesRaw().map((r) => r.mileage)).toEqual([null, 1]);
  });

  test('a stored mileage of 0 exports blank and the export re-imports cleanly', async () => {
    const vehicleId = await seedCivic('Daily Driver');
    ctx.sqlite.run(
      `INSERT INTO expenses (id, vehicle_id, user_id, category, expense_amount, date, mileage)
       VALUES ('legacy-zero', ?, ?, 'maintenance', 4500, 1717243200, 0)`,
      [vehicleId, ctx.user.id]
    );

    const exportRes = await ctx.authed('GET', '/api/v1/expenses/export');
    expect(exportRes.status).toBe(200);
    const csv = await exportRes.text();
    const exported = parse(csv, { columns: true }) as Record<string, string>[];
    expect(exported.map((r) => [r.category, r.mileage])).toEqual([['maintenance', '']]);

    ctx.sqlite.run('DELETE FROM expenses WHERE user_id = ?', [ctx.user.id]);
    const importRes = await ctx.authed('POST', '/api/v1/expenses/import', { csv });
    const importBody = await json<ImportResponse>(importRes);
    expect(importRes.status, JSON.stringify(importBody)).toBe(200);
    expect(importBody.data.errorCount).toBe(0);
    expect(importBody.data.imported).toBe(1);
    expect(listExpensesRaw().map((r) => [r.category, r.expense_amount, r.mileage])).toEqual([
      ['maintenance', 4500, null],
    ]);
  });

  test('matches a vehicle by its "year make model" name too (not just nickname)', async () => {
    await seedCivic('Daily Driver');
    const csv = [
      'date,vehicle,category,amount',
      '2024-06-01T00:00:00.000Z,2021 Honda Civic,misc,15',
    ].join('\n');

    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv });
    const body = await json<ImportResponse>(res);
    expect(res.status).toBe(200);
    expect(body.data.imported).toBe(1);
  });

  test('an AMBIGUOUS "year make model" name (two cars share it) errors, not silent misattribution', async () => {
    await seedCivic('Work Car');
    await seedCivic('Personal Car');
    const csv = [
      'date,vehicle,category,amount',
      '2024-06-01T00:00:00.000Z,2021 Honda Civic,misc,50',
    ].join('\n');

    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv });
    const body = await json<ImportResponse>(res);
    expect(res.status).toBe(200);
    expect(body.data.imported).toBe(0);
    expect(body.data.errorCount).toBe(1);
    expect(body.data.rows[0]?.message).toContain('more than one vehicle');
  });

  test('a UNIQUE nickname still resolves even when its year/make/model is shared', async () => {
    await seedCivic('Work Car');
    await seedCivic('Personal Car');
    const csv = ['date,vehicle,category,amount', '2024-06-01T00:00:00.000Z,Work Car,misc,50'].join(
      '\n'
    );

    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv });
    const body = await json<ImportResponse>(res);
    expect(res.status).toBe(200);
    expect(body.data.imported).toBe(1);
  });

  test('400 on an empty CSV (header only, no data rows)', async () => {
    await seedCivic('Daily Driver');
    const res = await ctx.authed('POST', '/api/v1/expenses/import', {
      csv: 'date,vehicle,category,amount',
    });
    expect(res.status).toBe(400);
  });

  test('400 when the user has no vehicles at all', async () => {
    const csv = ['date,vehicle,category,amount', '2024-06-01T00:00:00.000Z,Whatever,misc,10'].join(
      '\n'
    );
    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv });
    expect(res.status).toBe(400);
  });

  test('round-trips a formula-injection description faithfully (export → import un-prefixes)', async () => {
    const vehicleId = await seedCivic('Daily Driver');
    const formula = '=SUM(A1:A2) reimbursement';
    const created = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 25,
      date: '2024-06-01T00:00:00.000Z',
      description: formula,
    });
    expect(created.status, await created.text()).toBeLessThan(300);

    const exportRes = await ctx.authed('GET', '/api/v1/expenses/export');
    const csv = await exportRes.text();
    expect(csv).toContain(`'${formula}`);

    const list0 = await json<{ data: Array<{ id: string }> }>(
      await ctx.authed('GET', '/api/v1/expenses?limit=100')
    );
    for (const r of list0.data) await ctx.authed('DELETE', `/api/v1/expenses/${r.id}`);

    const importRes = await ctx.authed('POST', '/api/v1/expenses/import', { csv });
    const body = await json<ImportResponse>(importRes);
    expect(importRes.status, JSON.stringify(body)).toBe(200);
    expect(body.data.imported).toBe(1);

    const list = await json<{ data: Array<{ description: string | null }> }>(
      await ctx.authed('GET', '/api/v1/expenses?limit=100')
    );
    expect(list.data.length).toBe(1);
    expect(list.data[0]?.description).toBe(formula);
  });

  test('preserves a genuinely apostrophe-led description (does not over-strip)', async () => {
    await seedCivic('Daily Driver');
    const csv = [
      'date,vehicle,category,amount,description',
      "2024-06-01T00:00:00.000Z,Daily Driver,misc,10,'24 road trip fuel",
    ].join('\n');

    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv });
    const body = await json<ImportResponse>(res);
    expect(res.status).toBe(200);
    expect(body.data.imported).toBe(1);

    const list = await json<{ data: Array<{ description: string | null }> }>(
      await ctx.authed('GET', '/api/v1/expenses?limit=100')
    );
    expect(list.data[0]?.description).toBe("'24 road trip fuel");
  });

  test('round-trips a description that starts with an apostrophe and a trigger character losslessly', async () => {
    const vehicleId = await seedCivic('Daily Driver');
    const userTyped = "'=Daily mention";
    const created = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 25,
      date: '2024-06-01T00:00:00.000Z',
      description: userTyped,
    });
    expect(created.status, await created.text()).toBeLessThan(300);

    const csv = await (await ctx.authed('GET', '/api/v1/expenses/export')).text();
    expect(csv).toContain(`''=Daily mention`);

    const list0 = await json<{ data: Array<{ id: string }> }>(
      await ctx.authed('GET', '/api/v1/expenses?limit=100')
    );
    for (const r of list0.data) await ctx.authed('DELETE', `/api/v1/expenses/${r.id}`);

    const importRes = await ctx.authed('POST', '/api/v1/expenses/import', { csv });
    const body = await json<ImportResponse>(importRes);
    expect(importRes.status, JSON.stringify(body)).toBe(200);
    expect(body.data.imported).toBe(1);

    const list = await json<{ data: Array<{ description: string | null }> }>(
      await ctx.authed('GET', '/api/v1/expenses?limit=100')
    );
    expect(list.data.length).toBe(1);
    expect(list.data[0]?.description).toBe(userTyped);
  });

  test('a non-fuel imported row keeps its mileage and stores volume/fuelType NULL (the import write site)', async () => {
    await seedCivic('Daily Driver');
    const csv = [
      'date,vehicle,category,amount,currency,mileage,volume,fuelType,description,tags,missedFillup,createdAt',
      '2024-06-10T00:00:00.000Z,Daily Driver,maintenance,120,USD,120000,5,regular,Oil change,,true,',
    ].join('\n');

    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv });
    const body = await json<ImportResponse>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.imported).toBe(1);

    const row = listExpensesRaw().find((r) => r.category === 'maintenance');
    expect(row, 'the maintenance row imported').toBeTruthy();
    expect(row?.mileage).toBe(120000);
    expect(row?.volume).toBeNull();
    expect(row?.fuel_type).toBeNull();
    expect(row?.missed_fillup).toBe(0);
  });

  test('a genuine fuel imported row KEEPS its mileage/volume/fuelType (no over-clear)', async () => {
    await seedCivic('Daily Driver');
    const csv = [
      'date,vehicle,category,amount,currency,mileage,volume,fuelType,description,tags,missedFillup,createdAt',
      '2024-06-01T00:00:00.000Z,Daily Driver,fuel,52.40,USD,30000,10,regular,Shell top-up,,false,',
    ].join('\n');

    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv });
    expect((await json<ImportResponse>(res)).data.imported).toBe(1);

    const row = listExpensesRaw().find((r) => r.category === 'fuel');
    expect(row?.mileage).toBe(30000);
    expect(row?.volume).toBe(10);
    expect(row?.fuel_type).toBe('regular');
  });
});

describe('import currency check', () => {
  const HEADER = 'date,vehicle,category,amount,currency,description';
  const csvIn = (...currencies: string[]) =>
    [
      HEADER,
      ...currencies.map((cur, i) => `2024-06-0${i + 1}T00:00:00.000Z,Daily Driver,misc,5,${cur},`),
    ].join('\n');

  test('a file in another currency gets a warning in the dry run and imports the amounts unconverted', async () => {
    await seedCivic('Daily Driver');
    await ctx.authed('PUT', '/api/v1/settings', { currencyUnit: 'JPY' });

    const preview = await json<ImportResponse>(
      await ctx.authed('POST', '/api/v1/expenses/import', {
        csv: csvIn('EUR', 'eur'),
        dryRun: true,
      })
    );
    expect(preview.data.currencyWarning).toBe(
      'This file is in EUR; amounts will be imported as JPY without conversion.'
    );

    const imported = await json<ImportResponse>(
      await ctx.authed('POST', '/api/v1/expenses/import', { csv: csvIn('EUR', 'eur') })
    );
    expect(imported.data.imported).toBe(2);
    expect((await listExpenses()).map((r) => r.expenseAmount)).toEqual([5, 5]);
  });

  test('no warning when the file matches the account currency or has no currency column', async () => {
    await seedCivic('Daily Driver');

    const same = await json<ImportResponse>(
      await ctx.authed('POST', '/api/v1/expenses/import', { csv: csvIn('USD'), dryRun: true })
    );
    expect(same.data.currencyWarning).toBeUndefined();

    const noColumn = await json<ImportResponse>(
      await ctx.authed('POST', '/api/v1/expenses/import', {
        csv: 'date,vehicle,category,amount\n2024-06-01T00:00:00.000Z,Daily Driver,misc,5',
        dryRun: true,
      })
    );
    expect(noColumn.data.readyCount).toBe(1);
    expect(noColumn.data.currencyWarning).toBeUndefined();
  });

  test('only three-letter codes count, so free text in the column never reaches the warning', async () => {
    await seedCivic('Daily Driver');

    const res = await json<ImportResponse>(
      await ctx.authed('POST', '/api/v1/expenses/import', {
        csv: csvIn('euros please', 'X', 'GBP', 'TOOLONG'),
        dryRun: true,
      })
    );
    expect(res.data.currencyWarning).toBe(
      'This file is in GBP; amounts will be imported as USD without conversion.'
    );
  });
});
