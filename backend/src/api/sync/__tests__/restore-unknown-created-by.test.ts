// A backup restored onto another instance must not fail on an expenses.created_by that names a user
// absent here. Such an author is dropped to NULL, and the rest of the row is kept.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import AdmZip from 'adm-zip';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

interface ExpenseRow {
  id: string;
  user_id: string;
  created_by: string | null;
  expense_amount: number;
}

function expenseRow(id: string): ExpenseRow | null {
  return ctx.sqlite
    .query('SELECT id, user_id, created_by, expense_amount FROM expenses WHERE id = ?')
    .get(id) as ExpenseRow | null;
}

describe('restore of a backup whose created_by names a user absent from this instance', () => {
  test('restores every row, dropping only the unknown provenance to NULL', async () => {
    const { db } = await import('../../../db/connection');
    const schema = await import('../../../db/schema');
    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');

    // The harness user is the fleet OWNER; a second user is the editor who authored one row.
    const editorId = 'editor-on-the-old-instance';
    await db
      .insert(schema.users)
      .values({ id: editorId, email: 'editor-gone@test.com', displayName: 'Editor Gone' });

    const vehicleId = await seedVehicle(ctx, { make: 'Mazda', model: 'CX-5', year: 2019 });
    ctx.sqlite.run(
      `INSERT INTO expenses (id, vehicle_id, user_id, created_by, category, date, expense_amount, missed_fillup)
       VALUES ('exp-editor-authored', ?, ?, ?, 'maintenance', 1700000000, 8800, 0)`,
      [vehicleId, ctx.user.id, editorId]
    );
    ctx.sqlite.run(
      `INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount, missed_fillup)
       VALUES ('exp-owner-authored', ?, ?, 'fuel', 1700000100, 4400, 0)`,
      [vehicleId, ctx.user.id]
    );

    // The author id is one this instance never issued, as in a backup from another instance.
    const zip = new AdmZip(await backupService.exportAsZip(ctx.user.id));
    const entry = zip.getEntry('expenses.csv');
    if (!entry) throw new Error('expenses.csv missing from the exported backup');
    const csv = entry.getData().toString('utf-8');
    expect(csv, 'the export carries the author column').toContain(editorId);
    zip.updateFile(entry, Buffer.from(csv.replaceAll(editorId, 'editor-never-on-this-instance')));
    const foreignBackup = zip.toBuffer();

    const result = await restoreService.restoreFromBackup(ctx.user.id, foreignBackup, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);

    const authored = expenseRow('exp-editor-authored');
    expect(authored, 'the editor-authored expense was recovered').toBeTruthy();
    expect(authored?.user_id, 'ownership (whose books the cost rides) is unchanged').toBe(
      ctx.user.id
    );
    expect(authored?.expense_amount, 'the money column rode through untouched').toBe(8800);
    expect(authored?.created_by, 'the absent author drops to the NULL sentinel').toBeNull();

    const own = expenseRow('exp-owner-authored');
    expect(own, 'the owner-authored expense was recovered too').toBeTruthy();
    expect(own?.created_by).toBeNull();
  });

  test('a created_by that DOES exist on this instance still round-trips byte-for-byte', async () => {
    const { db } = await import('../../../db/connection');
    const schema = await import('../../../db/schema');
    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');

    const editorId = 'editor-still-here';
    await db
      .insert(schema.users)
      .values({ id: editorId, email: 'editor-here@test.com', displayName: 'Editor Here' });

    const vehicleId = await seedVehicle(ctx, { make: 'Kia', model: 'Niro', year: 2023 });
    ctx.sqlite.run(
      `INSERT INTO expenses (id, vehicle_id, user_id, created_by, category, date, expense_amount, missed_fillup)
       VALUES ('exp-kept-provenance', ?, ?, ?, 'maintenance', 1700000000, 1234, 0)`,
      [vehicleId, ctx.user.id, editorId]
    );

    const zip = await backupService.exportAsZip(ctx.user.id);
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);

    expect(
      expenseRow('exp-kept-provenance')?.created_by,
      'a known author is NOT dropped — the filter must be absence-only'
    ).toBe(editorId);
  });
});
