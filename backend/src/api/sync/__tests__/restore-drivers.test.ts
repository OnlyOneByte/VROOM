import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';
import { createInvitee } from '../../../test-helpers/invitee';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

interface DriverRow {
  id: string;
  vehicle_id: string;
  user_id: string | null;
  name: string;
}

function drivers(): DriverRow[] {
  return ctx.sqlite
    .query('SELECT id, vehicle_id, user_id, name FROM vehicle_drivers ORDER BY id')
    .all() as DriverRow[];
}

function seedDriver(id: string, vehicleId: string, userId: string | null, name: string): void {
  ctx.sqlite.run(
    'INSERT INTO vehicle_drivers (id, vehicle_id, user_id, name) VALUES (?, ?, ?, ?)',
    [id, vehicleId, userId, name]
  );
}

async function editCsv(
  zipBuffer: Buffer,
  fileName: string,
  edit: (rows: Record<string, string>[]) => Record<string, string>[]
): Promise<Buffer> {
  const AdmZip = (await import('adm-zip')).default;
  const { parse } = await import('csv-parse/sync');
  const { stringify } = await import('csv-stringify/sync');
  const zip = new AdmZip(zipBuffer);
  const csv = zip.getEntry(fileName)?.getData().toString('utf-8') ?? '';
  const rows = parse(csv, { columns: true }) as Record<string, string>[];
  const header =
    csv
      .split('\n')[0]
      ?.split(',')
      .map((h) => h.replace(/^"|"$/g, '')) ?? [];
  zip.updateFile(fileName, Buffer.from(stringify(edit(rows), { header: true, columns: header })));
  return zip.toBuffer();
}

describe('restoring car-share drivers', () => {
  test('drivers and the drivers on entries survive a backup and restore', async () => {
    const vehicleId = await seedVehicle(ctx);
    const member = await createInvitee(ctx, 'driver-member');
    await member.acceptShare(vehicleId, 'editor');
    seedDriver('d-owner', vehicleId, ctx.user.id, 'Owner');
    seedDriver('d-member', vehicleId, member.id, 'Member');
    seedDriver('d-guest', vehicleId, null, 'Riley');
    ctx.sqlite.run(
      "INSERT INTO trips (id, vehicle_id, user_id, start_odometer, end_odometer, purpose, trip_date, driver_id) VALUES ('t1', ?, ?, 100, 150, 'personal', 1700000000, 'd-member')",
      [vehicleId, ctx.user.id]
    );

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const zip = await backupService.exportAsZip(ctx.user.id);
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);

    expect(drivers()).toEqual([
      { id: 'd-guest', vehicle_id: vehicleId, user_id: null, name: 'Riley' },
      { id: 'd-member', vehicle_id: vehicleId, user_id: member.id, name: 'Member' },
      { id: 'd-owner', vehicle_id: vehicleId, user_id: ctx.user.id, name: 'Owner' },
    ]);
    expect(ctx.sqlite.query("SELECT driver_id FROM trips WHERE id = 't1'").get()).toEqual({
      driver_id: 'd-member',
    });
  });

  test("a driver linked to someone who isn't a member comes back as a guest", async () => {
    const vehicleId = await seedVehicle(ctx);
    const outsider = await createInvitee(ctx, 'driver-outsider');
    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const crafted = await editCsv(
      await backupService.exportAsZip(ctx.user.id),
      'vehicle_drivers.csv',
      () => [{ id: 'd-x', vehicleId, userId: outsider.id, name: 'Outsider' }]
    );

    const result = await restoreService.restoreFromBackup(ctx.user.id, crafted, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(drivers()).toEqual([
      { id: 'd-x', vehicle_id: vehicleId, user_id: null, name: 'Outsider' },
    ]);
  });

  test("an entry can't name a driver of another car", async () => {
    const carA = await seedVehicle(ctx, { make: 'Kia', model: 'Rio', year: 2020 });
    const carB = await seedVehicle(ctx, { make: 'Kia', model: 'Soul', year: 2021 });
    seedDriver('d-b', carB, ctx.user.id, 'Owner');
    ctx.sqlite.run(
      "INSERT INTO trips (id, vehicle_id, user_id, start_odometer, end_odometer, purpose, trip_date) VALUES ('t1', ?, ?, 100, 150, 'personal', 1700000000)",
      [carA, ctx.user.id]
    );
    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const crafted = await editCsv(
      await backupService.exportAsZip(ctx.user.id),
      'trips.csv',
      (rows) => rows.map((row) => ({ ...row, driverId: 'd-b' }))
    );

    await expect(restoreService.restoreFromBackup(ctx.user.id, crafted, 'replace')).rejects.toThrow(
      'Backup validation failed'
    );
    expect(ctx.sqlite.query("SELECT driver_id FROM trips WHERE id = 't1'").get()).toEqual({
      driver_id: null,
    });
  });
});
