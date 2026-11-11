// A large backup must restore. A multi-row INSERT is capped by SQLite's bind-parameter limit, so
// inserts are batched. These tests run row counts past that cap for the expenses and reminders tables.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

/** Rows over the 22-column expenses cap (floor(65535 / 22) = 2978). */
const EXPENSES_OVER_CAP = 3000;
/** Rows over the 25-column reminders cap (floor(65535 / 25) = 2621) — the widest backed-up table. */
const REMINDERS_OVER_CAP = 2700;

function countOf(table: string): number {
  const row = ctx.sqlite.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return row.n;
}

async function roundTripReplace(): Promise<void> {
  const { backupService } = await import('../backup');
  const { restoreService } = await import('../restore');
  const zip = await backupService.exportAsZip(ctx.user.id);
  const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
  expect(result.success, JSON.stringify(result)).toBe(true);
}

describe('restore of a backup larger than one statement can bind', () => {
  test(`${EXPENSES_OVER_CAP} expenses round-trip through export → replace-restore`, async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Corolla', year: 2014 });

    const insert = ctx.sqlite.prepare(
      `INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount, missed_fillup)
       VALUES (?, ?, ?, 'fuel', ?, ?, 0)`
    );
    ctx.sqlite.run('BEGIN');
    for (let i = 0; i < EXPENSES_OVER_CAP; i++) {
      insert.run(`exp-cap-${i}`, vehicleId, ctx.user.id, 1_600_000_000 + i * 60, 4000 + i);
    }
    ctx.sqlite.run('COMMIT');
    expect(countOf('expenses')).toBe(EXPENSES_OVER_CAP);

    await roundTripReplace();

    expect(countOf('expenses'), 'every expense came back').toBe(EXPENSES_OVER_CAP);
    // Spot-checks first, middle and last rows, so a batching bug cannot pass on the count alone.
    for (const i of [0, Math.floor(EXPENSES_OVER_CAP / 2), EXPENSES_OVER_CAP - 1]) {
      const row = ctx.sqlite
        .query('SELECT expense_amount FROM expenses WHERE id = ?')
        .get(`exp-cap-${i}`) as { expense_amount: number } | null;
      expect(row, `expense ${i} survived`).toBeTruthy();
      expect(row?.expense_amount).toBe(4000 + i);
    }
  });

  test(`${REMINDERS_OVER_CAP} reminders (the widest table) round-trip through export → replace-restore`, async () => {
    const insert = ctx.sqlite.prepare(
      `INSERT INTO reminders (id, user_id, name, type, frequency, start_date, is_active)
       VALUES (?, ?, ?, 'notification', 'monthly', 1600000000, 1)`
    );
    ctx.sqlite.run('BEGIN');
    for (let i = 0; i < REMINDERS_OVER_CAP; i++) {
      insert.run(`rem-cap-${i}`, ctx.user.id, `Reminder ${i}`);
    }
    ctx.sqlite.run('COMMIT');
    expect(countOf('reminders')).toBe(REMINDERS_OVER_CAP);

    await roundTripReplace();

    expect(countOf('reminders'), 'every reminder came back').toBe(REMINDERS_OVER_CAP);
    const last = ctx.sqlite
      .query('SELECT name FROM reminders WHERE id = ?')
      .get(`rem-cap-${REMINDERS_OVER_CAP - 1}`) as { name: string } | null;
    expect(last?.name).toBe(`Reminder ${REMINDERS_OVER_CAP - 1}`);
  });

  test('merge mode reports EVERY colliding row, across batch boundaries', async () => {
    // Merge probes are batched too. A row count that is not a multiple of the batch size exercises
    // a short final batch.
    const collidingRows = 1001;
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Fit', year: 2016 });
    const insert = ctx.sqlite.prepare(
      `INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount, missed_fillup)
       VALUES (?, ?, ?, 'fuel', ?, 2500, 0)`
    );
    ctx.sqlite.run('BEGIN');
    for (let i = 0; i < collidingRows; i++) {
      insert.run(`exp-merge-${i}`, vehicleId, ctx.user.id, 1_600_000_000 + i * 60);
    }
    ctx.sqlite.run('COMMIT');

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    // Re-importing a backup over the data it came from: every id collides.
    const zip = await backupService.exportAsZip(ctx.user.id);
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'merge');

    expect(result.success, 'a colliding merge is reported, not inserted').toBe(false);
    const expenseConflicts = (result.conflicts ?? []).filter((c) => c.table === 'expenses');
    expect(expenseConflicts.length, 'every colliding expense is reported exactly once').toBe(
      collidingRows
    );
    expect(new Set(expenseConflicts.map((c) => c.id)).size).toBe(collidingRows);
  });
});
