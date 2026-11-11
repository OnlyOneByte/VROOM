// A reminder's nested expenseSplitConfig JSON must survive backup and restore byte-for-byte. Nested
// objects with commas and quotes stress the CSV quoting on both the write and read paths.

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

    // Two-vehicle absolute split: its JSON body carries the commas and quotes.
    const splitConfig = {
      method: 'absolute' as const,
      allocations: [
        { vehicleId: vehA, amount: 70 },
        { vehicleId: vehB, amount: 50 },
      ],
    };
    // Allocation amounts are stored as cents, and the round-trip must preserve that blob.
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

    const before = reminderRows();
    expect(before).toHaveLength(1);
    const reminderId = before[0].id; // shape-independent: read the persisted row's id.
    expect(JSON.parse(before[0].expense_split_config ?? 'null')).toEqual(storedConfig);

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');

    const zip = await backupService.exportAsZip(ctx.user.id);
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');

    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(result.imported?.reminders, 'restore summary counts the reminder').toBe(1);

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
