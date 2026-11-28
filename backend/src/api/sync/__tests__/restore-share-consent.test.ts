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
  shared_with_id: string;
  level: string;
  status: string;
}

async function shareRows(): Promise<ShareRowDb[]> {
  return (await ctx.sql.all('SELECT * FROM vehicle_shares ORDER BY id')) as ShareRowDb[];
}

async function shareById(id: string): Promise<ShareRowDb | undefined> {
  return (await shareRows()).find((r) => r.id === id);
}

async function seedUser(id: string): Promise<string> {
  await ctx.sql.run('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)', [
    id,
    `${id}@test.com`,
    id,
  ]);
  return id;
}

async function seedShare(
  id: string,
  vehicleId: string,
  sharedWithId: string,
  status: string,
  level = 'viewer'
): Promise<void> {
  await ctx.sql.run(
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
    const stranger = await seedUser('stranger-1');

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');

    const honestZip = await backupService.exportAsZip(ctx.user.id);
    expect(await shareRows()).toHaveLength(0);

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

    const forged = await shareById('forged-share');
    expect(forged?.status, 'a backup cannot mint an accepted grant').toBe('pending');
  });

  test('a declined grant cannot be re-minted as accepted by restoring a backup that predates the decline', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const invitee = await seedUser('decliner-1');
    await seedShare('share-declined', vehicleId, invitee, 'accepted');

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');

    const zip = await backupService.exportAsZip(ctx.user.id);
    await ctx.sql.run('UPDATE vehicle_shares SET status = ? WHERE id = ?', [
      'declined',
      'share-declined',
    ]);

    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);

    expect(
      (await shareById('share-declined'))?.status,
      'the decline is not overwritten by the backup'
    ).toBe('pending');
  });

  test('consent is resolved per (vehicle, invitee) pair — a real accept survives while a forged one does not', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Mazda', model: 'CX-5', year: 2023 });
    const consenting = await seedUser('consenting-1');
    const forgedInvitee = await seedUser('forged-invitee-1');
    await seedShare('share-real', vehicleId, consenting, 'accepted', 'editor');

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

    expect(
      (await shareById('share-real'))?.status,
      'a genuine accepted grant round-trips intact'
    ).toBe('accepted');
    expect((await shareById('share-forged'))?.status, 'the forged grant lands pending').toBe(
      'pending'
    );
  });

  test('a level outside the route enum is narrowed to viewer rather than stored verbatim', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Subaru', model: 'Outback', year: 2020 });
    const invitee = await seedUser('odd-level-1');
    await seedShare('share-odd-level', vehicleId, invitee, 'accepted', 'OWNER-PLUS');

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const zip = await backupService.exportAsZip(ctx.user.id);

    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(
      (await shareById('share-odd-level'))?.level,
      'an unknown level is stored as viewer'
    ).toBe('viewer');
  });
});
