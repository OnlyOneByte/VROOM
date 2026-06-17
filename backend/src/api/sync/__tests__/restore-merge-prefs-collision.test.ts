/**
 * Characterization (C300 deep-review): merge-mode restore + the un-probed userPreferences/syncState
 * primary-key collision.
 *
 * `detectConflicts` probes only 6 tables (vehicles, expenses, vehicle_financing, insurance_policies,
 * photos, photo_refs), but `insertBackupData` inserts into 15 — including userPreferences and syncState,
 * whose PRIMARY KEY is `userId`. The importer ALWAYS already has a userPreferences row (restoreFromSheets
 * calls getOrCreate; the app creates one on first use), and a backup ALWAYS carries the creator's prefs
 * row. So a MERGE restore whose probed tables DON'T collide (e.g. importing data into an account with only
 * default prefs and no overlapping vehicle/expense ids) slips past conflict detection, then hits the raw
 * `insert(userPreferences)` with the existing PK → a UNIQUE/PK constraint violation that throws and rolls
 * back the WHOLE restore. The merge never completes and the user gets a DB error, not a clean conflict
 * report (NORTH_STAR #1 — restore must be predictable).
 *
 * FIX (C300): detectConflicts now probes userPreferences + syncState (PK = userId) like any other owned
 * table, so the collision is reported as a normal merge conflict instead of throwing a raw SQLite
 * UNIQUE-constraint error from insertBackupData. This test was RED before the fix (threw "UNIQUE constraint
 * failed: user_preferences.user_id") and is GREEN after. createTestApp rewrites env + dynamic-imports
 * DB-bound modules.
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

async function createVehicle(make: string): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/vehicles', { make, model: 'X', year: 2021 });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

describe('restore merge: userPreferences PK collision is detected as a conflict, not a raw DB throw (C300)', () => {
  test('merging a backup whose ONLY collision is the prefs row → clean conflict, not an unhandled PK throw', async () => {
    // Own a vehicle + the app-created userPreferences row; export a real ZIP carrying BOTH.
    const myVehicleId = await createVehicle('Honda');
    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const zip = await backupService.exportAsZip(ctx.user.id);

    // Now DELETE the vehicle so the only backup row that still collides with the live DB is the
    // userPreferences row (PK = userId, recreated by the app / never deleted). This isolates the
    // un-probed-table collision: detectConflicts checks vehicles/expenses/financing/insurance/photos/
    // photoRefs — NONE of which now collide — so it returns ZERO conflicts and the restore proceeds to
    // insertBackupData, which runs insert(userPreferences) against the existing PK.
    const delRes = await ctx.authed('DELETE', `/api/v1/vehicles/${myVehicleId}`);
    expect(delRes.status).toBeLessThan(300);
    const prefsRow = ctx.sqlite
      .query('SELECT user_id FROM user_preferences WHERE user_id = ?')
      .all(ctx.user.id) as { user_id: string }[];
    expect(prefsRow, 'importer still has a prefs row after the vehicle delete').toHaveLength(1);

    // EXPECTED (correct) behavior: a merge restore returns a clean ConflictResponse for the colliding
    // prefs row, OR a SyncError — NOT an unhandled SQLite constraint exception. The fix makes
    // detectConflicts probe userPreferences/syncState so this is reported as a normal conflict.
    let conflictReported = false;
    let threw: unknown = null;
    try {
      const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'merge');
      conflictReported = result.success === false && (result.conflicts ?? []).length > 0;
    } catch (err) {
      threw = err;
    }

    expect(
      conflictReported,
      `merge should report the prefs collision as a conflict, not throw a raw DB error (threw: ${
        threw instanceof Error ? threw.message : String(threw)
      })`
    ).toBe(true);
  });
});
