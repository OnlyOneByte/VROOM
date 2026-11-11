// Two JSON-cell hazards. An unparseable unit_preferences cell resolves to the column default, so the
// rest of the restore survives. A parseable but invalid one refuses the restore, because defaulting it
// would reinterpret the vehicle's raw distances and volumes under the wrong units.

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

/** Rewrites one column of every row in a real backup ZIP, using the exporter's CSV settings. */
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

    // Valid JSON with unrecognized unit spellings.
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

    // Refused before the wipe, so the account is unchanged.
    expect(vehiclePrefsCell(vehicleId), 'the stored prefs are untouched').toBe(goodPrefsBefore);
    expect(expenseCount(), 'the existing expense is untouched').toBe(1);
    expect(
      parseUnitPreferences(JSON.parse(vehiclePrefsCell(vehicleId))),
      'every stored vehicle still has prefs the analytics layer can read'
    ).not.toBeNull();

    const stats = await ctx.authed(
      'GET',
      '/api/v1/analytics/fuel-stats?startDate=1600000000000&endDate=1800000000000'
    );
    expect(stats.status, await stats.text()).toBe(200);

    // The write route refuses this value, so the restore must refuse it too.
    const write = await ctx.authed('PUT', `/api/v1/vehicles/${vehicleId}`, {
      unitPreferences: { distanceUnit: 'mi', volumeUnit: 'gal', chargeUnit: 'kWh' },
    });
    expect(write.status, await write.text()).toBe(400);
  });
});
