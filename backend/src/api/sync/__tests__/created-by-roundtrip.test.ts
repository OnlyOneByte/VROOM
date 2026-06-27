/**
 * TRUE backup → restore round-trip for `expenses.created_by` (the vehicle-sharing T5b owner-stamp
 * PROVENANCE column, migration 0011). Data-safety quality bar #1: no silent loss — NORTH_STAR #1
 * names backup/restore round-tripping every column as sacred, and this column is load-bearing for the
 * whole shared-write model: `user_id` = the vehicle OWNER (whose books the row rides), `created_by` =
 * who physically entered it (an editor, on a shared row; NULL = legacy/self).
 *
 * The CSV backup is schema-derived (createBackup selects via the table; coerceRow walks getTableColumns),
 * so created_by is *supposed* to ride along automatically — but the coerceRow boundary is exactly where a
 * nullable text column silently drops or mangles (the C3 clientId / maintenance-fields class): a NULL
 * created_by must come back NULL (not "" or 0), and a populated one must survive byte-for-byte. Nothing
 * proved an editor-authored shared expense keeps its authorship across a backup cycle. This does — and it
 * is a merge-surviving lock: it fails the moment created_by is dropped from the serialize or restore path.
 *
 * createTestApp() rewrites env then dynamic-imports DB-bound modules, so import backup/restore + schema
 * dynamically AFTER createTestApp.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

interface ExpenseRowDb {
  id: string;
  user_id: string;
  created_by: string | null;
  expense_amount: number;
}

function expenseRow(id: string): ExpenseRowDb {
  return ctx.sqlite
    .query('SELECT id, user_id, created_by, expense_amount FROM expenses WHERE id = ?')
    .get(id) as ExpenseRowDb;
}

async function roundTrip(): Promise<void> {
  const { backupService } = await import('../backup');
  const { restoreService } = await import('../restore');
  const zip = await backupService.exportAsZip(ctx.user.id);
  const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
  expect(result.success, JSON.stringify(result)).toBe(true);
}

describe('backup → restore round-trip preserves expenses.created_by (T5b provenance)', () => {
  test('an editor-authored shared expense keeps userId=OWNER AND created_by=editor across the round-trip', async () => {
    // The seeded harness user is the OWNER. Seed a SECOND user (the editor/author) so created_by points
    // at a real, distinct id — the owner-stamp shape (user_id = owner, created_by = the editor).
    const { db } = await import('../../../db/connection');
    const schema = await import('../../../db/schema');
    const editorId = 'editor-author-rt';
    await db
      .insert(schema.users)
      .values({ id: editorId, email: 'editor-rt@test.com', displayName: 'Editor RT' });

    const vehicleId = await seedVehicle(ctx, { make: 'Subaru', model: 'Outback', year: 2022 });

    // A shared-created expense: owner-stamped user_id, created_by = the editor. Seed directly (the
    // route would require a real accepted share; this test isolates the BACKUP column, not the gate).
    ctx.sqlite.run(
      `INSERT INTO expenses (id, vehicle_id, category, date, expense_amount, user_id, created_by, missed_fillup)
       VALUES ('exp-shared-rt', ?, 'maintenance', 1700000000, 4200, ?, ?, 0)`,
      [vehicleId, ctx.user.id, editorId]
    );

    await roundTrip();

    const r = expenseRow('exp-shared-rt');
    expect(r, 'the shared expense survived the round-trip').toBeTruthy();
    expect(r.user_id, 'userId stays the OWNER (rides the owner backup)').toBe(ctx.user.id);
    expect(r.created_by, 'created_by (the editor author) survives byte-for-byte').toBe(editorId);
    expect(r.expense_amount, 'money cents intact alongside the provenance column').toBe(4200);
  });

  test('an owner-self expense keeps created_by NULL (not coerced to empty string or 0)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });

    // The normal owner-self create path leaves created_by NULL (the legacy/self sentinel). Create via
    // the REAL route so this pins the actual production shape, then assert the NULL survives.
    const res = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 15,
      date: '2024-06-01T00:00:00.000Z',
    });
    const created = (await res.json()) as { data: { id: string } };
    expect(res.status, JSON.stringify(created)).toBe(201);
    const id = created.data.id;
    expect(expenseRow(id).created_by, 'owner-self create is NULL before backup').toBeNull();

    await roundTrip();

    const r = expenseRow(id);
    expect(r, 'the owner-self expense survived the round-trip').toBeTruthy();
    expect(r.user_id).toBe(ctx.user.id);
    expect(r.created_by, 'a NULL created_by stays NULL (not "" or 0) through coerceRow').toBeNull();
  });
});
