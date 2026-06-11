/**
 * Data-safety regression (NORTH_STAR #1: no silent loss) for bug #21.
 *
 * Replace-mode restore deletes ALL of the user's data, then inserts the backup. `validateBackupData`
 * only checks metadata + per-row schema + referential integrity — so an empty-but-VALID backup (every
 * data array empty, e.g. a truncated/corrupt download) passes validation clean. Pre-fix, a replace
 * restore of that backup ran `deleteUserData` (wiped everything) then `insertBackupData` (every
 * `.length > 0` guard false → inserted nothing), atomically committing the empty state: a silent TOTAL
 * wipe. The fix (`assertReplaceNotEmpty`) rejects a replace whose payload carries zero rows.
 *
 * Repro shape: export a ZIP from the still-EMPTY harness user (a valid 0-row backup), THEN seed a
 * vehicle (the data a wipe would destroy), THEN replace-restore the empty backup. Post-fix it throws
 * and the vehicle survives; pre-fix the vehicle vanished. Preview + merge are unaffected (they never
 * delete) — pinned as controls so the guard is provably replace-only.
 *
 * createTestApp() rewrites env then dynamic-imports DB-bound modules; keep static imports to the
 * harness + bun:test and import backup/restore dynamically AFTER createTestApp so DB-bound singletons
 * bind to the throwaway DB.
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

interface VehicleRowDb {
  id: string;
  make: string;
}

function vehicleRows(): VehicleRowDb[] {
  return ctx.sqlite.query('SELECT id, make FROM vehicles').all() as VehicleRowDb[];
}

async function seedVehicle(make: string): Promise<string> {
  const created = await ctx.authed('POST', '/api/v1/vehicles', { make, model: 'X', year: 2021 });
  const body = await json<DataEnvelope<{ id: string }>>(created);
  expect(created.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

describe('restore refuses an empty-backup replace (bug #21 silent total-wipe guard)', () => {
  test('replace with a 0-row backup throws and leaves existing data intact', async () => {
    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');

    // Export BEFORE seeding → a valid backup whose every data array is empty (metadata.userId is
    // ours, version is current, so validateBackupData passes — the exact empty-but-valid condition).
    const emptyZip = await backupService.exportAsZip(ctx.user.id);

    // Now seed real data — this is what a silent wipe would destroy.
    const vehicleId = await seedVehicle('Honda');
    expect(vehicleRows()).toHaveLength(1);

    // Pre-fix: this resolved success:true and wiped the vehicle. Post-fix: it throws.
    await expect(
      restoreService.restoreFromBackup(ctx.user.id, emptyZip, 'replace')
    ).rejects.toThrow(/empty backup/i);

    // The load-bearing assertion: the user's data is STILL THERE (the delete never ran — the guard
    // fires before the transaction).
    const rows = vehicleRows();
    expect(rows, 'existing data must survive a rejected empty replace').toHaveLength(1);
    expect(rows[0].id).toBe(vehicleId);
    expect(rows[0].make).toBe('Honda');
  });

  test('preview of an empty backup is unaffected (read-only, returns the 0-row summary)', async () => {
    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const emptyZip = await backupService.exportAsZip(ctx.user.id);
    await seedVehicle('Toyota');

    const result = await restoreService.restoreFromBackup(ctx.user.id, emptyZip, 'preview');
    expect(result.success).toBe(true);
    expect(result.preview?.vehicles).toBe(0);
    // Preview never touches data.
    expect(vehicleRows()).toHaveLength(1);
  });

  test('merge of an empty backup is unaffected (never deletes; nothing to insert)', async () => {
    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const emptyZip = await backupService.exportAsZip(ctx.user.id);
    const vehicleId = await seedVehicle('Mazda');

    const result = await restoreService.restoreFromBackup(ctx.user.id, emptyZip, 'merge');
    expect(result.success).toBe(true);
    // Merge keeps existing rows and inserts nothing from the empty backup.
    const rows = vehicleRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(vehicleId);
  });

  test('a NON-empty backup still replaces normally (guard is not over-broad)', async () => {
    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');

    // Seed, then export a backup that DOES carry a row.
    const vehicleId = await seedVehicle('Subaru');
    const fullZip = await backupService.exportAsZip(ctx.user.id);

    const result = await restoreService.restoreFromBackup(ctx.user.id, fullZip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);
    const rows = vehicleRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(vehicleId);
    expect(rows[0].make).toBe('Subaru');
  });
});
