/**
 * Security regression (C109, bug #20): merge-mode conflict detection must be TENANT-SCOPED.
 *
 * `detectConflicts` probed `SELECT * FROM <table> WHERE id IN (backup ids)` with NO ownership
 * filter, then returned the full existing DB row as `localData` in the `conflicts` response. So a
 * merge-mode restore whose row ids COLLIDE with another user's rows leaked that user's full row
 * contents (VIN, amounts, …) back to the importer — a cross-tenant READ leak, the same class as the
 * C145 restore write-stamp. The fix scopes every probe to the importer's own rows (userId column for
 * vehicles/expenses/insurance/photos; owned-parent FK for financing/photoRefs).
 *
 * This proves it: seed a VICTIM vehicle, then restore (merge) a backup whose vehicle id is tampered
 * to COLLIDE with the victim's id, as the importer. Pre-fix: conflicts contained the victim's row.
 * Post-fix: no conflict is reported (the colliding id isn't the importer's), so the restore proceeds
 * and the victim's row is never echoed. A positive control proves a genuine SELF-collision still
 * reports a conflict (the feature isn't broken, only the leak is closed).
 *
 * createTestApp() rewrites env then dynamic-imports DB-bound modules; keep static imports to the
 * harness + bun:test and import backup/restore + adm-zip dynamically AFTER createTestApp.
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

describe('restore merge conflict detection is tenant-scoped (cross-tenant read guard)', () => {
  test("a backup vehicle id colliding with ANOTHER user's row reports NO conflict (no leak)", async () => {
    // The importer (harness user) owns one vehicle; export it as a real ZIP.
    const myVehicleId = await createVehicle('Honda');
    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const AdmZip = (await import('adm-zip')).default;
    const zip = await backupService.exportAsZip(ctx.user.id);

    // Seed a VICTIM user with a vehicle whose id we will collide against. Its make ('Ferrari') is the
    // secret that must NOT leak back.
    const { db } = await import('../../../db/connection');
    const schema = await import('../../../db/schema');
    const victimId = 'victim-user-1';
    const victimVehicleId = 'victim-vehicle-secret-1';
    await db
      .insert(schema.users)
      .values({ id: victimId, email: 'victim@test.com', displayName: 'Victim' });
    await db.insert(schema.vehicles).values({
      id: victimVehicleId,
      userId: victimId,
      make: 'Ferrari',
      model: 'F8',
      year: 2023,
    });

    // Tamper the export: rewrite our vehicle's id to the victim's id, so the merge probe's id set
    // contains the victim's id. (metadata.userId stays ours → the envelope check still passes.)
    const archive = new AdmZip(zip);
    const csv = archive.getEntry('vehicles.csv')?.getData().toString('utf-8') as string;
    expect(csv, 'export contains vehicles.csv').toBeTruthy();
    const tampered = csv.split(myVehicleId).join(victimVehicleId);
    expect(tampered.includes(victimVehicleId), 'tamper replaced the id').toBe(true);
    archive.updateFile('vehicles.csv', Buffer.from(tampered, 'utf-8'));

    // Pre-fix: detectConflicts matched the victim's row and returned it in `conflicts[].localData`
    // — the leak. Post-fix: the probe is scoped to the importer, so the victim's id is NOT seen as a
    // conflict; merge then proceeds to insert and the DB's PK constraint rejects the colliding id
    // (the C108-audited "PK collision throws + rolls back, no overwrite"). EITHER outcome is secure —
    // the one thing that must never happen is the victim's row appearing in the response.
    let conflicts: NonNullable<
      Awaited<ReturnType<typeof restoreService.restoreFromBackup>>['conflicts']
    > = [];
    try {
      const result = await restoreService.restoreFromBackup(
        ctx.user.id,
        archive.toBuffer(),
        'merge'
      );
      conflicts = result.conflicts ?? [];
    } catch (err) {
      // A PK-collision throw is the secure path (no overwrite); the error must not carry the secret.
      expect(JSON.stringify(err instanceof Error ? err.message : err)).not.toContain('Ferrari');
    }

    const leaked = conflicts.some(
      (c) =>
        c.id === victimVehicleId ||
        JSON.stringify(c.localData ?? {}).includes('Ferrari') ||
        JSON.stringify(c.localData ?? {}).includes(victimId)
    );
    expect(leaked, "victim's row must not be echoed in conflicts").toBe(false);

    // And the victim's row is untouched in the DB (merge never overwrote it).
    const victimRows = ctx.sqlite
      .query('SELECT make FROM vehicles WHERE id = ?')
      .all(victimVehicleId) as { make: string }[];
    expect(victimRows).toHaveLength(1);
    expect(victimRows[0].make).toBe('Ferrari');
  });

  test('a genuine SELF-collision still reports a conflict (feature intact)', async () => {
    // The importer already owns the vehicle the backup carries → a real merge conflict.
    const myVehicleId = await createVehicle('Toyota');
    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const zip = await backupService.exportAsZip(ctx.user.id);

    // The row still exists (no wipe in merge mode), so restoring the same export in merge mode
    // collides with the importer's OWN row → conflict reported.
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'merge');

    expect(result.success).toBe(false);
    const conflicts = result.conflicts ?? [];
    const mine = conflicts.find((c) => c.id === myVehicleId);
    expect(mine, 'self-collision is still detected').toBeTruthy();
    expect(mine?.table).toBe('vehicles');
  });
});
