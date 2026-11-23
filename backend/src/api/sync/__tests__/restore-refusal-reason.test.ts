import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { CONFIG, getBackupTableKeys } from '../../../config';
import { ValidationError } from '../../../errors';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';
import { BACKUP_CHECK_REASONS } from '../backup';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

describe('a refused Sheets restore', () => {
  test('leads with the plain reason, which says to keep the backup and cancel', async () => {
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
      expect(details[0]).toBe(BACKUP_CHECK_REASONS.metadata);
      expect(details[0]).toContain('select Cancel');
    } finally {
      spy.mockRestore();
    }
  });
});
