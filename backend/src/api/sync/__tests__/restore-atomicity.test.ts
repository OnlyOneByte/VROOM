/**
 * #127 — replace-mode restore is ATOMIC: a mid-insert failure must roll the wipe back, NOT leave the
 * account empty (NORTH_STAR #1, no silent loss).
 *
 * The footgun (C151): drizzle's bun-sqlite dialect is SYNCHRONOUS — it runs the transaction callback
 * inside bun's `client.transaction(() => …)`, which only wraps work that completes synchronously. The
 * old restore callback was `async`, so it returned a pending promise immediately: BEGIN/COMMIT closed
 * around nothing and every `await tx.delete/insert` ran as its OWN autocommit statement. On the replace
 * path that means a throw mid-insert (anything past the C428 cross-row-UNIQUE pre-validate — an `id` PK
 * collision, an FK violation, an IO error) left the wipe ALREADY COMMITTED and the account WIPED.
 *
 * FIX: the restore transaction callback + deleteUserData/insertBackupData are now SYNCHRONOUS (.run()/
 * .all()), so the wipe + every insert execute inside ONE real transaction that rolls back atomically.
 *
 * This test reproduces a validator-surviving mid-insert failure: it tampers a REAL exported ZIP so
 * `vehicles.csv` carries TWO rows with the SAME id (both with an empty licensePlate, so the C428
 * dup-check — which skips NULL-keyed rows — passes). validateBackupData accepts it (per-row schema +
 * referential-integrity are fine; the cross-row id collision is NOT one of the two UNIQUE indexes C428
 * guards), then the multi-row `insert(vehicles)` throws `UNIQUE constraint failed: vehicles.id`.
 *   - PRE-FIX: the wipe had autocommitted → the user's ORIGINAL vehicle is gone (total loss).
 *   - POST-FIX: the synchronous transaction rolls back → the original vehicle SURVIVES untouched.
 *
 * createTestApp() rewrites env then dynamic-imports the DB-bound modules; keep imports to the harness +
 * import backup/restore dynamically AFTER it so they bind to the throwaway in-memory DB.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import AdmZip from 'adm-zip';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

function vehicleRows(): { id: string; make: string }[] {
  return ctx.sqlite.query('SELECT id, make FROM vehicles').all() as { id: string; make: string }[];
}

/**
 * Duplicate the single data row of `vehicles.csv` inside a real backup ZIP so two rows share one id.
 * Returns a new ZIP buffer; everything else is byte-identical to the input.
 */
function duplicateVehicleRow(zipBuffer: Buffer): Buffer {
  const zip = new AdmZip(zipBuffer);
  const csv = zip.getEntry('vehicles.csv')?.getData().toString('utf-8');
  if (!csv) throw new Error('vehicles.csv not found in exported backup');
  const lines = csv.split('\n').filter((l) => l.trim().length > 0);
  // lines[0] = header, lines[1] = the one seeded vehicle. Append a byte-identical copy → same id.
  const dupLine = lines[1];
  const tampered = `${[...lines, dupLine].join('\n')}\n`;
  zip.updateFile('vehicles.csv', Buffer.from(tampered, 'utf-8'));
  return zip.toBuffer();
}

describe('#127 replace-mode restore atomicity — a mid-insert failure rolls the wipe back', () => {
  test('a backup that throws UNIQUE on vehicles.id during insert leaves the ORIGINAL data intact', async () => {
    // Own one real vehicle.
    const vehicleId = await seedVehicle(ctx, { make: 'Subaru', model: 'Outback', year: 2021 });
    expect(vehicleRows()).toHaveLength(1);

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');

    // Real export, then tamper: two vehicles.csv rows with the same id (empty licensePlate → the C428
    // cross-row UNIQUE pre-validate skips them as NULL-keyed, so validation passes and the throw lands
    // at INSERT time — exactly the post-validate mid-insert failure #127 is about).
    const zip = await backupService.exportAsZip(ctx.user.id);
    const tampered = duplicateVehicleRow(zip);

    // The restore must THROW (the duplicate id collides at insert) — it must NOT silently succeed.
    let threw: unknown = null;
    try {
      await restoreService.restoreFromBackup(ctx.user.id, tampered, 'replace');
    } catch (err) {
      threw = err;
    }
    expect(threw, 'the colliding insert should throw, not silently swallow').not.toBeNull();
    expect(String((threw as Error)?.message)).toContain('UNIQUE');

    // THE DATA-SAFETY ASSERTION: the wipe rolled back, so the user's original vehicle is STILL HERE.
    // Pre-fix (async tx) this was [] — the wipe had committed and the account was empty.
    const rows = vehicleRows();
    expect(rows, 'the original vehicle survives the failed restore (atomic rollback)').toHaveLength(
      1
    );
    expect(rows[0]?.id).toBe(vehicleId);
    expect(rows[0]?.make).toBe('Subaru');
  });

  test('a clean replace restore still succeeds end-to-end (no regression from the sync refactor)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Mazda', model: 'CX-5', year: 2023 });
    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');

    const zip = await backupService.exportAsZip(ctx.user.id);
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');

    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(result.imported?.vehicles).toBe(1);
    const rows = vehicleRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(vehicleId);
  });
});
