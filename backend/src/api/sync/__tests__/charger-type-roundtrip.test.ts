import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

async function seedCharges(): Promise<void> {
  const vehicleId = await seedVehicle(ctx, { make: 'Tesla', model: 'Y', year: 2023 });
  for (const [day, chargerType] of [
    ['01', 'home'],
    ['02', 'dc_fast'],
    ['03', null],
  ] as const) {
    const res = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'fuel',
      expenseAmount: 10,
      date: `2024-06-${day}T00:00:00.000Z`,
      mileage: 1000 + Number(day),
      volume: 30,
      fuelType: 'Electric',
      chargerType,
    });
    expect(res.status).toBe(201);
  }
}

function chargerTypes(): (string | null)[] {
  return (
    ctx.sqlite.query('SELECT charger_type FROM expenses ORDER BY date').all() as {
      charger_type: string | null;
    }[]
  ).map((row) => row.charger_type);
}

describe('charger type survives backup and restore', () => {
  test('a ZIP backup round-trips it, including an empty one', async () => {
    await seedCharges();
    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const zip = await backupService.exportAsZip(ctx.user.id);
    ctx.sqlite.run('UPDATE expenses SET charger_type = NULL');
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(chargerTypes()).toEqual(['home', 'dc_fast', null]);
  });

  test('restore turns an unknown charger type into none and keeps known ones', async () => {
    await seedCharges();
    ctx.sqlite.run("UPDATE expenses SET charger_type = 'garage' WHERE charger_type = 'dc_fast'");
    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const zip = await backupService.exportAsZip(ctx.user.id);
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(chargerTypes()).toEqual(['home', null, null]);
  });

  test('a Google Sheets mirror round-trips it', async () => {
    await seedCharges();
    const { FakeGoogleStore, makeFakeSheetsClients } = await import(
      '../../../test-helpers/fake-google-clients'
    );
    const sheetsModule = await import('../../providers/services/google-sheets-service');
    const svc = new sheetsModule.GoogleSheetsService(
      'fake-refresh-token',
      makeFakeSheetsClients(new FakeGoogleStore())
    );
    const info = await svc.createOrUpdateVroomSpreadsheet(ctx.user.id, 'VROOM', 'Owner');
    ctx.sqlite.run(
      `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, status)
       VALUES ('prov-sheets', ?, 'storage', 'google-drive', 'Drive', 'x', 'active')`,
      [ctx.user.id]
    );
    ctx.sqlite.run(
      `INSERT INTO user_preferences (user_id, backup_config) VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET backup_config = excluded.backup_config`,
      [
        ctx.user.id,
        JSON.stringify({ providers: { 'prov-sheets': { sheetsSpreadsheetId: info.id } } }),
      ]
    );
    ctx.sqlite.run('UPDATE expenses SET charger_type = NULL');

    const spy = spyOn(sheetsModule, 'createSheetsServiceForProvider').mockResolvedValue(svc);
    try {
      const { restoreService } = await import('../restore');
      const result = await restoreService.restoreFromSheets(ctx.user.id, 'prov-sheets', 'replace');
      expect(result.success, JSON.stringify(result)).toBe(true);
    } finally {
      spy.mockRestore();
    }
    expect(chargerTypes()).toEqual(['home', 'dc_fast', null]);
  });
});
