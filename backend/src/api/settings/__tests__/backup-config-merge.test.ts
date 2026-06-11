/**
 * PUT /settings backupConfig MERGE semantics (C237 bug → #82). The handler used to write backupConfig
 * WHOLESALE while storageConfig was merged — so a partial PUT naming only one provider silently WIPED
 * every other provider's backup settings (retentionCount / sheetsSyncEnabled / folderPath), a
 * data-loss trap (NORTH_STAR #1). The fix merges per-provider server-side (mergeBackupConfig, mirroring
 * mergeStorageConfig). These tests pin the merge through the REAL HTTP stack.
 *
 * Two OWNED storage providers are raw-seeded (validateBackupConfig requires ownership), then driven via
 * authed PUTs. createTestApp() rewrites env + dynamic-imports DB-bound modules, so imports stay limited
 * to the harness + bun:test.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, json, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

/** Raw-seed an owned storage provider so validateBackupConfig accepts it in backupConfig. */
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

describe('PUT /settings backupConfig is merged per-provider, not wholesale-replaced (#82)', () => {
  test('a partial backupConfig PUT preserves providers it does not name', async () => {
    seedProvider('drive-a', 'Drive A');
    seedProvider('drive-b', 'Drive B');

    // 1) Establish both providers in backupConfig (the full-map write the frontend does today).
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

    // 2) PUT a PARTIAL backupConfig naming ONLY drive-b (e.g. a client editing just that provider,
    //    or a stale-load race). Pre-fix this wiped drive-a entirely.
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
    // drive-a SURVIVES with its original settings (the regression: pre-fix it was gone).
    expect(providers['drive-a'], 'drive-a must not be wiped by a partial PUT').toBeDefined();
    expect(providers['drive-a']?.retentionCount).toBe(5);
    expect(providers['drive-a']?.sheetsSyncEnabled).toBe(true);
    // drive-b is updated to the new value.
    expect(providers['drive-b']?.retentionCount).toBe(12);
  });

  test('a named provider entry IS replaced wholesale (its settings are sent complete by the editor)', async () => {
    seedProvider('drive-a', 'Drive A');

    await ctx.authed('PUT', '/api/v1/settings', {
      backupConfig: {
        providers: { 'drive-a': providerSettings('drive-a', { sheetsSyncEnabled: true }) },
      },
    });

    // Re-PUT drive-a WITHOUT sheetsSyncEnabled — the entry is replaced, so the flag is dropped (the
    // per-provider settings object is a small fixed shape the editor always sends complete).
    const res = await ctx.authed('PUT', '/api/v1/settings', {
      backupConfig: { providers: { 'drive-a': providerSettings('drive-a') } },
    });
    const body = (await json<SettingsBody>(res)) as SettingsBody;
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.backupConfig.providers['drive-a']?.sheetsSyncEnabled).toBeUndefined();
  });
});
