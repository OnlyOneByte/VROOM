// Restore must stamp the importer's userId onto every owned row and never trust the userId in the
// backup file. Validation only checks the envelope, so a tampered row would otherwise land under
// another user.

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

interface PhotoRowDb {
  id: string;
  user_id: string;
  entity_id: string;
}

function photoRows(): PhotoRowDb[] {
  return ctx.sqlite.query('SELECT id, user_id, entity_id FROM photos').all() as PhotoRowDb[];
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

    // The foreign user must exist to satisfy the FK.
    const { db } = await import('../../../db/connection');
    const schema = await import('../../../db/schema');
    const foreignId = 'victim-user-1';
    await db
      .insert(schema.users)
      .values({ id: foreignId, email: 'victim@test.com', displayName: 'Victim' });

    const archive = new AdmZip(zip);
    const vehiclesCsv = archive.getEntry('vehicles.csv')?.getData().toString('utf-8');
    expect(vehiclesCsv, 'export contains vehicles.csv').toBeTruthy();
    const tampered = (vehiclesCsv as string).split(ctx.user.id).join(foreignId);
    expect(tampered.includes(foreignId), 'tamper actually replaced the owner id').toBe(true);
    archive.updateFile('vehicles.csv', Buffer.from(tampered, 'utf-8'));
    const tamperedZip = archive.toBuffer();

    // metadata.userId stays the importer's, so the envelope check passes.
    const result = await restoreService.restoreFromBackup(ctx.user.id, tamperedZip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);

    // The restored row must be owned by the importer.
    const rows = vehicleRows();
    expect(rows, 'exactly the one restored vehicle').toHaveLength(1);
    expect(rows[0].id).toBe(vehicleId);
    expect(rows[0].user_id, 'row must be stamped to the importer, not the file value').toBe(
      ctx.user.id
    );
    expect(rows.filter((r) => r.user_id === foreignId)).toHaveLength(0);
  });

  // Validation does not check userId on insurance policies, so the stamp is their only defense.
  test('a backup whose insurance row carries a foreign userId still restores as the importer', async () => {
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

    // The restored policy must be owned by the importer.
    const rows = policyRows();
    expect(rows, 'exactly the one restored policy').toHaveLength(1);
    expect(rows[0].id).toBe(polBody.data.id);
    expect(rows[0].user_id, 'policy row must be stamped to the importer, not the file value').toBe(
      ctx.user.id
    );
    expect(rows.filter((r) => r.user_id === foreignId)).toHaveLength(0);
  });

  // Photo validation does not check userId, so the stamp is the only defense here.
  test('a backup whose photo row carries a foreign userId still restores as the importer', async () => {
    const vehRes = await ctx.authed('POST', '/api/v1/vehicles', {
      make: 'Honda',
      model: 'CR-V',
      year: 2019,
    });
    const vehBody = await json<DataEnvelope<{ id: string }>>(vehRes);
    expect(vehRes.status, JSON.stringify(vehBody)).toBeLessThan(300);
    const vehicleId = vehBody.data.id;

    ctx.sqlite.run(
      `INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size)
       VALUES ('photo-stamp-1', ?, 'vehicle', ?, 'car.jpg', 'image/jpeg', 4096)`,
      [ctx.user.id, vehicleId]
    );

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const AdmZip = (await import('adm-zip')).default;
    const zip = await backupService.exportAsZip(ctx.user.id);

    const { db } = await import('../../../db/connection');
    const schema = await import('../../../db/schema');
    const foreignId = 'victim-user-3';
    await db
      .insert(schema.users)
      .values({ id: foreignId, email: 'victim3@test.com', displayName: 'Victim3' });

    const archive = new AdmZip(zip);
    const photosCsv = archive.getEntry('photos.csv')?.getData().toString('utf-8');
    expect(photosCsv, 'export contains photos.csv').toBeTruthy();
    const tampered = (photosCsv as string).split(ctx.user.id).join(foreignId);
    expect(tampered.includes(foreignId), 'tamper replaced the owner id in photos.csv').toBe(true);
    archive.updateFile('photos.csv', Buffer.from(tampered, 'utf-8'));
    const tamperedZip = archive.toBuffer();

    const result = await restoreService.restoreFromBackup(ctx.user.id, tamperedZip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);

    // The restored photo must be owned by the importer.
    const rows = photoRows();
    expect(rows, 'exactly the one restored photo').toHaveLength(1);
    expect(rows[0].id).toBe('photo-stamp-1');
    expect(rows[0].user_id, 'photo row must be stamped to the importer, not the file value').toBe(
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
