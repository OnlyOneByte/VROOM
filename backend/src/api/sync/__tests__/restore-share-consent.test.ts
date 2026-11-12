import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

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

    const honestZip = await backupService.exportAsZip(ctx.user.id);
    expect(shareRows()).toHaveLength(0);

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

    const forged = shareById('forged-share');
    expect(forged?.status, 'a backup cannot mint an accepted grant').toBe('pending');
  });

  test('a declined grant cannot be re-minted as accepted by restoring a backup that predates the decline', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const invitee = seedUser('decliner-1');
    seedShare('share-declined', vehicleId, invitee, 'accepted');

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');

    const zip = await backupService.exportAsZip(ctx.user.id);
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

    expect(shareById('share-real')?.status, 'a genuine accepted grant round-trips intact').toBe(
      'accepted'
    );
    expect(shareById('share-forged')?.status, 'the forged grant lands pending').toBe('pending');
  });

  test('a level outside the route enum is narrowed to viewer rather than stored verbatim', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Subaru', model: 'Outback', year: 2020 });
    const invitee = seedUser('odd-level-1');
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
