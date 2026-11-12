import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

interface VehicleRowDb {
  id: string;
  make: string;
}

function vehicleRows(): VehicleRowDb[] {
  return ctx.sqlite.query('SELECT id, make FROM vehicles').all() as VehicleRowDb[];
}

describe('restore refuses an empty-backup replace', () => {
  test('replace with a 0-row backup throws and leaves existing data intact', async () => {
    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');

    const emptyZip = await backupService.exportAsZip(ctx.user.id);

    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'X', year: 2021 });
    expect(vehicleRows()).toHaveLength(1);

    await expect(
      restoreService.restoreFromBackup(ctx.user.id, emptyZip, 'replace')
    ).rejects.toThrow(/empty backup/i);

    const rows = vehicleRows();
    expect(rows, 'existing data must survive a rejected empty replace').toHaveLength(1);
    expect(rows[0].id).toBe(vehicleId);
    expect(rows[0].make).toBe('Honda');
  });

  test('preview of an empty backup is unaffected (read-only, returns the 0-row summary)', async () => {
    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const emptyZip = await backupService.exportAsZip(ctx.user.id);
    await seedVehicle(ctx, { make: 'Toyota', model: 'X', year: 2021 });

    const result = await restoreService.restoreFromBackup(ctx.user.id, emptyZip, 'preview');
    expect(result.success).toBe(true);
    expect(result.preview?.vehicles).toBe(0);
    expect(vehicleRows()).toHaveLength(1);
  });

  test('merge of an empty backup is unaffected (never deletes; nothing to insert)', async () => {
    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const emptyZip = await backupService.exportAsZip(ctx.user.id);
    const vehicleId = await seedVehicle(ctx, { make: 'Mazda', model: 'X', year: 2021 });

    const result = await restoreService.restoreFromBackup(ctx.user.id, emptyZip, 'merge');
    expect(result.success).toBe(true);
    const rows = vehicleRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(vehicleId);
  });

  test('a NON-empty backup still replaces normally (guard is not over-broad)', async () => {
    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');

    const vehicleId = await seedVehicle(ctx, { make: 'Subaru', model: 'X', year: 2021 });
    const fullZip = await backupService.exportAsZip(ctx.user.id);

    const result = await restoreService.restoreFromBackup(ctx.user.id, fullZip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);
    const rows = vehicleRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(vehicleId);
    expect(rows[0].make).toBe('Subaru');
  });
});
