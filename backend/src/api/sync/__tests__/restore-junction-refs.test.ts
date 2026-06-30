/**
 * Security regression: restore must REJECT a backup whose junction row points at
 * an out-of-backup id, so a crafted backup can't link the importer's data to a
 * victim's existing rows.
 *
 * Cycle-145 stamps userId on owned rows, but junction tables (reminder_vehicles,
 * insurance_term_vehicles) carry no userId — they're scoped purely through their
 * FK ids. The safety guarantee is that validateReferentialIntegrity constrains
 * every junction ref to the backup's OWN id sets and hard-fails otherwise, so a
 * junction can never reference a row that isn't in the same (importer-stamped)
 * backup. This pins that: tamper an exported reminder_vehicles.csv to point at a
 * bogus vehicle id and assert restore is rejected, not silently inserted.
 *
 * createTestApp() rewrites env then dynamic-imports DB-bound modules; keep static
 * imports to the harness + bun:test and import backup/restore/adm-zip dynamically.
 */

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

    // Create a reminder linked to the vehicle → produces a reminder_vehicles junction row.
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

    // Restore must REJECT (referential-integrity hard-fail), not insert a junction
    // row pointing outside the backup. Assert it fails for the RIGHT reason — the
    // junction/vehicle referential check — not some unrelated error.
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

    // Validation runs BEFORE the (replace-mode) transaction, so a rejected
    // restore mutates nothing: the original seeded vehicle is untouched and the
    // bogus id never landed.
    const rows = ctx.sqlite.query('SELECT id FROM vehicles').all() as { id: string }[];
    expect(rows, 'rejected restore left the original data intact, no wipe').toHaveLength(1);
    expect(rows[0].id).toBe(vehicleId);
    expect(rows.some((r) => r.id === 'not-in-backup-vehicle')).toBe(false);
  });

  // C246: financing is the highest-stakes UN-stamped child — it carries NO userId column (it owns
  // purely via its vehicleId FK), so its ENTIRE ownership safety rests on validateFinancingRefs
  // constraining it to in-backup vehicleIds. If that ref-check regressed, a crafted backup could
  // attach a financing record to a vehicle outside the (importer-stamped) backup. Pins it the same
  // way as the junction case (the deep-review C246 certified the indirect-ownership model; this is
  // the merge-surviving net on its load-bearing assumption).
  test('a vehicle_financing row pointing at a bogus vehicle id is rejected', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });

    // Create financing on the vehicle → a vehicle_financing row referencing it.
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

  // C396: the expenses table carries (sourceType, sourceId) for system-materialized rows
  // (sourceType='reminder' → sourceId is a reminder id). validateExpenseSourceRefs (backup.ts:781)
  // hard-fails a restore if a 'reminder'-sourced expense points at a reminder NOT in the backup — the
  // expense-level sibling of the junction/financing ref checks above (the C246/C339 dangling-ref class).
  // Junction + financing refs are pinned; this expense-source ref was NOT. Pins it: tamper an exported
  // expenses.csv to repoint a reminder-sourced expense at a bogus reminder id → restore must reject.
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

    // Seed a reminder-MATERIALIZED expense directly (the system path; the manual route restricts
    // sourceType to 'financing'). source_type='reminder' + source_id=<the real reminder>.
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

    // Tamper: repoint the expense's source at a reminder id NOT in the backup.
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
