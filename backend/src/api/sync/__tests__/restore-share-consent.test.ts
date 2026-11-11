/**
 * A restored vehicle_share may not assert a consent the invitee never gave.
 *
 * `accepted` is reachable in the live app only through the invitee's own accept call — it is the
 * consent boundary for the one deliberate cross-user widening VROOM has. A backup file is untrusted
 * input, so taking `status` verbatim from it let any account mint an accepted grant on a stranger's
 * fleet (an unsolicited, attacker-controlled vehicle card appearing in the victim's list, with editor
 * rights the victim never clicked) and re-mint a grant the victim had explicitly declined. Restore now
 * re-derives the status from what the DB records the invitee agreeing to, read before the replace-mode
 * wipe cascades the owner's shares away.
 *
 * The companion assertion — a GENUINE accepted grant still comes back accepted — lives both here and in
 * vehicle-shares-roundtrip.test.ts: deriving the status from a snapshot taken a moment too late would
 * downgrade every real sharee to pending on an ordinary restore, which is the costlier failure of the
 * two and so is pinned twice.
 *
 * createTestApp() rewrites env then dynamic-imports DB-bound modules, so keep static imports to the
 * harness + bun:test.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp; // the importing user, who owns the vehicles and the backup

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

interface ShareRowDb {
  id: string;
  vehicle_id: string;
  shared_with_id: string;
  level: string;
  status: string;
}

function shareRows(): ShareRowDb[] {
  return ctx.sqlite.query('SELECT * FROM vehicle_shares ORDER BY id').all() as ShareRowDb[];
}

function shareById(id: string): ShareRowDb | undefined {
  return shareRows().find((r) => r.id === id);
}

function seedUser(id: string): string {
  ctx.sqlite.run('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)', [
    id,
    `${id}@test.com`,
    id,
  ]);
  return id;
}

/** Seeded directly: the round-trip under test is independent of the share routes. */
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

/**
 * Append one hand-built row to a member CSV of a real backup ZIP — the crafted-backup attack, which is
 * just a text edit plus a re-zip. The row is keyed by the CSV's own header so it survives a column
 * reorder in the schema.
 */
async function appendCsvRow(
  zipBuffer: Buffer,
  fileName: string,
  values: Record<string, string>
): Promise<Buffer> {
  const AdmZip = (await import('adm-zip')).default;
  const zip = new AdmZip(zipBuffer);
  const csv = zip.getEntry(fileName)?.getData().toString('utf-8');
  if (!csv) throw new Error(`${fileName} missing from the backup ZIP`);
  const [header] = csv.split('\n');
  const columns = header.split(',').map((h) => h.replace(/^"|"$/g, ''));
  const line = columns.map((col) => `"${(values[col] ?? '').replace(/"/g, '""')}"`).join(',');
  zip.updateFile(fileName, Buffer.from(`${csv.trimEnd()}\n${line}\n`, 'utf-8'));
  return zip.toBuffer();
}

describe('restore re-derives vehicle_share consent instead of trusting the backup', () => {
  test('a crafted backup row claiming `accepted` for a non-consenting invitee restores as pending', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const stranger = seedUser('stranger-1');

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');

    // The importer's own, honest backup: no shares at all.
    const honestZip = await backupService.exportAsZip(ctx.user.id);
    expect(shareRows()).toHaveLength(0);

    // One appended line is the whole attack: the importer's own vehicle + own owner id (both are
    // validated against the backup), a stranger as invitee, editor rights, already accepted.
    const craftedZip = await appendCsvRow(honestZip, 'vehicle_shares.csv', {
      id: 'forged-share',
      vehicleId,
      ownerId: ctx.user.id,
      sharedWithId: stranger,
      level: 'editor',
      status: 'accepted',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    });

    const result = await restoreService.restoreFromBackup(ctx.user.id, craftedZip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(result.imported?.vehicleShares).toBe(1);

    // THE ASSERTION: the grant exists as an INVITE the stranger may decline, not as a fait accompli.
    const forged = shareById('forged-share');
    expect(forged?.status, 'a backup cannot mint an accepted grant').toBe('pending');
  });

  test('a declined grant cannot be re-minted as accepted by restoring a backup that predates the decline', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const invitee = seedUser('decliner-1');
    seedShare('share-declined', vehicleId, invitee, 'accepted');

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');

    // Exported while the grant was still accepted, so the ZIP carries status=accepted...
    const zip = await backupService.exportAsZip(ctx.user.id);
    // ...and only afterwards does the invitee decline.
    ctx.sqlite.run('UPDATE vehicle_shares SET status = ? WHERE id = ?', [
      'declined',
      'share-declined',
    ]);

    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);

    expect(
      shareById('share-declined')?.status,
      'the decline is not overwritten by the backup'
    ).toBe('pending');
  });

  test('consent is resolved per (vehicle, invitee) pair — a real accept survives while a forged one does not', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Mazda', model: 'CX-5', year: 2023 });
    const consenting = seedUser('consenting-1');
    const forgedInvitee = seedUser('forged-invitee-1');
    seedShare('share-real', vehicleId, consenting, 'accepted', 'editor');

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');

    const zip = await appendCsvRow(
      await backupService.exportAsZip(ctx.user.id),
      'vehicle_shares.csv',
      {
        id: 'share-forged',
        vehicleId,
        ownerId: ctx.user.id,
        sharedWithId: forgedInvitee,
        level: 'editor',
        status: 'accepted',
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      }
    );

    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);

    // Both directions in one test: a status derived from a too-late snapshot would downgrade the real
    // grant, and a status taken verbatim from the file would promote the forged one.
    expect(shareById('share-real')?.status, 'a genuine accepted grant round-trips intact').toBe(
      'accepted'
    );
    expect(shareById('share-forged')?.status, 'the forged grant lands pending').toBe('pending');
  });

  test('a level outside the route enum is narrowed to viewer rather than stored verbatim', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Subaru', model: 'Outback', year: 2020 });
    const invitee = seedUser('odd-level-1');
    // `level` is a plain text column — the enum lives only on the share routes, so a hand-edited
    // backup can carry anything.
    seedShare('share-odd-level', vehicleId, invitee, 'accepted', 'OWNER-PLUS');

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const zip = await backupService.exportAsZip(ctx.user.id);

    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(shareById('share-odd-level')?.level, 'an unknown level is stored as viewer').toBe(
      'viewer'
    );
  });
});
