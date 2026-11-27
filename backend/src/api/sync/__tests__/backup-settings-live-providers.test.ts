import { AsyncLocalStorage } from 'node:async_hooks';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

const PROVIDER = 'gone-p';

async function seedProvider(saved: Record<string, unknown>): Promise<void> {
  const { encrypt } = await import('../../../utils/encryption');
  const credentials = encrypt(JSON.stringify({ refreshToken: 'fake' }), {
    rowId: PROVIDER,
    userId: ctx.user.id,
    domain: 'storage',
  });
  ctx.sqlite.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, config, status)
     VALUES (?, ?, 'storage', 'google-drive', 'Drive', ?, '{}', 'active')`,
    [PROVIDER, ctx.user.id, credentials]
  );
  ctx.sqlite.run('INSERT OR REPLACE INTO user_preferences (user_id, backup_config) VALUES (?, ?)', [
    ctx.user.id,
    JSON.stringify({ providers: { [PROVIDER]: saved } }),
  ]);
}

function savedEntry(): unknown {
  const row = ctx.sqlite
    .query('SELECT backup_config FROM user_preferences WHERE user_id = ?')
    .get(ctx.user.id) as { backup_config: string | null };
  const config = row.backup_config ? JSON.parse(row.backup_config) : {};
  return config.providers?.[PROVIDER];
}

async function removeProviderJustBeforeTheWrite(run: () => Promise<unknown>): Promise<void> {
  const { repos } = await import('../../../app-context');
  const preferences = repos().preferences;
  const write = preferences.mergeJsonField.bind(preferences);
  const outside = AsyncLocalStorage.snapshot();
  let removal: Promise<Response> | undefined;
  preferences.mergeJsonField = async (...args) => {
    const providers = (args[2] as { providers?: Record<string, unknown> }).providers;
    if (!removal && providers?.[PROVIDER] !== null && providers?.[PROVIDER] !== undefined) {
      removal = outside(() => ctx.authed('DELETE', `/api/v1/providers/${PROVIDER}`));
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return write(...args);
  };
  try {
    await run();
    expect(removal).toBeDefined();
    expect((await removal)?.status).toBe(204);
  } finally {
    preferences.mergeJsonField = write;
  }
}

describe('Writers of backup settings leave nothing behind for a provider removed mid-write', () => {
  test('resuming paused Sheets backups', async () => {
    await seedProvider({ enabled: true, sheetsAutoPausedAt: '2026-11-01T00:00:00.000Z' });

    await removeProviderJustBeforeTheWrite(async () => {
      const res = await ctx.authed('POST', `/api/v1/sync/sheets/${PROVIDER}/resume`);
      expect(res.status).toBe(200);
    });

    expect(savedEntry()).toBeUndefined();
  });

  test('a failed restore from Sheets pausing Sheets backups', async () => {
    await seedProvider({ enabled: true, sheetsSpreadsheetId: 'sheet-1' });
    const { restoreService } = await import('../restore');
    const service = restoreService as unknown as { readSheetsAndRestore: () => Promise<never> };
    const read = service.readSheetsAndRestore;
    service.readSheetsAndRestore = () => Promise.reject(new Error('Spreadsheet not found'));

    try {
      await removeProviderJustBeforeTheWrite(async () => {
        await expect(
          restoreService.restoreFromSheets(ctx.user.id, PROVIDER, 'preview')
        ).rejects.toThrow('Spreadsheet not found');
      });
    } finally {
      service.readSheetsAndRestore = read;
    }

    expect(savedEntry()).toBeUndefined();
  });

  test('saving settings', async () => {
    await seedProvider({ enabled: false, folderPath: 'Backups', retentionCount: 10 });

    await removeProviderJustBeforeTheWrite(async () => {
      const res = await ctx.authed('PUT', '/api/v1/settings', {
        backupConfig: {
          providers: { [PROVIDER]: { enabled: true, folderPath: 'Mine', retentionCount: 3 } },
        },
      });
      expect(res.status).toBe(200);
    });

    expect(savedEntry()).toBeUndefined();
  });
});
