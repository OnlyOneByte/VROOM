/**
 * Data-recovery guards for the JSON cells of a backup CSV.
 *
 * Two distinct hazards, two distinct answers:
 *
 *  1. A cell that does NOT parse as JSON carries no recoverable information. coerceRow used to assign
 *     `null`, which violates NOT NULL on the two defaulted JSON columns (vehicles.unit_preferences,
 *     user_preferences.unit_preferences) — and because restore wipes and re-inserts inside ONE
 *     transaction, that single bad cell rolled back the WHOLE restore: the user recovered nothing from
 *     an otherwise-valid backup, with a bare 500. The column default is the only answer that keeps the
 *     rest of the backup, so coerceRow now resolves it like every other type does.
 *
 *  2. A cell that DOES parse but is not a valid value for the column carries user intent we must not
 *     silently overwrite — `{"distanceUnit":"mi"}` means miles, and defaulting it would leave the
 *     vehicle's raw volume/mileage numbers interpreted under the wrong units. It also used to be
 *     inserted verbatim by a restore that reported success, after which every unit-reading analytics
 *     surface failed (getAllVehicleUnits throws on unparseable prefs by design). Validation now
 *     refuses the backup up front, naming the table, the column and the row, so nothing is touched and
 *     the user can fix the one cell.
 *
 * createTestApp() rewrites env then dynamic-imports DB-bound modules, so import backup/restore
 * dynamically AFTER createTestApp.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import AdmZip from 'adm-zip';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

/**
 * Rewrite one column of every row of one CSV inside a REAL exported backup ZIP, leaving the archive
 * otherwise byte-identical in structure. The raw text is written through the same csv-stringify
 * settings the exporter uses, so the restore path sees exactly the cell a hand-edit or a Sheets
 * round-trip would have produced.
 */
function patchColumn(zipBuffer: Buffer, filename: string, column: string, rawCell: string): Buffer {
  const zip = new AdmZip(zipBuffer);
  const entry = zip.getEntry(filename);
  if (!entry) throw new Error(`${filename} missing from the exported backup`);
  const csv = entry.getData().toString('utf-8');
  const rows = parse(csv, { columns: true, skip_empty_lines: true }) as Record<string, string>[];
  expect(rows.length, `${filename} has rows to patch`).toBeGreaterThan(0);
  const columns = Object.keys(rows[0]);
  expect(columns, `${filename} has a ${column} column`).toContain(column);
  for (const row of rows) row[column] = rawCell;
  zip.updateFile(
    entry,
    Buffer.from(stringify(rows, { header: true, columns, quoted: true }), 'utf-8')
  );
  return zip.toBuffer();
}

function vehiclePrefsCell(vehicleId: string): string {
  const row = ctx.sqlite
    .query('SELECT unit_preferences FROM vehicles WHERE id = ?')
    .get(vehicleId) as { unit_preferences: string } | null;
  if (!row) throw new Error(`vehicle ${vehicleId} not found`);
  return row.unit_preferences;
}

function expenseCount(): number {
  const row = ctx.sqlite.query('SELECT COUNT(*) AS n FROM expenses').get() as { n: number };
  return row.n;
}

/** Seed one vehicle with one expense and return the ids plus a real exported ZIP. */
async function seedAndExport(): Promise<{ vehicleId: string; zip: Buffer }> {
  const vehicleId = await seedVehicle(ctx, {
    make: 'Volvo',
    model: 'V60',
    year: 2020,
    extra: {
      unitPreferences: { distanceUnit: 'kilometers', volumeUnit: 'liters', chargeUnit: 'kwh' },
    },
  });
  ctx.sqlite.run(
    `INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount, missed_fillup)
     VALUES ('exp-json-cell', ?, ?, 'fuel', 1700000000, 5500, 0)`,
    [vehicleId, ctx.user.id]
  );
  const { backupService } = await import('../backup');
  return { vehicleId, zip: await backupService.exportAsZip(ctx.user.id) };
}

describe('a backup whose unit_preferences cell is not valid JSON', () => {
  test('restores the rest of the backup, resolving the unparseable cell to the column default', async () => {
    const { vehicleId, zip } = await seedAndExport();
    const { restoreService } = await import('../restore');
    const { DEFAULT_UNIT_PREFERENCES, parseUnitPreferences } = await import('../../../types');

    // A truncated JSON object — what a clipped download or a hand-edit leaves behind.
    const broken = patchColumn(
      zip,
      'vehicles.csv',
      'unitPreferences',
      '{"distanceUnit":"kilometers"'
    );

    const result = await restoreService.restoreFromBackup(ctx.user.id, broken, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);

    expect(expenseCount(), 'the unrelated expense was recovered, not discarded').toBe(1);
    const prefs = parseUnitPreferences(JSON.parse(vehiclePrefsCell(vehicleId)));
    expect(prefs, 'the unparseable cell landed as a VALID prefs object').not.toBeNull();
    expect(prefs).toEqual(DEFAULT_UNIT_PREFERENCES);
  });
});

describe('a backup whose unit_preferences cell parses but is not valid unit preferences', () => {
  test('is refused with an error naming the table, column and row — and nothing is touched', async () => {
    const { vehicleId, zip } = await seedAndExport();
    const { restoreService } = await import('../restore');
    const { parseUnitPreferences } = await import('../../../types');
    const goodPrefsBefore = vehiclePrefsCell(vehicleId);

    // Short unit spellings: valid JSON, wrong vocabulary — what a hand-written or third-party export
    // produces.
    const badShape = patchColumn(
      zip,
      'vehicles.csv',
      'unitPreferences',
      '{"distanceUnit":"mi","volumeUnit":"gal","chargeUnit":"kWh"}'
    );

    const outcome = await restoreService
      .restoreFromBackup(ctx.user.id, badShape, 'replace')
      .then((result) => ({ rejected: false, detail: JSON.stringify(result) }))
      .catch((error: unknown) => ({
        rejected: true,
        detail: `${error instanceof Error ? error.message : String(error)} ${JSON.stringify(
          (error as { details?: unknown }).details ?? []
        )}`,
      }));

    expect(outcome.rejected, `restore accepted the invalid backup: ${outcome.detail}`).toBe(true);
    const message = outcome.detail;
    expect(message).toContain('vehicles');
    expect(message).toContain('unitPreferences');
    expect(message, 'the offending row is named').toContain(vehicleId);

    // Refused BEFORE the replace-mode wipe: the account is exactly as it was.
    expect(vehiclePrefsCell(vehicleId), 'the stored prefs are untouched').toBe(goodPrefsBefore);
    expect(expenseCount(), 'the existing expense is untouched').toBe(1);
    expect(
      parseUnitPreferences(JSON.parse(vehiclePrefsCell(vehicleId))),
      'every stored vehicle still has prefs the analytics layer can read'
    ).not.toBeNull();

    // The user-visible consequence of the old behaviour: a "successful" restore left every
    // unit-reading analytics surface broken. It still works.
    const stats = await ctx.authed(
      'GET',
      '/api/v1/analytics/fuel-stats?startDate=1600000000000&endDate=1800000000000'
    );
    expect(stats.status, await stats.text()).toBe(200);

    // Parity with the write path, which is the whole point: the API already refuses this value, so the
    // recovery path was the one way such a row could get in.
    const write = await ctx.authed('PUT', `/api/v1/vehicles/${vehicleId}`, {
      unitPreferences: { distanceUnit: 'mi', volumeUnit: 'gal', chargeUnit: 'kWh' },
    });
    expect(write.status, await write.text()).toBe(400);
  });
});
