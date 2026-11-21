import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import AdmZip from 'adm-zip';
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

    const result = await restoreService.restoreFromBackup(ctx.user.id, tamperedZip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);

    const rows = vehicleRows();
    expect(rows, 'exactly the one restored vehicle').toHaveLength(1);
    expect(rows[0].id).toBe(vehicleId);
    expect(rows[0].user_id, 'row must be stamped to the importer, not the file value').toBe(
      ctx.user.id
    );
    expect(rows.filter((r) => r.user_id === foreignId)).toHaveLength(0);
  });

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

    const rows = policyRows();
    expect(rows, 'exactly the one restored policy').toHaveLength(1);
    expect(rows[0].id).toBe(polBody.data.id);
    expect(rows[0].user_id, 'policy row must be stamped to the importer, not the file value').toBe(
      ctx.user.id
    );
    expect(rows.filter((r) => r.user_id === foreignId)).toHaveLength(0);
  });

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

    const rows = photoRows();
    expect(rows, 'exactly the one restored photo').toHaveLength(1);
    expect(rows[0].id).toBe('photo-stamp-1');
    expect(rows[0].user_id, 'photo row must be stamped to the importer, not the file value').toBe(
      ctx.user.id
    );
    expect(rows.filter((r) => r.user_id === foreignId)).toHaveLength(0);
  });

  test('a normal (untampered) backup still round-trips intact', async () => {
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

describe('restore after the account record is recreated (same person, new user id)', () => {
  async function seedOwnerData(): Promise<string> {
    const created = await ctx.authed('POST', '/api/v1/vehicles', {
      make: 'Mazda',
      model: '3',
      year: 2018,
    });
    const body = await json<DataEnvelope<{ id: string }>>(created);
    expect(created.status, JSON.stringify(body)).toBeLessThan(300);
    ctx.sqlite.run(
      `INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount)
       VALUES ('exp-reinstall-1', ?, ?, 'fuel', 1700000000, 4200)`,
      [body.data.id, ctx.user.id]
    );
    return body.data.id;
  }

  function reinstallAsNewAccount(): string {
    const newId = `${ctx.user.id}-reinstalled`;
    ctx.sqlite.run('DELETE FROM users WHERE id = ?', [ctx.user.id]);
    ctx.sqlite.run('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)', [
      newId,
      ctx.user.email,
      ctx.user.displayName,
    ]);
    return newId;
  }

  test('a ZIP exported by the old account record restores into the new one', async () => {
    const vehicleId = await seedOwnerData();
    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const zip = await backupService.exportAsZip(ctx.user.id);

    const newId = reinstallAsNewAccount();
    expect(vehicleRows(), 'reinstall starts from an empty account').toHaveLength(0);

    const preview = await restoreService.restoreFromBackup(newId, zip, 'preview');
    expect(preview.preview?.vehicles).toBe(1);

    const result = await restoreService.restoreFromBackup(newId, zip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);

    const rows = vehicleRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(vehicleId);
    expect(rows[0].user_id).toBe(newId);
    const expense = ctx.sqlite
      .query('SELECT user_id, expense_amount FROM expenses WHERE id = ?')
      .get('exp-reinstall-1') as { user_id: string; expense_amount: number };
    expect(expense).toEqual({ user_id: newId, expense_amount: 4200 });
  });

  test('a pre-cents 1.0.0 ZIP from an old account record restores into the new one', async () => {
    const oldId = ctx.user.id;
    const zip = new AdmZip();
    zip.addFile(
      'metadata.json',
      Buffer.from(
        JSON.stringify({ version: '1.0.0', timestamp: new Date(0).toISOString(), userId: oldId }),
        'utf-8'
      )
    );
    zip.addFile(
      'vehicles.csv',
      Buffer.from(`id,userId,make,model,year\n"v-old","${oldId}","Ford","Focus","2012"\n`, 'utf-8')
    );
    zip.addFile(
      'expenses.csv',
      Buffer.from(
        `id,vehicleId,userId,category,date,expenseAmount\n"e-old","v-old","${oldId}","fuel","${new Date(1600000000000).toISOString()}","12.34"\n`,
        'utf-8'
      )
    );
    for (const f of ['vehicle_financing.csv', 'insurance_policies.csv']) {
      zip.addFile(f, Buffer.from('id\n', 'utf-8'));
    }

    const newId = reinstallAsNewAccount();
    const { restoreService } = await import('../restore');
    const result = await restoreService.restoreFromBackup(newId, zip.toBuffer(), 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);

    const expense = ctx.sqlite
      .query('SELECT user_id, expense_amount FROM expenses WHERE id = ?')
      .get('e-old') as { user_id: string; expense_amount: number };
    expect(expense).toEqual({ user_id: newId, expense_amount: 1234 });
  });

  test('a Sheets mirror written by the old account record restores into the new one', async () => {
    const vehicleId = await seedOwnerData();
    const { FakeGoogleStore, makeFakeSheetsClients } = await import(
      '../../../test-helpers/fake-google-clients'
    );
    const sheetsModule = await import('../../providers/services/google-sheets-service');
    const svc = new sheetsModule.GoogleSheetsService(
      'fake-refresh-token',
      makeFakeSheetsClients(new FakeGoogleStore())
    );
    ctx.sqlite.run(
      `INSERT INTO user_preferences (user_id, backup_config, storage_config) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET backup_config = excluded.backup_config, storage_config = excluded.storage_config`,
      [
        ctx.user.id,
        JSON.stringify({
          providers: { 'prov-old': { enabled: true, sheetsSpreadsheetId: 'old' } },
        }),
        JSON.stringify({
          defaults: {
            vehicle_photos: 'prov-old',
            expense_receipts: null,
            insurance_docs: null,
            odometer_readings: null,
          },
          providerCategories: { 'prov-old': {} },
        }),
      ]
    );
    const info = await svc.createOrUpdateVroomSpreadsheet(ctx.user.id, 'VROOM', 'Owner');

    const newId = reinstallAsNewAccount();
    ctx.sqlite.run(
      `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, status)
       VALUES ('prov-reinstall', ?, 'storage', 'google-drive', 'Drive', 'x', 'active')`,
      [newId]
    );
    ctx.sqlite.run('INSERT INTO user_preferences (user_id, backup_config) VALUES (?, ?)', [
      newId,
      JSON.stringify({ providers: { 'prov-reinstall': { sheetsSpreadsheetId: info.id } } }),
    ]);

    const spy = spyOn(sheetsModule, 'createSheetsServiceForProvider').mockResolvedValue(svc);
    try {
      const { restoreService } = await import('../restore');
      const result = await restoreService.restoreFromSheets(newId, 'prov-reinstall', 'replace');
      expect(result.success, JSON.stringify(result)).toBe(true);
    } finally {
      spy.mockRestore();
    }

    const rows = vehicleRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(vehicleId);
    expect(rows[0].user_id).toBe(newId);

    const prefs = ctx.sqlite
      .query('SELECT backup_config, storage_config FROM user_preferences WHERE user_id = ?')
      .get(newId) as { backup_config: string; storage_config: string };
    expect(
      JSON.parse(prefs.backup_config),
      'the new provider keeps its backup settings; the old one is dropped'
    ).toEqual({ providers: { 'prov-reinstall': { sheetsSpreadsheetId: info.id } } });
    const storage = JSON.parse(prefs.storage_config);
    expect(storage.defaults.vehicle_photos).toBeNull();
    expect(storage.providerCategories).toEqual({});
  });

  test('a Replace restore of a backup without preferences keeps the account settings', async () => {
    const newId = reinstallAsNewAccount();
    const backupConfig = { providers: { 'prov-live': { enabled: true, folderPath: 'VROOM' } } };
    ctx.sqlite.run(
      'INSERT INTO user_preferences (user_id, currency_unit, backup_config) VALUES (?, ?, ?)',
      [newId, 'EUR', JSON.stringify(backupConfig)]
    );
    const zip = new AdmZip();
    zip.addFile(
      'metadata.json',
      Buffer.from(
        JSON.stringify({ version: '1.0.0', timestamp: new Date(0).toISOString(), userId: 'old' }),
        'utf-8'
      )
    );
    zip.addFile(
      'vehicles.csv',
      Buffer.from('id,userId,make,model,year\n"v-np","old","Fiat","Panda","2010"\n', 'utf-8')
    );
    for (const f of ['expenses.csv', 'vehicle_financing.csv', 'insurance_policies.csv']) {
      zip.addFile(f, Buffer.from('id\n', 'utf-8'));
    }

    const { restoreService } = await import('../restore');
    const result = await restoreService.restoreFromBackup(newId, zip.toBuffer(), 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);

    const prefs = ctx.sqlite
      .query('SELECT currency_unit, backup_config FROM user_preferences WHERE user_id = ?')
      .get(newId) as { currency_unit: string; backup_config: string } | null;
    expect(prefs?.currency_unit).toBe('EUR');
    expect(JSON.parse(prefs?.backup_config ?? 'null')).toEqual(backupConfig);
    expect(vehicleRows().map((r) => r.id)).toEqual(['v-np']);
  });

  test("another tenant's backup cannot overwrite or steal that tenant's live rows", async () => {
    const vehicleId = await seedOwnerData();
    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const zip = await backupService.exportAsZip(ctx.user.id);

    const intruderId = 'intruder-user';
    ctx.sqlite.run('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)', [
      intruderId,
      'intruder@test.com',
      'Intruder',
    ]);

    await expect(restoreService.restoreFromBackup(intruderId, zip, 'replace')).rejects.toThrow(
      'UNIQUE constraint failed'
    );
    await expect(restoreService.restoreFromBackup(intruderId, zip, 'merge')).rejects.toThrow(
      'UNIQUE constraint failed'
    );

    const rows = vehicleRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(vehicleId);
    expect(rows[0].user_id, 'the live owner keeps their vehicle').toBe(ctx.user.id);
  });
});
