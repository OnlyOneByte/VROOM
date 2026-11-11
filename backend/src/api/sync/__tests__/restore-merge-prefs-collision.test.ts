// Merge restore must report a userPreferences primary-key collision as a conflict. A backup always
// carries the creator's prefs row, and the importer always has one too. Unprobed, the collision
// reached an insert and threw a raw UNIQUE error that aborted the whole restore.

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

describe('restore merge: userPreferences PK collision is detected as a conflict, not a raw DB throw', () => {
  test('merging a backup whose ONLY collision is the prefs row → clean conflict, not an unhandled PK throw', async () => {
    // Own a vehicle + the app-created userPreferences row; export a real ZIP carrying BOTH.
    const myVehicleId = await createVehicle('Honda');
    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const zip = await backupService.exportAsZip(ctx.user.id);

    // Deleting the vehicle leaves the prefs row as the only colliding backup row.
    const delRes = await ctx.authed('DELETE', `/api/v1/vehicles/${myVehicleId}`);
    expect(delRes.status).toBeLessThan(300);
    const prefsRow = ctx.sqlite
      .query('SELECT user_id FROM user_preferences WHERE user_id = ?')
      .all(ctx.user.id) as { user_id: string }[];
    expect(prefsRow, 'importer still has a prefs row after the vehicle delete').toHaveLength(1);

    // A merge must return a conflict for the prefs row, not an unhandled SQLite constraint error.
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
