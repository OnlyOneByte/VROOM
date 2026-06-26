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
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

// Seed the file's fixture vehicle: a Honda Civic 2021 with the given nickname — several tests rely on
// the exact "2021 Honda Civic" name-match and the #102 same-year/make/model ambiguity, so make/model/year
// are passed explicitly (the shared seedVehicle default is a Toyota Camry). Converged onto the shared
// test-helpers/seed seedVehicle (arch convergence, Angelo-approved).
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

/** Raw expense rows straight off sqlite — exposes columns (fuel_type, missed_fillup, tags JSON, the
 *  integer `date` timestamp) the list endpoint omits or reshapes, for full round-trip assertions. */
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
  };
}

describe('POST /api/v1/expenses/import (CSV)', () => {
  test('401 without a session', async () => {
    const res = await ctx.anon('POST', '/api/v1/expenses/import', { csv: 'date\n2024-01-01' });
    expect(res.status).toBe(401);
  });

  test('round-trips a VROOM export: export → import → rows recreated', async () => {
    await seedCivic('Daily Driver');
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

  // C383: the FULL export→import round-trip on a populated fuel row. export-csv.test.ts pins the export
  // SHAPE (filters, formula-injection, currency, numeric-quoting) and import-csv pins individual import
  // fields, but NOTHING drove a create→EXPORT→import→re-read asserting EVERY field survives together — the
  // NORTH_STAR #1 crown jewel ("export → re-import round-trips losslessly"). A regression in either the
  // export serialization OR the import parse of any one field would silently corrupt that field on a real
  // user's backup/restore-via-CSV. Create a fully-populated fuel expense, export it, WIPE the table (avoids
  // the idempotency/duplicate-detection collision), import the exact exported CSV, and read the row back.
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

    // Export the current state to CSV (the exact bytes a user would download).
    const exportRes = await ctx.authed('GET', '/api/v1/expenses/export');
    expect(exportRes.status).toBe(200);
    const csv = await exportRes.text();

    // Wipe expenses so the re-import recreates from the CSV alone (no duplicate-detection interference).
    ctx.sqlite.run('DELETE FROM expenses WHERE user_id = ?', [ctx.user.id]);
    expect(listExpensesRaw().length).toBe(0);

    const importRes = await ctx.authed('POST', '/api/v1/expenses/import', { csv });
    const importBody = await json<ImportResponse>(importRes);
    expect(importRes.status, JSON.stringify(importBody)).toBe(200);
    expect(importBody.data.imported).toBe(1);

    // Read the recreated row straight off sqlite and assert EVERY round-tripped field.
    const [row] = listExpensesRaw();
    expect(row, 'the round-tripped expense exists').toBeDefined();
    expect(row?.category).toBe('fuel');
    expect(row?.expense_amount).toBe(5240); // $52.40 → 5240 cents in the raw DB row (money-cents-migration)
    expect(row?.vehicle_id).toBe(vehicleId); // resolved back by vehicle NAME
    expect(row?.mileage).toBe(31234);
    expect(row?.volume).toBeCloseTo(11.5, 2);
    expect(row?.fuel_type).toBe('regular');
    expect(row?.description).toBe('Shell premium top-up');
    expect(JSON.parse(row?.tags ?? '[]')).toEqual(['road', 'trip']);
    expect(row?.missed_fillup).toBe(1); // boolean true survived as the stored 1
    // The calendar day is preserved (ISO export → import; the stored instant's local day is 2024-06-15).
    const storedDay = new Date(Number(row?.date_ms) * 1000);
    expect(storedDay.getUTCFullYear()).toBe(2024);
  });

  test('a multi-tag cell splits on ; OR , into a real tags array (the export "; "-join → import round-trip, #104 by-design)', async () => {
    // The round-trip test above imports a `road; trip` cell but only asserts amounts — the tags
    // ARRAY it produces was never verified, leaving the multi-tag split (parseTags' `split(/[;,]/)`)
    // unpinned. This is the intended export↔import contract: the exporter joins a tags array with
    // "; " (routes.ts), and import splits on ; OR , back into the array. #104 (C352) guarantees no
    // single tag can CONTAIN ; or , (rejected at the write boundary), so a delimiter in a cell is
    // ALWAYS a separator, never literal data — splitting is correct, not data loss. Pin both
    // delimiters + the trim, so a regression narrowing the split silently merges two tags into one.
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

    // Read the stored tags (JSON column) straight off sqlite — the list endpoint shape above omits it.
    const rows = ctx.sqlite
      .query('SELECT description, tags FROM expenses WHERE user_id = ? ORDER BY date')
      .all(ctx.user.id) as Array<{ description: string; tags: string }>;
    const tagsOf = (desc: string) =>
      JSON.parse(rows.find((r) => r.description === desc)?.tags ?? '[]');
    // "road; trip; toll" → three trimmed tags (semicolon split + trim).
    expect(tagsOf('Semis')).toEqual(['road', 'trip', 'toll']);
    // "errand,grocery" (QUOTED so the CSV parser keeps it as one cell) → two tags (comma split + trim).
    expect(tagsOf('Commas')).toEqual(['errand', 'grocery']);
  });

  test('missedFillup round-trips faithfully: the export `true`/`false` strings import to the stored boolean (C321)', async () => {
    // The export writes missedFillup as the literal 'true'/'false' (routes.ts:432); import parses it with
    // /^(true|1|yes)$/i. A regression narrowing that regex (e.g. to only '1') would silently import EVERY
    // missed-fillup row as false — corrupting MPG pairing (a missed fillup means the next interval spans two
    // tanks and must be EXCLUDED from efficiency). The export↔import round-trip test above only used
    // missedFillup=false, so the truthy-parse path was unpinned. Pin both: 'true' → stored 1, 'false' → 0.
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

    // Read the stored missed_fillup flags straight off sqlite (the list endpoint omits the column).
    const flags = ctx.sqlite
      .query('SELECT description, missed_fillup AS m FROM expenses WHERE user_id = ? ORDER BY date')
      .all(ctx.user.id) as Array<{ description: string; m: number }>;
    expect(flags.find((f) => f.description === 'Missed one')?.m).toBe(1); // 'true' → stored true
    expect(flags.find((f) => f.description === 'Normal')?.m).toBe(0); // 'false' → stored false
  });

  test('imports a BOM-prefixed CSV (Excel/Sheets/Numbers re-save); first column still resolves', async () => {
    await seedCivic('Daily Driver');
    // Excel / Google Sheets / Numbers prepend a UTF-8 BOM (﻿) when they re-save a
    // CSV as UTF-8. WITHOUT bom:true on the parser the BOM sticks to the FIRST header
    // name, so the `date` column key becomes "﻿date" → record.date is undefined and
    // EVERY row fails with a misleading "Invalid date" (cycle 51). bom:true strips it
    // pre-parse, so a VROOM export survives a spreadsheet round-trip. (Pre-fix this test
    // would see imported:0 / errorCount:1 with an "Invalid date" message.)
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

  test('a DATE-ONLY cell keeps its calendar day in local time (no UTC-midnight day-shift)', async () => {
    await seedCivic('Daily Driver');
    // A hand-edited or foreign CSV commonly uses bare YYYY-MM-DD (no time). `new Date('2024-03-15')`
    // parses as UTC midnight, so a user west of UTC would see the expense land on Mar 14 (cycle-6/11).
    // parseDate now builds a date-only value from parts in LOCAL time. We assert the timezone-independent
    // invariant: the stored instant's LOCAL calendar day equals the imported day — true in any CI zone.
    // (Pre-fix, in a negative-offset zone, getDate() would be 14, not 15.)
    const csv = ['date,vehicle,category,amount', '2024-03-15,Daily Driver,misc,20.00'].join('\n');

    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv });
    const body = await json<ImportResponse>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.imported).toBe(1);

    const [row] = await listExpenses();
    const stored = new Date(row.date);
    expect(stored.getFullYear()).toBe(2024);
    expect(stored.getMonth() + 1).toBe(3);
    expect(stored.getDate()).toBe(15);
  });

  test('an OUT-OF-RANGE date-only cell is REJECTED, not silently rolled forward (#59)', async () => {
    await seedCivic('Daily Driver');
    // `new Date(2024, 12, 45)` ("2024-13-45") never NaNs — it rolls to 2025-02-14. The native parseDate
    // now echo-checks the constructed Y/M/D (the buildLocalDate guard the mapping path had), so an
    // impossible date-only value is rejected with a per-row error instead of importing a wrong date.
    const csv = [
      'date,vehicle,category,amount',
      '2024-13-45,Daily Driver,fuel,40.00', // month 13 + day 45 → would roll to 2025-02-14 pre-fix
      '2024-02-30,Daily Driver,misc,10.00', // Feb 30 → would roll to Mar 1 pre-fix
    ].join('\n');

    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv });
    const body = await json<ImportResponse>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    // Both rows rejected; nothing imported (pre-fix both would import at rolled-forward dates).
    expect(body.data.imported).toBe(0);
    expect(body.data.errorCount).toBe(2);
    expect(
      body.data.rows.every((r) => (r.message ?? '').toLowerCase().includes('invalid date'))
    ).toBe(true);
    expect(await listExpenses()).toHaveLength(0);
  });

  test('a full-ISO timestamp keeps its absolute instant (date-only fix does not regress it)', async () => {
    await seedCivic('Daily Driver');
    // The date-only branch must NOT capture full ISO values — those name an absolute instant and
    // must round-trip unchanged (our own export writes this form). Asserts the instant is preserved.
    const iso = '2024-06-01T13:30:00.000Z';
    const csv = ['date,vehicle,category,amount', `${iso},Daily Driver,misc,12.50`].join('\n');

    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv });
    const body = await json<ImportResponse>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.imported).toBe(1);

    const [row] = await listExpenses();
    expect(new Date(row.date).getTime()).toBe(new Date(iso).getTime());
  });

  test('re-importing the same file is idempotent (no duplicate rows; cycle 211)', async () => {
    await seedCivic('Daily Driver');
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
    await seedCivic('Daily Driver');
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
    expect(body.data.readyCount).toBe(1); // it WOULD import 1

    // ...but the DB is untouched.
    expect((await listExpenses()).length).toBe(0);
  });

  test('reports per-row errors (bad category / amount / date) and imports the good ones', async () => {
    await seedCivic('Daily Driver');
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
    await seedCivic('Daily Driver');
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
    await seedCivic('Daily Driver');
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
    await seedCivic('Daily Driver'); // Honda Civic 2021
    const csv = [
      'date,vehicle,category,amount',
      '2024-06-01T00:00:00.000Z,2021 Honda Civic,misc,15',
    ].join('\n');

    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv });
    const body = await json<ImportResponse>(res);
    expect(res.status).toBe(200);
    expect(body.data.imported).toBe(1);
  });

  test('#102: an AMBIGUOUS "year make model" name (two cars share it) errors, not silent misattribution', async () => {
    // Two vehicles share "2021 Honda Civic" (legal — distinct nicknames, no unique constraint).
    // Pre-C344 the name map resolved to the LAST one (silent misattribution, NORTH_STAR #1). Now
    // the row must FAIL with a clear "use distinct nicknames" message — nothing imported.
    await seedCivic('Work Car'); // 2021 Honda Civic
    await seedCivic('Personal Car'); // 2021 Honda Civic (same year/make/model)
    const csv = [
      'date,vehicle,category,amount',
      '2024-06-01T00:00:00.000Z,2021 Honda Civic,misc,50',
    ].join('\n');

    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv });
    const body = await json<ImportResponse>(res);
    expect(res.status).toBe(200); // the import call itself succeeds; the ROW is rejected
    expect(body.data.imported).toBe(0);
    expect(body.data.errorCount).toBe(1);
    expect(body.data.rows[0]?.message).toContain('more than one vehicle');
  });

  test('#102: a UNIQUE nickname still resolves even when its year/make/model is shared', async () => {
    // The ambiguity is per-NAME-KEY: the shared "2021 Honda Civic" key is ambiguous, but each
    // car's distinct nickname is not — so importing by nickname must still work.
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
    // The export neutralizes CWE-1236 cells by prefixing a leading ' (so a
    // spreadsheet treats `=...` as text). On re-import the importer must STRIP that
    // prefix symmetrically, else `=SUM(A1:A2)` round-trips to `'=SUM(A1:A2)` — silent
    // corruption (cycle 192 fix). Create → export → import → description identical.
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

  // #137 (C448): a NON-fuel imported row that carries a mileage/volume/fuelType (a foreign tracker like
  // Drivvo/Fuelio logs an odometer on a Service/maintenance entry) must NOT persist those fuel-only fields
  // — the import commit (importExpenses) inserts verbatim, bypassing the clearFuelFieldsIfNotFuel guard the
  // POST (#76/C244) + PUT (#130/C434) paths apply. A stray mileage on a non-fuel row poisons
  // getCurrentOdometer's cross-category MAX(odometer) UNION → wrong reminder firing + inflated lease-overage $.
  // parseRow now nulls the fuel-only fields for a non-fuel category (the #76 transform at the import site).
  test('a non-fuel imported row carrying mileage/volume/fuelType stores them NULL (#137, the #76 import write site)', async () => {
    await seedCivic('Daily Driver');
    const csv = [
      'date,vehicle,category,amount,currency,mileage,volume,fuelType,description,tags,missedFillup,createdAt',
      // A maintenance row sneaking an odometer + volume + fuelType (the foreign-tracker / hand-edited case).
      '2024-06-10T00:00:00.000Z,Daily Driver,maintenance,120,USD,120000,5,regular,Oil change,,true,',
    ].join('\n');

    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv });
    const body = await json<ImportResponse>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.imported).toBe(1);

    const row = listExpensesRaw().find((r) => r.category === 'maintenance');
    expect(row, 'the maintenance row imported').toBeTruthy();
    // NON-VACUOUS: pre-fix parseRow returned mileage=120000 verbatim → inserted on a non-fuel row →
    // becomes the vehicle's MAX(odometer) cross-category.
    expect(row?.mileage, 'a stray mileage on a non-fuel import row must not persist').toBeNull();
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
