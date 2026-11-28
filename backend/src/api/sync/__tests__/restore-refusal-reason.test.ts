import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { CONFIG, getBackupTableKeys } from '../../../config';
import { ValidationError } from '../../../errors';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../../test-helpers/http-client';
import { BACKUP_CHECK_REASONS } from '../backup';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

async function seedSheetsProvider(): Promise<void> {
  await ctx.sql.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, status)
     VALUES ('prov-sheets', ?, 'storage', 'google-drive', 'Drive', 'x', 'active')`,
    [ctx.user.id]
  );
  await ctx.sql.run(
    `INSERT INTO user_preferences (user_id, backup_config) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET backup_config = excluded.backup_config`,
    [
      ctx.user.id,
      JSON.stringify({ providers: { 'prov-sheets': { sheetsSpreadsheetId: 'sheet-1' } } }),
    ]
  );
}

async function pausedAt(): Promise<unknown> {
  const row = (await ctx.sql.get('SELECT backup_config FROM user_preferences WHERE user_id = ?', [ctx.user.id])) as { backup_config: string };
  return JSON.parse(row.backup_config).providers['prov-sheets'].sheetsAutoPausedAt;
}

describe('a Sheets restore that fails before validation', () => {
  test('a spreadsheet that cannot be read still pauses automatic backups', async () => {
    await seedSheetsProvider();
    const sheetsModule = await import('../../providers/services/google-sheets-service');
    const spy = spyOn(sheetsModule, 'createSheetsServiceForProvider').mockResolvedValue({
      readSpreadsheetData: async () => {
        throw new ValidationError('Spreadsheet is missing the Vehicles tab');
      },
    } as never);
    try {
      const { restoreService } = await import('../restore');
      await expect(
        restoreService.restoreFromSheets(ctx.user.id, 'prov-sheets', 'preview')
      ).rejects.toThrow('missing the Vehicles tab');
      expect(typeof await pausedAt()).toBe('string');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('a refused Sheets restore', () => {
  test('leads with the plain reason, which says to copy the spreadsheet first', async () => {
    await ctx.sql.run(
      `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, status)
       VALUES ('prov-sheets', ?, 'storage', 'google-drive', 'Drive', 'x', 'active')`,
      [ctx.user.id]
    );
    await ctx.sql.run(
      `INSERT INTO user_preferences (user_id, backup_config) VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET backup_config = excluded.backup_config`,
      [
        ctx.user.id,
        JSON.stringify({ providers: { 'prov-sheets': { sheetsSpreadsheetId: 'sheet-1' } } }),
      ]
    );
    const tables = Object.fromEntries(getBackupTableKeys().map((key) => [key, []]));
    const sheet = {
      metadata: { version: CONFIG.backup.currentVersion, timestamp: '', userId: '' },
      ...tables,
    };
    const sheetsModule = await import('../../providers/services/google-sheets-service');
    const spy = spyOn(sheetsModule, 'createSheetsServiceForProvider').mockResolvedValue({
      readSpreadsheetData: async () => sheet,
    } as never);
    try {
      const { restoreService } = await import('../restore');
      const refused = await restoreService
        .restoreFromSheets(ctx.user.id, 'prov-sheets', 'preview')
        .then(
          () => null,
          (error: unknown) => error
        );
      expect(refused).toBeInstanceOf(ValidationError);
      const details = (refused as ValidationError).details as string[];
      expect(details[0]).toBe(BACKUP_CHECK_REASONS.sheets.metadata);
      expect(details[0]).toContain('use File\u00a0>\u00a0Make a copy');
      const row = (await ctx.sql.get('SELECT backup_config FROM user_preferences WHERE user_id = ?', [ctx.user.id])) as { backup_config: string };
      const settings = JSON.parse(row.backup_config).providers['prov-sheets'];
      expect(typeof settings.sheetsAutoPausedAt).toBe('string');
      expect(settings.sheetsSpreadsheetId).toBe('sheet-1');
    } finally {
      spy.mockRestore();
    }
  });
});
