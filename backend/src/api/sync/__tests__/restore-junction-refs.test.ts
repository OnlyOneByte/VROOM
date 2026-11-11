// Restore must reject a backup whose junction or financing row points outside the backup. Junction
// and financing rows carry no userId, so the referential check is their only tenant guard.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

describe('restore rejects junction rows that reference out-of-backup ids', () => {
  test('a reminder_vehicles row pointing at a bogus vehicle id is rejected', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });

    const created = await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Oil change',
      type: 'notification',
      frequency: 'monthly',
      startDate: '2024-06-01T00:00:00.000Z',
      vehicleIds: [vehicleId],
    });
    expect(created.status, await created.text()).toBe(201);

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const AdmZip = (await import('adm-zip')).default;

    const zip = await backupService.exportAsZip(ctx.user.id);
    const archive = new AdmZip(zip);
    const junctionCsv = archive.getEntry('reminder_vehicles.csv')?.getData().toString('utf-8');
    expect(junctionCsv, 'export contains reminder_vehicles.csv').toBeTruthy();
    expect(junctionCsv as string, 'junction references the real vehicle').toContain(vehicleId);

    // Tamper: repoint the junction at a vehicle id that is NOT in the backup.
    const tampered = (junctionCsv as string).split(vehicleId).join('not-in-backup-vehicle');
    archive.updateFile('reminder_vehicles.csv', Buffer.from(tampered, 'utf-8'));
    const tamperedZip = archive.toBuffer();

    // Must fail on the referential check, not on an unrelated error.
    let thrown: unknown;
    try {
      await restoreService.restoreFromBackup(ctx.user.id, tamperedZip, 'replace');
    } catch (e) {
      thrown = e;
    }
    expect(thrown, 'tampered restore must throw').toBeDefined();
    const errText = JSON.stringify(
      thrown instanceof Error
        ? { message: thrown.message, ...(thrown as unknown as Record<string, unknown>) }
        : thrown
    ).toLowerCase();
    expect(errText, 'rejection cites the junction/vehicle ref').toContain('vehicle');

    // Validation runs before the wipe, so a rejected restore changes nothing.
    const rows = ctx.sqlite.query('SELECT id FROM vehicles').all() as { id: string }[];
    expect(rows, 'rejected restore left the original data intact, no wipe').toHaveLength(1);
    expect(rows[0].id).toBe(vehicleId);
    expect(rows.some((r) => r.id === 'not-in-backup-vehicle')).toBe(false);
  });

  // Financing has no userId column, so its ownership rests entirely on the vehicleId check.
  test('a vehicle_financing row pointing at a bogus vehicle id is rejected', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });

    const fin = await ctx.authed('POST', `/api/v1/financing/vehicles/${vehicleId}/financing`, {
      financingType: 'loan',
      provider: 'TestBank',
      originalAmount: 20000,
      termMonths: 60,
      startDate: '2024-01-01T00:00:00.000Z',
      paymentAmount: 400,
      apr: 5,
    });
    expect(fin.status, await fin.text()).toBeLessThan(300);

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const AdmZip = (await import('adm-zip')).default;

    const zip = await backupService.exportAsZip(ctx.user.id);
    const archive = new AdmZip(zip);
    const finCsv = archive.getEntry('vehicle_financing.csv')?.getData().toString('utf-8');
    expect(finCsv, 'export contains vehicle_financing.csv').toBeTruthy();
    expect(finCsv as string, 'financing references the real vehicle').toContain(vehicleId);

    // Tamper: repoint the financing row at a vehicle id NOT in the backup.
    const tampered = (finCsv as string).split(vehicleId).join('not-in-backup-vehicle');
    archive.updateFile('vehicle_financing.csv', Buffer.from(tampered, 'utf-8'));
    const tamperedZip = archive.toBuffer();

    let thrown: unknown;
    try {
      await restoreService.restoreFromBackup(ctx.user.id, tamperedZip, 'replace');
    } catch (e) {
      thrown = e;
    }
    expect(thrown, 'tampered financing restore must throw').toBeDefined();
    const errText = JSON.stringify(
      thrown instanceof Error
        ? { message: thrown.message, ...(thrown as unknown as Record<string, unknown>) }
        : thrown
    ).toLowerCase();
    expect(errText, 'rejection cites the financing/vehicle ref').toContain('vehicle');

    // Validation runs before the replace transaction → nothing mutated, no wipe.
    const rows = ctx.sqlite.query('SELECT id FROM vehicles').all() as { id: string }[];
    expect(rows, 'rejected restore left the original data intact').toHaveLength(1);
    expect(rows[0].id).toBe(vehicleId);
  });

  // A reminder-sourced expense must reference a reminder that is in the backup.
  test('a reminder-sourced expense pointing at a bogus reminder id is rejected', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const created = await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Oil change',
      type: 'notification',
      frequency: 'monthly',
      startDate: '2024-06-01T00:00:00.000Z',
      vehicleIds: [vehicleId],
    });
    const remBody = await json<DataEnvelope<{ reminder: { id: string } }>>(created);
    expect(created.status, JSON.stringify(remBody)).toBe(201);
    const reminderId = remBody.data.reminder.id;

    // Seeded directly, since the manual route only accepts the financing source type.
    ctx.sqlite.run(
      `INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount, source_type, source_id)
       VALUES ('exp-src-1', ?, ?, 'maintenance', 1717200000, 50.0, 'reminder', ?)`,
      [vehicleId, ctx.user.id, reminderId]
    );

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const AdmZip = (await import('adm-zip')).default;

    const zip = await backupService.exportAsZip(ctx.user.id);
    const archive = new AdmZip(zip);
    const expCsv = archive.getEntry('expenses.csv')?.getData().toString('utf-8');
    expect(expCsv, 'export contains expenses.csv').toBeTruthy();
    expect(expCsv as string, 'the expense references the real reminder source').toContain(
      reminderId
    );

    const tampered = (expCsv as string).split(reminderId).join('not-in-backup-reminder');
    archive.updateFile('expenses.csv', Buffer.from(tampered, 'utf-8'));
    const tamperedZip = archive.toBuffer();

    let thrown: unknown;
    try {
      await restoreService.restoreFromBackup(ctx.user.id, tamperedZip, 'replace');
    } catch (e) {
      thrown = e;
    }
    expect(thrown, 'tampered expense-source restore must throw').toBeDefined();
    const errText = JSON.stringify(
      thrown instanceof Error
        ? { message: thrown.message, ...(thrown as unknown as Record<string, unknown>) }
        : thrown
    ).toLowerCase();
    expect(errText, 'rejection cites the reminder source ref').toContain('reminder');

    // Validation runs before the replace transaction → nothing mutated, no wipe.
    const rows = ctx.sqlite.query('SELECT id FROM vehicles').all() as { id: string }[];
    expect(rows, 'rejected restore left the original data intact').toHaveLength(1);
    expect(rows[0].id).toBe(vehicleId);
  });

  test('the untampered backup restores cleanly (control)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const created = await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Oil change',
      type: 'notification',
      frequency: 'monthly',
      startDate: '2024-06-01T00:00:00.000Z',
      vehicleIds: [vehicleId],
    });
    expect(created.status, await created.text()).toBe(201);

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const zip = await backupService.exportAsZip(ctx.user.id);

    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(result.imported?.reminderVehicles).toBe(1);
  });
});
