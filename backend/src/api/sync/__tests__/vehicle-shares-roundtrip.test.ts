import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

interface ShareRowDb {
  id: string;
  vehicle_id: string;
  owner_id: string;
  shared_with_id: string;
  level: string;
  status: string;
  invited_email: string | null;
}

async function shareRows(): Promise<ShareRowDb[]> {
  return (await ctx.sql.all('SELECT * FROM vehicle_shares ORDER BY id')) as ShareRowDb[];
}

async function seedUser(id: string, email: string): Promise<string> {
  await ctx.sql.run('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)', [
    id,
    email,
    id,
  ]);
  return id;
}

async function seedShare(
  id: string,
  vehicleId: string,
  sharedWithId: string,
  status: string,
  level = 'viewer',
  invitedEmail: string | null = null
): Promise<void> {
  await ctx.sql.run(
    `INSERT INTO vehicle_shares (id, vehicle_id, owner_id, shared_with_id, level, status, invited_email, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)`,
    [id, vehicleId, ctx.user.id, sharedWithId, level, status, invitedEmail]
  );
}

describe('backup → restore round-trip preserves vehicle_shares', () => {
  test('an ACCEPTED grant survives export + restore with its fields intact', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const invitee = await seedUser('invitee-rt', 'invitee-rt@test.com');
    await seedShare('share-1', vehicleId, invitee, 'accepted', 'editor', 'Invitee-RT@test.com');
    expect(await shareRows()).toHaveLength(1);

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');

    const zip = await backupService.exportAsZip(ctx.user.id);
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');

    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(result.imported?.vehicleShares, 'restore summary counts the share').toBe(1);

    const rows = await shareRows();
    expect(rows, 'exactly one share after restore (no dup, no loss)').toHaveLength(1);
    expect(rows[0].id).toBe('share-1');
    expect(rows[0].vehicle_id).toBe(vehicleId);
    expect(rows[0].owner_id).toBe(ctx.user.id);
    expect(rows[0].shared_with_id).toBe(invitee);
    expect(rows[0].level).toBe('editor');
    expect(rows[0].status).toBe('accepted');
    expect(rows[0].invited_email).toBe('Invitee-RT@test.com');
  });

  test('only accepted grants are exported; pending, declined and revoked grants are not re-created', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const a = await seedUser('inv-acc', 'acc@test.com');
    const p = await seedUser('inv-pend', 'pend@test.com');
    const d = await seedUser('inv-dec', 'dec@test.com');
    const r = await seedUser('inv-rev', 'rev@test.com');
    await seedShare('s-acc', vehicleId, a, 'accepted');
    await seedShare('s-pend', vehicleId, p, 'pending');
    await seedShare('s-dec', vehicleId, d, 'declined');
    await seedShare('s-rev', vehicleId, r, 'revoked');
    expect(await shareRows()).toHaveLength(4);

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const zip = await backupService.exportAsZip(ctx.user.id);
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);

    const rows = await shareRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('s-acc');
    expect(rows[0].status).toBe('accepted');
  });

  test('blast-radius: the INVITEE export does NOT include the owner share', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Mazda', model: 'CX-5', year: 2023 });
    const invitee = await seedUser('inv-blast', 'blast@test.com');
    await seedShare('s-blast', vehicleId, invitee, 'accepted');

    const { backupService } = await import('../backup');
    const inviteeBackup = await backupService.createBackup(invitee);
    expect(inviteeBackup.vehicleShares ?? []).toHaveLength(0);
    expect(inviteeBackup.vehicles.find((v) => v.id === vehicleId)).toBeUndefined();

    const ownerBackup = await backupService.createBackup(ctx.user.id);
    expect(ownerBackup.vehicleShares ?? []).toHaveLength(1);
  });

  test('cross-instance: a grant whose invitee user is ABSENT is skipped, not FK-aborted', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Subaru', model: 'Outback', year: 2020 });
    const present = await seedUser('inv-present', 'present@test.com');
    const absent = await seedUser('inv-absent', 'absent@test.com');
    await seedShare('s-present', vehicleId, present, 'accepted');
    await seedShare('s-absent', vehicleId, absent, 'accepted');

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const zip = await backupService.exportAsZip(ctx.user.id);

    await ctx.sql.run('DELETE FROM users WHERE id = ?', [absent]);

    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);
    const rows = await shareRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('s-present');
  });
});
