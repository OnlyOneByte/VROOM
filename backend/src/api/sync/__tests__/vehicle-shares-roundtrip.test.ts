/**
 * TRUE backup → restore round-trip for vehicle_shares (vehicle-sharing T9, design §4/§6.4, R7/D7/D8,
 * NORTH_STAR #1). vehicle_shares is threaded through the pipeline by hand (config maps +
 * OPTIONAL_BACKUP_FILES, createBackup query + validateShareRefs, restore FK-ordered insert +
 * ImportSummary + conflict-probe); the drift guards prove the wiring EXISTS — this proves the round-trip
 * preserves an owner's accepted grant AND honors the cross-tenant guarantees:
 *   - the OWNER's export carries their ACCEPTED grants (D7 — pending/declined/revoked are NOT exported),
 *   - the INVITEE's export does NOT pull the owner's shares (blast-radius, §6.4 — createBackup scopes by
 *     ownerId, and the invitee is never an ownerId),
 *   - restore re-stamps ownerId to the importer and (cross-instance) SKIPS a grant whose invitee user is
 *     absent rather than FK-aborting the whole restore (#127/C151 data-loss class).
 *
 * Shares are seeded directly via ctx.sqlite (the round-trip path — CSV serialize → parse → FK-ordered
 * insert — is independent of the share routes, same approach trips-roundtrip uses). createTestApp()
 * rewrites env then dynamic-imports DB-bound modules, so keep static imports to the harness + bun:test.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp; // the OWNER (harness-seeded user)

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

interface ShareRowDb {
  id: string;
  vehicle_id: string;
  owner_id: string;
  shared_with_id: string;
  level: string;
  status: string;
}

function shareRows(): ShareRowDb[] {
  return ctx.sqlite.query('SELECT * FROM vehicle_shares ORDER BY id').all() as ShareRowDb[];
}

/** Seed an invitee user + return its id. */
function seedUser(id: string, email: string): string {
  ctx.sqlite.run('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)', [id, email, id]);
  return id;
}

function seedShare(
  id: string,
  vehicleId: string,
  sharedWithId: string,
  status: string,
  level = 'viewer'
): void {
  ctx.sqlite.run(
    `INSERT INTO vehicle_shares (id, vehicle_id, owner_id, shared_with_id, level, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0)`,
    [id, vehicleId, ctx.user.id, sharedWithId, level, status]
  );
}

describe('backup → restore round-trip preserves vehicle_shares (T9)', () => {
  test('an ACCEPTED grant survives export + restore with its fields intact', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const invitee = seedUser('invitee-rt', 'invitee-rt@test.com');
    seedShare('share-1', vehicleId, invitee, 'accepted', 'editor');
    expect(shareRows()).toHaveLength(1);

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');

    const zip = await backupService.exportAsZip(ctx.user.id);
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');

    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(result.imported?.vehicleShares, 'restore summary counts the share').toBe(1);

    const rows = shareRows();
    expect(rows, 'exactly one share after restore (no dup, no loss)').toHaveLength(1);
    expect(rows[0].id).toBe('share-1');
    expect(rows[0].vehicle_id).toBe(vehicleId);
    expect(rows[0].owner_id).toBe(ctx.user.id);
    expect(rows[0].shared_with_id).toBe(invitee);
    expect(rows[0].level).toBe('editor');
    expect(rows[0].status).toBe('accepted');
  });

  test('D7: only ACCEPTED grants are exported — pending/declined/revoked are NOT re-created', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const a = seedUser('inv-acc', 'acc@test.com');
    const p = seedUser('inv-pend', 'pend@test.com');
    const d = seedUser('inv-dec', 'dec@test.com');
    const r = seedUser('inv-rev', 'rev@test.com');
    seedShare('s-acc', vehicleId, a, 'accepted');
    seedShare('s-pend', vehicleId, p, 'pending');
    seedShare('s-dec', vehicleId, d, 'declined');
    seedShare('s-rev', vehicleId, r, 'revoked');
    expect(shareRows()).toHaveLength(4);

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const zip = await backupService.exportAsZip(ctx.user.id);
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);

    // Replace mode wiped everything; only the accepted grant was exported → only it returns.
    const rows = shareRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('s-acc');
    expect(rows[0].status).toBe('accepted');
  });

  test('blast-radius: the INVITEE export does NOT include the owner share', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Mazda', model: 'CX-5', year: 2023 });
    const invitee = seedUser('inv-blast', 'blast@test.com');
    seedShare('s-blast', vehicleId, invitee, 'accepted');

    const { backupService } = await import('../backup');
    // The invitee is sharedWithId, never ownerId → createBackup(invitee) scopes by ownerId=invitee → none.
    const inviteeBackup = await backupService.createBackup(invitee);
    expect(inviteeBackup.vehicleShares ?? []).toHaveLength(0);
    // And the invitee's backup does NOT carry the owner's vehicle either (it isn't theirs).
    expect(inviteeBackup.vehicles.find((v) => v.id === vehicleId)).toBeUndefined();

    // The owner's backup DOES carry the grant.
    const ownerBackup = await backupService.createBackup(ctx.user.id);
    expect(ownerBackup.vehicleShares ?? []).toHaveLength(1);
  });

  test('cross-instance: a grant whose invitee user is ABSENT is skipped, not FK-aborted', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Subaru', model: 'Outback', year: 2020 });
    const present = seedUser('inv-present', 'present@test.com');
    const absent = seedUser('inv-absent', 'absent@test.com');
    seedShare('s-present', vehicleId, present, 'accepted');
    seedShare('s-absent', vehicleId, absent, 'accepted');

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const zip = await backupService.exportAsZip(ctx.user.id);

    // Simulate a cross-instance restore: the 'absent' invitee does not exist at restore time. Replace mode
    // wipes shares but NOT users; remove the absent invitee so its FK target is gone.
    ctx.sqlite.run('DELETE FROM users WHERE id = ?', [absent]);

    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
    // The whole restore SUCCEEDS (no FK abort) — the absent-invitee grant is silently skipped.
    expect(result.success, JSON.stringify(result)).toBe(true);
    const rows = shareRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('s-present');
  });
});
