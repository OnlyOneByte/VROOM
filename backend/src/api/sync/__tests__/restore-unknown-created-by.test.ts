import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import AdmZip from 'adm-zip';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

interface ExpenseRow {
  id: string;
  user_id: string;
  created_by: string | null;
  expense_amount: number;
}

async function expenseRow(id: string): Promise<ExpenseRow | null> {
  return (await ctx.sql.get(
    'SELECT id, user_id, created_by, expense_amount FROM expenses WHERE id = ?',
    [id]
  )) as ExpenseRow | null;
}

describe('restore of a backup whose created_by names a user absent from this instance', () => {
  test('restores every row, dropping only the unknown provenance to NULL', async () => {
    const db = (await import('../../../app-context')).appContext().asyncDb;
    const schema = await import('../../../db/schema');
    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');

    const editorId = 'editor-on-the-old-instance';
    await db
      .insert(schema.users)
      .values({ id: editorId, email: 'editor-gone@test.com', displayName: 'Editor Gone' });

    const vehicleId = await seedVehicle(ctx, { make: 'Mazda', model: 'CX-5', year: 2019 });
    await ctx.sql.run(
      `INSERT INTO expenses (id, vehicle_id, user_id, created_by, category, date, expense_amount, missed_fillup)
       VALUES ('exp-editor-authored', ?, ?, ?, 'maintenance', 1700000000, 8800, FALSE)`,
      [vehicleId, ctx.user.id, editorId]
    );
    await ctx.sql.run(
      `INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount, missed_fillup)
       VALUES ('exp-owner-authored', ?, ?, 'fuel', 1700000100, 4400, FALSE)`,
      [vehicleId, ctx.user.id]
    );

    const zip = new AdmZip(await backupService.exportAsZip(ctx.user.id));
    const entry = zip.getEntry('expenses.csv');
    if (!entry) throw new Error('expenses.csv missing from the exported backup');
    const csv = entry.getData().toString('utf-8');
    expect(csv, 'the export carries the author column').toContain(editorId);
    zip.updateFile(entry, Buffer.from(csv.replaceAll(editorId, 'editor-never-on-this-instance')));
    const foreignBackup = zip.toBuffer();

    const result = await restoreService.restoreFromBackup(ctx.user.id, foreignBackup, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);

    const authored = await expenseRow('exp-editor-authored');
    expect(authored, 'the editor-authored expense was recovered').toBeTruthy();
    expect(authored?.user_id, 'ownership (whose books the cost rides) is unchanged').toBe(
      ctx.user.id
    );
    expect(authored?.expense_amount, 'the money column rode through untouched').toBe(8800);
    expect(authored?.created_by, 'the absent author drops to the NULL sentinel').toBeNull();

    const own = await expenseRow('exp-owner-authored');
    expect(own, 'the owner-authored expense was recovered too').toBeTruthy();
    expect(own?.created_by).toBeNull();
  });

  test('a created_by naming a current member of the car still round-trips byte-for-byte', async () => {
    const db = (await import('../../../app-context')).appContext().asyncDb;
    const schema = await import('../../../db/schema');
    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');

    const editorId = 'editor-still-here';
    await db
      .insert(schema.users)
      .values({ id: editorId, email: 'editor-here@test.com', displayName: 'Editor Here' });

    const vehicleId = await seedVehicle(ctx, { make: 'Kia', model: 'Niro', year: 2023 });
    await ctx.sql.run(
      "INSERT INTO vehicle_shares (id, vehicle_id, owner_id, shared_with_id, level, status) VALUES (?, ?, ?, ?, 'editor', 'accepted')",
      [`share-${editorId}`, vehicleId, ctx.user.id, editorId]
    );
    await ctx.sql.run(
      `INSERT INTO expenses (id, vehicle_id, user_id, created_by, category, date, expense_amount, missed_fillup)
       VALUES ('exp-kept-provenance', ?, ?, ?, 'maintenance', 1700000000, 1234, FALSE)`,
      [vehicleId, ctx.user.id, editorId]
    );

    const zip = await backupService.exportAsZip(ctx.user.id);
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);

    expect((await expenseRow('exp-kept-provenance'))?.created_by, 'a member author is kept').toBe(
      editorId
    );
  });
});
