import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../../test-helpers/http-client';
import { createInvitee } from '../../../test-helpers/invitee';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

interface DriverRow {
  id: string;
  vehicle_id: string;
  user_id: string | null;
  name: string;
}

async function drivers(): Promise<DriverRow[]> {
  return (await ctx.sql.all(
    'SELECT id, vehicle_id, user_id, name FROM vehicle_drivers ORDER BY id'
  )) as DriverRow[];
}

async function seedDriver(
  id: string,
  vehicleId: string,
  userId: string | null,
  name: string
): Promise<void> {
  await ctx.sql.run(
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
    await seedDriver('d-owner', vehicleId, ctx.user.id, 'Owner');
    await seedDriver('d-member', vehicleId, member.id, 'Member');
    await seedDriver('d-guest', vehicleId, null, 'Riley');
    await ctx.sql.run("UPDATE vehicle_drivers SET created_by = ? WHERE id = 'd-guest'", [
      member.id,
    ]);
    await ctx.sql.run(
      "INSERT INTO trips (id, vehicle_id, user_id, start_odometer, end_odometer, purpose, trip_date, driver_id) VALUES ('t1', ?, ?, 100, 150, 'personal', 1700000000, 'd-member')",
      [vehicleId, ctx.user.id]
    );

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const zip = await backupService.exportAsZip(ctx.user.id);
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);

    expect(await drivers()).toEqual([
      { id: 'd-guest', vehicle_id: vehicleId, user_id: null, name: 'Riley' },
      { id: 'd-member', vehicle_id: vehicleId, user_id: member.id, name: 'Member' },
      { id: 'd-owner', vehicle_id: vehicleId, user_id: ctx.user.id, name: 'Owner' },
    ]);
    expect(await ctx.sql.get("SELECT driver_id FROM trips WHERE id = 't1'")).toEqual({
      driver_id: 'd-member',
    });
    expect(
      await ctx.sql.get("SELECT created_by FROM vehicle_drivers WHERE id = 'd-guest'")
    ).toEqual({ created_by: member.id });
  });

  test('car sharing and its split rules survive a backup and restore', async () => {
    const vehicleId = await seedVehicle(ctx);
    await seedDriver('d-owner', vehicleId, ctx.user.id, 'Owner');
    await seedDriver('d-guest', vehicleId, null, 'Riley');
    const rules = {
      running: { kind: 'equal' },
      ownership: { kind: 'fixed', shares: { 'd-owner': 70, 'd-guest': 30 } },
    };
    await ctx.sql.run(
      'UPDATE vehicles SET car_share_enabled = TRUE, car_share_rules = ? WHERE id = ?',
      [JSON.stringify(rules), vehicleId]
    );

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const zip = await backupService.exportAsZip(ctx.user.id);
    await ctx.sql.run('UPDATE vehicles SET car_share_enabled = FALSE, car_share_rules = NULL');
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);

    const row = (await ctx.sql.get(
      'SELECT car_share_enabled AS enabled, car_share_rules AS rules FROM vehicles WHERE id = ?',
      [vehicleId]
    )) as { enabled: number; rules: string };
    expect(row.enabled).toBe(1);
    expect(JSON.parse(row.rules)).toEqual(rules);
    const res = await ctx.authed('GET', `/api/v1/vehicles/${vehicleId}/drivers/rules`);
    expect(((await res.json()) as { data: unknown }).data).toEqual(rules);
  });

  test("a driver linked to someone who isn't a member comes back as a guest", async () => {
    const vehicleId = await seedVehicle(ctx);
    const outsider = await createInvitee(ctx, 'driver-outsider');
    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const crafted = await editCsv(
      await backupService.exportAsZip(ctx.user.id),
      'vehicle_drivers.csv',
      () => [
        { id: 'd-x', vehicleId, userId: outsider.id, name: 'Outsider', createdBy: outsider.id },
        { id: 'd-y', vehicleId, userId: '', name: 'Guest', createdBy: ctx.user.id },
      ]
    );

    const result = await restoreService.restoreFromBackup(ctx.user.id, crafted, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(await drivers()).toEqual([
      { id: 'd-x', vehicle_id: vehicleId, user_id: null, name: 'Outsider' },
      { id: 'd-y', vehicle_id: vehicleId, user_id: null, name: 'Guest' },
    ]);
    expect(await ctx.sql.all('SELECT id, created_by FROM vehicle_drivers ORDER BY id')).toEqual([
      { id: 'd-x', created_by: null },
      { id: 'd-y', created_by: ctx.user.id },
    ]);
  });

  test('a driver colour outside the chart palette is dropped', async () => {
    const vehicleId = await seedVehicle(ctx);
    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const crafted = await editCsv(
      await backupService.exportAsZip(ctx.user.id),
      'vehicle_drivers.csv',
      () => [
        { id: 'd-ok', vehicleId, userId: '', name: 'Riley', color: 'chart-2' },
        { id: 'd-bad', vehicleId, userId: '', name: 'Sam', color: 'red;background:url(x)' },
      ]
    );
    const result = await restoreService.restoreFromBackup(ctx.user.id, crafted, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(await ctx.sql.all('SELECT id, color FROM vehicle_drivers ORDER BY id')).toEqual([
      { id: 'd-bad', color: null },
      { id: 'd-ok', color: 'chart-2' },
    ]);
  });

  test.each([
    ['odometer_entries.csv', 'driverId'],
    ['expenses.csv', 'paidByDriverId'],
  ])("a %s row can't name a driver of another car", async (file, column) => {
    const carA = await seedVehicle(ctx, { make: 'Kia', model: 'Rio', year: 2020 });
    const carB = await seedVehicle(ctx, { make: 'Kia', model: 'Soul', year: 2021 });
    await seedDriver('d-b', carB, ctx.user.id, 'Owner');
    await ctx.sql.run(
      "INSERT INTO odometer_entries (id, vehicle_id, user_id, odometer, recorded_at) VALUES ('o1', ?, ?, 1000, 1700000000)",
      [carA, ctx.user.id]
    );
    await ctx.sql.run(
      "INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount) VALUES ('e1', ?, ?, 'fuel', 1700000000, 4550)",
      [carA, ctx.user.id]
    );
    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const crafted = await editCsv(await backupService.exportAsZip(ctx.user.id), file, (rows) =>
      rows.map((row) => ({ ...row, [column]: 'd-b' }))
    );
    await expect(restoreService.restoreFromBackup(ctx.user.id, crafted, 'replace')).rejects.toThrow(
      'Backup validation failed'
    );
  });

  test("an entry can't name a driver of another car", async () => {
    const carA = await seedVehicle(ctx, { make: 'Kia', model: 'Rio', year: 2020 });
    const carB = await seedVehicle(ctx, { make: 'Kia', model: 'Soul', year: 2021 });
    await seedDriver('d-b', carB, ctx.user.id, 'Owner');
    await ctx.sql.run(
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
    expect(await ctx.sql.get("SELECT driver_id FROM trips WHERE id = 't1'")).toEqual({
      driver_id: null,
    });
  });
});
