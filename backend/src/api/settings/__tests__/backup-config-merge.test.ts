import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { repos } from '../../../app-context';
import {
  createTestApp,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

function seedProvider(id: string, displayName: string): void {
  ctx.sqlite.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, status)
     VALUES (?, ?, 'storage', 'google-drive', ?, '', 'active')`,
    [id, ctx.user.id, displayName]
  );
}

interface SettingsBody {
  success: boolean;
  data: {
    backupConfig: {
      providers: Record<
        string,
        {
          enabled: boolean;
          folderPath: string;
          retentionCount: number;
          sheetsSyncEnabled?: boolean;
        }
      >;
    };
  };
}

function providerSettings(id: string, over: Record<string, unknown> = {}) {
  return { enabled: true, folderPath: `/Backups/${id}`, retentionCount: 7, ...over };
}

describe('PUT /settings backupConfig is merged per provider, not replaced wholesale', () => {
  test('a partial backupConfig PUT preserves providers it does not name', async () => {
    seedProvider('drive-a', 'Drive A');
    seedProvider('drive-b', 'Drive B');

    const seed = await ctx.authed('PUT', '/api/v1/settings', {
      backupConfig: {
        providers: {
          'drive-a': providerSettings('drive-a', { retentionCount: 5, sheetsSyncEnabled: true }),
          'drive-b': providerSettings('drive-b', { retentionCount: 9 }),
        },
      },
    });
    const seedBody = (await json<SettingsBody>(seed)) as SettingsBody;
    expect(seed.status, JSON.stringify(seedBody)).toBe(200);
    expect(Object.keys(seedBody.data.backupConfig.providers).sort()).toEqual([
      'drive-a',
      'drive-b',
    ]);

    const partial = await ctx.authed('PUT', '/api/v1/settings', {
      backupConfig: {
        providers: {
          'drive-b': providerSettings('drive-b', { retentionCount: 12 }),
        },
      },
    });
    const partialBody = (await json<SettingsBody>(partial)) as SettingsBody;
    expect(partial.status, JSON.stringify(partialBody)).toBe(200);

    const providers = partialBody.data.backupConfig.providers;
    expect(providers['drive-a'], 'drive-a must not be wiped by a partial PUT').toBeDefined();
    expect(providers['drive-a']?.retentionCount).toBe(5);
    expect(providers['drive-a']?.sheetsSyncEnabled).toBe(true);
    expect(providers['drive-b']?.retentionCount).toBe(12);
  });

  test('a named provider entry is replaced wholesale', async () => {
    seedProvider('drive-a', 'Drive A');

    await ctx.authed('PUT', '/api/v1/settings', {
      backupConfig: {
        providers: { 'drive-a': providerSettings('drive-a', { sheetsSyncEnabled: true }) },
      },
    });

    const res = await ctx.authed('PUT', '/api/v1/settings', {
      backupConfig: { providers: { 'drive-a': providerSettings('drive-a') } },
    });
    const body = (await json<SettingsBody>(res)) as SettingsBody;
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.backupConfig.providers['drive-a']?.sheetsSyncEnabled).toBeUndefined();
  });
});

describe('PUT /settings never overwrites server-owned backup fields', () => {
  test('a stale page-load copy keeps the server-written lastBackupAt and sheetsSpreadsheetId', async () => {
    seedProvider('drive-s', 'Drive S');
    await ctx.authed('PUT', '/api/v1/settings', {
      backupConfig: { providers: { 'drive-s': providerSettings('drive-s') } },
    });
    await repos().preferences.mergeJsonField(ctx.user.id, 'backupConfig', {
      providers: {
        'drive-s': { lastBackupAt: '2026-11-20T10:00:00.000Z', sheetsSpreadsheetId: 'sheet-live' },
      },
    });

    const res = await ctx.authed('PUT', '/api/v1/settings', {
      backupConfig: {
        providers: {
          'drive-s': providerSettings('drive-s', {
            retentionCount: 3,
            lastBackupAt: '2026-01-01T00:00:00.000Z',
          }),
        },
      },
    });
    expect(res.status).toBe(200);

    const stored = ctx.sqlite
      .query('SELECT backup_config FROM user_preferences WHERE user_id = ?')
      .get(ctx.user.id) as { backup_config: string };
    expect(JSON.parse(stored.backup_config).providers['drive-s']).toEqual({
      enabled: true,
      folderPath: '/Backups/drive-s',
      retentionCount: 3,
      lastBackupAt: '2026-11-20T10:00:00.000Z',
      sheetsSpreadsheetId: 'sheet-live',
    });
  });
});
