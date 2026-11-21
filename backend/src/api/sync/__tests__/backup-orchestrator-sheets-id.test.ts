import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
  const { encrypt } = await import('../../../utils/encryption');
  ctx.sqlite.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, config, status)
     VALUES ('p-zipfail', ?, 'storage', 'fake-zip-fails', 'Drive', ?, '{}', 'active')`,
    [ctx.user.id, encrypt(JSON.stringify({ refreshToken: 'fake' }))]
  );
  ctx.sqlite.run('INSERT OR REPLACE INTO user_preferences (user_id, backup_config) VALUES (?, ?)', [
    ctx.user.id,
    JSON.stringify({
      providers: {
        'p-zipfail': { enabled: true, folderPath: 'B', retentionCount: 5, sheetsSyncEnabled: true },
      },
    }),
  ]);
  const { backupStrategyRegistry } = await import('../backup-strategy-registry');
  backupStrategyRegistry.register('fake-zip-fails', {
    execute: () =>
      Promise.resolve({
        success: false,
        message: 'zip upload failed',
        capabilities: {
          zip: { success: false, message: 'zip upload failed' },
          sheets: { success: true, metadata: { spreadsheetId: 'sheet-works' } },
        },
      }),
  });
});
afterEach(() => ctx.close());

describe('a working Sheets backup is findable even when the ZIP upload fails', () => {
  test('the spreadsheet id is saved, lastBackupAt is not', async () => {
    const { backupOrchestrator } = await import('../backup-orchestrator');
    const result = await backupOrchestrator.execute(ctx.user.id, 'Test User', true);
    expect(result.outcome).toBe('failed');

    const stored = ctx.sqlite
      .query('SELECT backup_config FROM user_preferences WHERE user_id = ?')
      .get(ctx.user.id) as { backup_config: string };
    const entry = JSON.parse(stored.backup_config).providers['p-zipfail'];
    expect(entry.sheetsSpreadsheetId).toBe('sheet-works');
    expect(entry.lastBackupAt).toBeUndefined();
  });
});
