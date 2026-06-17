/**
 * Security regression: restore must STAMP the importing user's id onto every
 * owned row, never trust the userId carried in the (untrusted) backup file.
 *
 * The only envelope check is validateUserId(metadata.userId, importer), and the
 * referential-integrity pass never covered the root tables (vehicles, insurance,
 * photos, preferences, syncState). So a crafted backup with metadata.userId = me
 * but a row whose userId = someone-else would, without stamping, insert a row
 * owned by another user. This proves the stamp: we tamper a real export's
 * vehicles.csv to carry a FOREIGN user_id, restore it as our user, and assert the
 * restored row is owned by US.
 *
 * createTestApp() rewrites env then dynamic-imports DB-bound modules; keep this
 * file's static imports to the harness + bun:test and import backup/restore +
 * adm-zip dynamically AFTER createTestApp so DB-bound singletons bind to the
 * throwaway DB.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

interface VehicleRowDb {
  id: string;
  user_id: string;
  make: string;
}

function vehicleRows(): VehicleRowDb[] {
  return ctx.sqlite.query('SELECT id, user_id, make FROM vehicles').all() as VehicleRowDb[];
}

interface PolicyRowDb {
  id: string;
  user_id: string;
  company: string;
}

function policyRows(): PolicyRowDb[] {
  return ctx.sqlite
    .query('SELECT id, user_id, company FROM insurance_policies')
    .all() as PolicyRowDb[];
}

describe('restore stamps the importer userId (cross-tenant write guard)', () => {
  test('a backup whose vehicle row carries a FOREIGN userId still restores as the importer', async () => {
    // Seed a vehicle for the importing (harness) user, then export a real ZIP.
    const created = await ctx.authed('POST', '/api/v1/vehicles', {
      make: 'Honda',
      model: 'Civic',
      year: 2021,
    });
    const createdBody = await json<DataEnvelope<{ id: string }>>(created);
    expect(created.status, JSON.stringify(createdBody)).toBeLessThan(300);
    const vehicleId = createdBody.data.id;

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const AdmZip = (await import('adm-zip')).default;

    const zip = await backupService.exportAsZip(ctx.user.id);

    // Insert a second user so the foreign user_id satisfies the FK (the attacker
    // would target a real, known victim id). Then tamper vehicles.csv to claim it.
    const { db } = await import('../../../db/connection');
    const schema = await import('../../../db/schema');
    const foreignId = 'victim-user-1';
    await db
      .insert(schema.users)
      .values({ id: foreignId, email: 'victim@test.com', displayName: 'Victim' });

    const archive = new AdmZip(zip);
    const vehiclesCsv = archive.getEntry('vehicles.csv')?.getData().toString('utf-8');
    expect(vehiclesCsv, 'export contains vehicles.csv').toBeTruthy();
    // Flip the owner column on the data row from our id to the victim's id.
    const tampered = (vehiclesCsv as string).split(ctx.user.id).join(foreignId);
    expect(tampered.includes(foreignId), 'tamper actually replaced the owner id').toBe(true);
    archive.updateFile('vehicles.csv', Buffer.from(tampered, 'utf-8'));
    const tamperedZip = archive.toBuffer();

    // Restore the tampered backup AS our user (metadata.userId is still ours, so
    // the envelope check passes — the attack is the per-row userId in the file).
    const result = await restoreService.restoreFromBackup(ctx.user.id, tamperedZip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);

    // The restored vehicle must be owned by US, not the victim. Pre-fix this
    // failed: the row kept the foreign user_id from the file.
    const rows = vehicleRows();
    expect(rows, 'exactly the one restored vehicle').toHaveLength(1);
    expect(rows[0].id).toBe(vehicleId);
    expect(rows[0].user_id, 'row must be stamped to the importer, not the file value').toBe(
      ctx.user.id
    );
    // And nothing landed under the victim.
    expect(rows.filter((r) => r.user_id === foreignId)).toHaveLength(0);
  });

  // C8 (deep-review): the stamp is applied to NINE directly-owned tables (vehicles, insurance,
  // reminders, reminderNotifications, expenses, odometer, userPreferences, syncState, photos), but only
  // `vehicles` was guarded above. A dropped `stampUserId(...)` wrapper on any OTHER insert (the exact
  // C3-class structural-invariant drift) would let a crafted backup plant a cross-tenant row with NO
  // test red. Picking the SECOND table to pin: verified firsthand which root tables the stamp SOLELY
  // protects — validateBackupData rejects a foreign userId on the LEAF tables (expenses/reminders user-
  // check against the metadata set, so they're belt-and-suspenders), but `validateInsuranceRefs` only
  // checks `id` presence, NOT userId. So `insurance_policies` is a genuine STAMP-ONLY defense root table
  // (exactly as the stampUserId docstring flags). Same tamper recipe on insurance_policies.csv.
  test('a backup whose INSURANCE row carries a FOREIGN userId still restores as the importer (stamp-only root table)', async () => {
    const vehRes = await ctx.authed('POST', '/api/v1/vehicles', {
      make: 'Honda',
      model: 'Accord',
      year: 2020,
    });
    const vehBody = await json<DataEnvelope<{ id: string }>>(vehRes);
    expect(vehRes.status, JSON.stringify(vehBody)).toBeLessThan(300);
    const vehicleId = vehBody.data.id;

    const polRes = await ctx.authed('POST', '/api/v1/insurance', {
      company: 'Acme Mutual',
      terms: [
        {
          startDate: '2024-01-01T00:00:00.000Z',
          endDate: '2024-12-31T00:00:00.000Z',
          policyNumber: 'POL-STAMP',
          totalCost: 1200,
          vehicleCoverage: { vehicleIds: [vehicleId] },
        },
      ],
    });
    const polBody = await json<DataEnvelope<{ id: string }>>(polRes);
    expect(polRes.status, JSON.stringify(polBody)).toBe(201);

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const AdmZip = (await import('adm-zip')).default;
    const zip = await backupService.exportAsZip(ctx.user.id);

    const { db } = await import('../../../db/connection');
    const schema = await import('../../../db/schema');
    const foreignId = 'victim-user-2';
    await db
      .insert(schema.users)
      .values({ id: foreignId, email: 'victim2@test.com', displayName: 'Victim2' });

    const archive = new AdmZip(zip);
    const policiesCsv = archive.getEntry('insurance_policies.csv')?.getData().toString('utf-8');
    expect(policiesCsv, 'export contains insurance_policies.csv').toBeTruthy();
    const tampered = (policiesCsv as string).split(ctx.user.id).join(foreignId);
    expect(tampered.includes(foreignId), 'tamper replaced the owner id in policies csv').toBe(true);
    archive.updateFile('insurance_policies.csv', Buffer.from(tampered, 'utf-8'));
    const tamperedZip = archive.toBuffer();

    const result = await restoreService.restoreFromBackup(ctx.user.id, tamperedZip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);

    // The restored policy must be owned by US — a dropped stamp on the insurance insert would land it
    // under the victim (cross-tenant write that validation does NOT catch for this table). Both directions.
    const rows = policyRows();
    expect(rows, 'exactly the one restored policy').toHaveLength(1);
    expect(rows[0].id).toBe(polBody.data.id);
    expect(rows[0].user_id, 'policy row must be stamped to the importer, not the file value').toBe(
      ctx.user.id
    );
    expect(rows.filter((r) => r.user_id === foreignId)).toHaveLength(0);
  });

  test('a normal (untampered) backup still round-trips intact', async () => {
    // Guard that stamping is a no-op for legitimate backups.
    const created = await ctx.authed('POST', '/api/v1/vehicles', {
      make: 'Toyota',
      model: 'Camry',
      year: 2022,
    });
    const createdBody = await json<DataEnvelope<{ id: string }>>(created);
    expect(created.status, JSON.stringify(createdBody)).toBeLessThan(300);
    const vehicleId = createdBody.data.id;

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const zip = await backupService.exportAsZip(ctx.user.id);
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');

    expect(result.success, JSON.stringify(result)).toBe(true);
    const rows = vehicleRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(vehicleId);
    expect(rows[0].user_id).toBe(ctx.user.id);
    expect(rows[0].make).toBe('Toyota');
  });
});
