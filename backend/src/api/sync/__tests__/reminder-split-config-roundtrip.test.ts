/**
 * TRUE backup → restore round-trip for a reminder's `expenseSplitConfig` — the worst-case
 * NESTED-OBJECT JSON column (C264 deep-review of the backup EXPORT path).
 *
 * Why this slice specifically: the export/restore TABLE-SET symmetry is airtight — five
 * hand-maintained lists (createBackup keys, TABLE_SCHEMA_MAP, TABLE_FILENAME_MAP, restore
 * insert() calls, ImportSummary fields) are all pinned equal by the C208/C209 drift guards,
 * including the exact `if (table && filename)` silent-skip. What those KEY guards do NOT cover is
 * the per-column VALUE round-trip through convertToCSV's `JSON.stringify(value)` (backup.ts:458)
 * → the real csv-stringify (quoted:true) → csv-parse → coerceRow's `JSON.parse` (the JSON_TYPES
 * branch). Existing coerceRow tests pin the PARSE direction in isolation on hand-built rows
 * (flat unitPreferences object, string[] tags) — but nothing exercises the FULL serialize→parse
 * pipe for a NESTED object whose JSON body contains the CSV-hostile metacharacters (`,` between
 * allocations, `"` around every key) that the CSV layer must double-quote and the parser must
 * unwrap losslessly. expenseSplitConfig (a ReminderSplitConfig: { method, allocations:[{...}] })
 * is the deepest such column in the schema — if any layer mangled it, a user's multi-vehicle
 * recurring-cost split would silently corrupt on restore (NORTH_STAR #1, no silent loss).
 *
 * createTestApp() rewrites process.env then dynamic-imports DB-bound modules, so keep static
 * imports to the harness + bun:test; import backup/restore dynamically AFTER createTestApp.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

interface ReminderRow {
  id: string;
  expense_split_config: string | null;
}

function reminderRows(): ReminderRow[] {
  return ctx.sqlite.query('SELECT id, expense_split_config FROM reminders').all() as ReminderRow[];
}

describe('backup → restore round-trip preserves a reminder expenseSplitConfig (nested JSON)', () => {
  test('a multi-vehicle absolute split config survives export + restore byte-for-byte', async () => {
    const vehA = await seedVehicle(ctx, { make: 'Toyota', model: 'M', year: 2022 });
    const vehB = await seedVehicle(ctx, { make: 'Honda', model: 'M', year: 2022 });

    // A two-vehicle ABSOLUTE split — allocations is an array of objects, so its JSON body carries
    // the commas + quotes that stress the CSV quote-escaping. Amounts (DOLLARS sent) sum to expenseAmount.
    const splitConfig = {
      method: 'absolute' as const,
      allocations: [
        { vehicleId: vehA, amount: 70 },
        { vehicleId: vehB, amount: 50 },
      ],
    };
    // money-cents-migration: the reminder's expenseSplitConfig allocation amounts are dollars→cents at the
    // input edge (splitConfigSchema's absoluteAllocationSchema.transform), so the PERSISTED blob holds cents.
    // The round-trip must preserve THAT (cents) blob byte-for-byte through CSV export+restore.
    const storedConfig = {
      method: 'absolute' as const,
      allocations: [
        { vehicleId: vehA, amount: 7000 },
        { vehicleId: vehB, amount: 5000 },
      ],
    };

    const created = await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Shared registration',
      type: 'expense',
      frequency: 'yearly',
      startDate: '2024-01-01T00:00:00.000Z',
      vehicleIds: [vehA, vehB],
      expenseCategory: 'regulatory',
      expenseAmount: 120,
      expenseSplitConfig: splitConfig,
    });
    expect(created.status, await created.text()).toBe(201);

    // Pre-condition: the config persisted as a real nested object (not stringified-twice / null), in cents.
    const before = reminderRows();
    expect(before).toHaveLength(1);
    const reminderId = before[0].id; // shape-independent: read the persisted row's id.
    expect(JSON.parse(before[0].expense_split_config ?? 'null')).toEqual(storedConfig);

    // Real export (CSV serialize, JSON.stringify the object) → real restore (CSV parse, coerceRow
    // JSON.parse). Import the singletons dynamically so they bind to the harness DB.
    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');

    const zip = await backupService.exportAsZip(ctx.user.id);
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');

    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(result.imported?.reminders, 'restore summary counts the reminder').toBe(1);

    // The reminder survived once, and its nested split config is structurally identical — every
    // allocation vehicleId + amount intact, not mangled into a string / truncated / re-ordered loss.
    const after = reminderRows();
    expect(after, 'exactly one reminder after restore (no dup, no loss)').toHaveLength(1);
    expect(after[0].id).toBe(reminderId);
    const restored = JSON.parse(after[0].expense_split_config ?? 'null');
    expect(restored, 'nested expenseSplitConfig round-trips intact through CSV').toEqual(
      storedConfig
    );
  });

  test('an EVEN split config (nested vehicleIds array) also round-trips intact', async () => {
    const vehA = await seedVehicle(ctx, { make: 'Toyota', model: 'M', year: 2022 });
    const vehB = await seedVehicle(ctx, { make: 'Honda', model: 'M', year: 2022 });

    const splitConfig = { method: 'even' as const, vehicleIds: [vehA, vehB] };

    const created = await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Shared wash',
      type: 'expense',
      frequency: 'monthly',
      startDate: '2024-01-01T00:00:00.000Z',
      vehicleIds: [vehA, vehB],
      expenseCategory: 'maintenance',
      expenseAmount: 40,
      expenseSplitConfig: splitConfig,
    });
    expect(created.status, await created.text()).toBe(201);

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const zip = await backupService.exportAsZip(ctx.user.id);
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');

    expect(result.success, JSON.stringify(result)).toBe(true);
    const rows = reminderRows();
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].expense_split_config ?? 'null')).toEqual(splitConfig);
  });
});
