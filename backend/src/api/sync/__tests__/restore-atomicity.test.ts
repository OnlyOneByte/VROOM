import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import AdmZip from 'adm-zip';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

function vehicleRows(): { id: string; make: string }[] {
  return ctx.sqlite.query('SELECT id, make FROM vehicles').all() as { id: string; make: string }[];
}

function duplicateVehicleRow(zipBuffer: Buffer): Buffer {
  const zip = new AdmZip(zipBuffer);
  const csv = zip.getEntry('vehicles.csv')?.getData().toString('utf-8');
  if (!csv) throw new Error('vehicles.csv not found in exported backup');
  const lines = csv.split('\n').filter((l) => l.trim().length > 0);
  const dupLine = lines[1];
  const tampered = `${[...lines, dupLine].join('\n')}\n`;
  zip.updateFile('vehicles.csv', Buffer.from(tampered, 'utf-8'));
  return zip.toBuffer();
}

describe('replace-mode restore atomicity — a mid-insert failure rolls the wipe back', () => {
  test('a backup that throws UNIQUE on vehicles.id during insert leaves the ORIGINAL data intact', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Subaru', model: 'Outback', year: 2021 });
    expect(vehicleRows()).toHaveLength(1);

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');

    const zip = await backupService.exportAsZip(ctx.user.id);
    const tampered = duplicateVehicleRow(zip);

    let threw: unknown = null;
    try {
      await restoreService.restoreFromBackup(ctx.user.id, tampered, 'replace');
    } catch (err) {
      threw = err;
    }
    expect(threw, 'the colliding insert should throw, not silently swallow').not.toBeNull();
    expect(String((threw as Error)?.message)).toContain('UNIQUE');

    const rows = vehicleRows();
    expect(rows, 'the original vehicle survives the failed restore (atomic rollback)').toHaveLength(
      1
    );
    expect(rows[0]?.id).toBe(vehicleId);
    expect(rows[0]?.make).toBe('Subaru');
  });

  test('a clean replace restore still succeeds end-to-end', async () => {
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
