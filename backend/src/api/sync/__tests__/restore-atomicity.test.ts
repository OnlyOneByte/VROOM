import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import AdmZip from 'adm-zip';
import { ConflictError } from '../../../errors';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
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
    expect(threw).toBeInstanceOf(ConflictError);
    expect(String((threw as Error)?.message)).not.toContain('UNIQUE');
    expect(String((threw as Error)?.message)).not.toContain('vehicles.id');

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

describe('a restore past its time limit', () => {
  test('writes nothing once its deadline has passed, even in replace mode', async () => {
    await seedVehicle(ctx, { make: 'Subaru', model: 'Outback', year: 2021 });
    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const zip = await backupService.exportAsZip(ctx.user.id);
    await seedVehicle(ctx, { make: 'Honda', model: 'Fit', year: 2019 });

    const timedOut = new Error('Restore from backup timed out');
    await expect(
      restoreService.restoreFromBackup(ctx.user.id, zip, 'replace', AbortSignal.abort(timedOut))
    ).rejects.toBe(timedOut);

    expect(
      vehicleRows()
        .map((v) => v.make)
        .sort()
    ).toEqual(['Honda', 'Subaru']);
  });
});

const OWNED_TABLES = [
  'vehicles',
  'expenses',
  'trips',
  'odometer_entries',
  'reminders',
  'reminder_vehicles',
  'user_preferences',
] as const;

function snapshot(): Record<string, unknown[]> {
  return Object.fromEntries(
    OWNED_TABLES.map((table) => [
      table,
      ctx.sqlite.query(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    ])
  );
}

describe('a replace restore that fails on its last step', () => {
  test('leaves every table exactly as it was before the restore began', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Subaru', model: 'Outback', year: 2021 });
    const write = async (path: string, body: Record<string, unknown>) =>
      expect((await ctx.authed('POST', path, body)).status).toBe(201);
    await write('/api/v1/expenses', {
      vehicleId,
      category: 'maintenance',
      date: '2024-04-02',
      expenseAmount: 30,
    });
    await write('/api/v1/trips', {
      vehicleId,
      startOdometer: 1000,
      endOdometer: 1050,
      purpose: 'personal',
      tripDate: '2024-03-01',
    });
    await write('/api/v1/reminders', {
      name: 'Oil',
      type: 'notification',
      frequency: 'monthly',
      startDate: '2030-01-15T00:00:00.000Z',
      vehicleIds: [vehicleId],
    });

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const zip = await backupService.exportAsZip(ctx.user.id);
    await seedVehicle(ctx, { make: 'Honda', model: 'Fit', year: 2019 });
    const before = snapshot();
    expect(before.vehicles).toHaveLength(2);

    const late = new Error('forced failure after every row was written');
    const spy = spyOn(
      restoreService as unknown as { knownProviderIds: () => Promise<Set<string>> },
      'knownProviderIds'
    ).mockRejectedValue(late);
    try {
      await expect(restoreService.restoreFromBackup(ctx.user.id, zip, 'replace')).rejects.toBe(
        late
      );
    } finally {
      spy.mockRestore();
    }

    expect(snapshot()).toEqual(before);
  });
});

describe('a restore whose deadline passes while its transaction is open', () => {
  test('rolls back instead of committing after the caller was told it timed out', async () => {
    await seedVehicle(ctx, { make: 'Subaru', model: 'Outback', year: 2021 });
    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const zip = await backupService.exportAsZip(ctx.user.id);
    await seedVehicle(ctx, { make: 'Honda', model: 'Fit', year: 2019 });

    const controller = new AbortController();
    const timedOut = new Error('Restore from backup timed out');
    const reader = restoreService as unknown as {
      knownProviderIds: (...args: unknown[]) => Promise<Set<string>>;
    };
    const known = reader.knownProviderIds.bind(restoreService);
    const spy = spyOn(reader, 'knownProviderIds').mockImplementation(async (...args) => {
      controller.abort(timedOut);
      return known(...args);
    });
    try {
      await expect(
        restoreService.restoreFromBackup(ctx.user.id, zip, 'replace', controller.signal)
      ).rejects.toBe(timedOut);
    } finally {
      spy.mockRestore();
    }

    expect(
      vehicleRows()
        .map((v) => v.make)
        .sort()
    ).toEqual(['Honda', 'Subaru']);
  });
});
