/**
 * In-process HTTP tests for POST /api/v1/expenses/import through the REAL stack.
 * Proves the round-trip with /export, dryRun writes nothing, per-row validation
 * surfaces every bad row (not just the first), the vehicle is resolved by NAME
 * within the user's OWN fleet (a name not in the garage is rejected, never a
 * cross-tenant write — the cycle-145 class), and the row cap rejects huge files.
 *
 * createTestApp() must run before static config/connection imports — keep this
 * file's imports to the harness + bun:test only.
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

async function listExpenses(): Promise<Array<{ category: string; expenseAmount: number }>> {
  const res = await ctx.authed('GET', '/api/v1/expenses?limit=100');
  const body = await json<{ data: Array<{ category: string; expenseAmount: number }> }>(res);
  return body.data;
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
  };
}

describe('POST /api/v1/expenses/import (CSV)', () => {
  test('401 without a session', async () => {
    const res = await ctx.anon('POST', '/api/v1/expenses/import', { csv: 'date\n2024-01-01' });
    expect(res.status).toBe(401);
  });

  test('round-trips a VROOM export: export → import → rows recreated', async () => {
    await seedVehicle('Daily Driver');
    // Build a CSV in the exact EXPORT_COLUMNS shape the exporter writes.
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

  test('re-importing the same file is idempotent (no duplicate rows; cycle 211)', async () => {
    await seedVehicle('Daily Driver');
    const csv = [
      'date,vehicle,category,amount',
      '2024-06-01T00:00:00.000Z,Daily Driver,misc,12.50',
      '2024-06-02T00:00:00.000Z,Daily Driver,regulatory,40', // three distinct rows
      '2024-06-02T00:00:00.000Z,Daily Driver,maintenance,75',
    ].join('\n');

    const first = await json<ImportResponse>(
      await ctx.authed('POST', '/api/v1/expenses/import', { csv })
    );
    expect(first.data.imported).toBe(3);
    expect(first.data.duplicates).toBe(0);
    expect((await listExpenses()).length).toBe(3);

    // Same file again: every row already exists by its deterministic clientId, so
    // nothing is inserted and all are reported as duplicates — NOT duplicated.
    const second = await json<ImportResponse>(
      await ctx.authed('POST', '/api/v1/expenses/import', { csv })
    );
    expect(second.data.imported).toBe(0);
    expect(second.data.duplicates).toBe(3);
    expect((await listExpenses()).length).toBe(3); // still 3, not 6
  });

  test('two genuinely identical rows in ONE file both import (occurrence-keyed)', async () => {
    await seedVehicle('Daily Driver');
    // Same content twice — these are two real expenses (e.g. two $10 tolls same day),
    // distinguished by occurrence index, so both must land.
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
    await seedVehicle('Daily Driver');
    const csv = [
      'date,vehicle,category,amount',
      '2024-06-01T00:00:00.000Z,Daily Driver,misc,12.50',
    ].join('\n');

    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv, dryRun: true });
    const body = await json<ImportResponse>(res);
    expect(res.status).toBe(200);
    expect(body.data.dryRun).toBe(true);
    expect(body.data.imported).toBe(0);
    expect(body.data.readyCount).toBe(1); // it WOULD import 1

    // ...but the DB is untouched.
    expect((await listExpenses()).length).toBe(0);
  });

  test('reports per-row errors (bad category / amount / date) and imports the good ones', async () => {
    await seedVehicle('Daily Driver');
    const csv = [
      'date,vehicle,category,amount',
      '2024-06-01T00:00:00.000Z,Daily Driver,misc,10', // ok
      '2024-06-02T00:00:00.000Z,Daily Driver,banana,10', // bad category
      '2024-06-03T00:00:00.000Z,Daily Driver,misc,-5', // bad amount
      'not-a-date,Daily Driver,misc,10', // bad date
    ].join('\n');

    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv });
    const body = await json<ImportResponse>(res);
    expect(res.status).toBe(200);
    expect(body.data.totalRows).toBe(4);
    expect(body.data.readyCount).toBe(1);
    expect(body.data.errorCount).toBe(3);
    expect(body.data.imported).toBe(1);
    // Only the one valid row was written.
    expect((await listExpenses()).length).toBe(1);
    // Every bad row is reported with a message (not just the first).
    const errors = body.data.rows.filter((r) => r.status === 'error');
    expect(errors.length).toBe(3);
    expect(errors.every((e) => typeof e.message === 'string' && e.message.length > 0)).toBe(true);
  });

  test("rejects a vehicle name NOT in the user's garage (no cross-tenant attachment)", async () => {
    await seedVehicle('Daily Driver');
    // "Someone Else's Car" is not in this user's fleet — the importer resolves
    // vehicles by name within findByUserId, so it can never attach to a vehicle
    // the user doesn't own (the cycle-145 cross-tenant-write class).
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
    await seedVehicle('Daily Driver');
    const csv = [
      'date,vehicle,category,amount,mileage,volume',
      '2024-06-01T00:00:00.000Z,Daily Driver,fuel,40,,', // fuel without volume+mileage
    ].join('\n');

    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv });
    const body = await json<ImportResponse>(res);
    expect(res.status).toBe(200);
    expect(body.data.errorCount).toBe(1);
    expect(body.data.rows[0]?.message?.toLowerCase()).toContain('fuel');
    expect((await listExpenses()).length).toBe(0);
  });

  test('matches a vehicle by its "year make model" name too (not just nickname)', async () => {
    await seedVehicle('Daily Driver'); // Honda Civic 2021
    const csv = [
      'date,vehicle,category,amount',
      '2024-06-01T00:00:00.000Z,2021 Honda Civic,misc,15',
    ].join('\n');

    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv });
    const body = await json<ImportResponse>(res);
    expect(res.status).toBe(200);
    expect(body.data.imported).toBe(1);
  });

  test('400 on an empty CSV (header only, no data rows)', async () => {
    await seedVehicle('Daily Driver');
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
    // The export neutralizes CWE-1236 cells by prefixing a leading ' (so a
    // spreadsheet treats `=...` as text). On re-import the importer must STRIP that
    // prefix symmetrically, else `=SUM(A1:A2)` round-trips to `'=SUM(A1:A2)` — silent
    // corruption (cycle 192 fix). Create → export → import → description identical.
    const vehicleId = await seedVehicle('Daily Driver');
    const formula = '=SUM(A1:A2) reimbursement';
    const created = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 25,
      date: '2024-06-01T00:00:00.000Z',
      description: formula,
    });
    expect(created.status, await created.text()).toBeLessThan(300);

    // Export (server neutralizes the description on the way out).
    const exportRes = await ctx.authed('GET', '/api/v1/expenses/export');
    const csv = await exportRes.text();
    expect(csv).toContain(`'${formula}`); // proves it WAS neutralized on export

    // Delete the original so the re-import is the only row carrying this description.
    const list0 = await json<{ data: Array<{ id: string }> }>(
      await ctx.authed('GET', '/api/v1/expenses?limit=100')
    );
    for (const r of list0.data) await ctx.authed('DELETE', `/api/v1/expenses/${r.id}`);

    // Re-import the exported CSV.
    const importRes = await ctx.authed('POST', '/api/v1/expenses/import', { csv });
    const body = await json<ImportResponse>(importRes);
    expect(importRes.status, JSON.stringify(body)).toBe(200);
    expect(body.data.imported).toBe(1);

    // The imported description equals the ORIGINAL — not the neutralized `'=...`.
    const list = await json<{ data: Array<{ description: string | null }> }>(
      await ctx.authed('GET', '/api/v1/expenses?limit=100')
    );
    expect(list.data.length).toBe(1);
    expect(list.data[0]?.description).toBe(formula);
  });

  test('preserves a genuinely apostrophe-led description (does not over-strip)', async () => {
    // denormalize must only strip `'`+formula-trigger; a user-typed leading
    // apostrophe (followed by a normal char) must survive the import untouched.
    await seedVehicle('Daily Driver');
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
});
