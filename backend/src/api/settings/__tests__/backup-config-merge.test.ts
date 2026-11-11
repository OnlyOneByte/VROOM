/**
 * PUT /settings merges backupConfig per provider, so a partial PUT that names one provider must not
 * wipe the others. Runs through the HTTP stack; the providers are raw-seeded because ownership is
 * validated.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, json, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

/** Raw-seed an owned storage provider so its backupConfig entry passes the ownership check. */
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

    // Names only drive-b, as a client editing just that provider would.
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
    // drive-b is updated to the new value.
    expect(providers['drive-b']?.retentionCount).toBe(12);
  });

  test('a named provider entry is replaced wholesale', async () => {
    seedProvider('drive-a', 'Drive A');

    await ctx.authed('PUT', '/api/v1/settings', {
      backupConfig: {
        providers: { 'drive-a': providerSettings('drive-a', { sheetsSyncEnabled: true }) },
      },
    });

    // Re-PUT without sheetsSyncEnabled: the entry is replaced, so the flag is dropped.
    const res = await ctx.authed('PUT', '/api/v1/settings', {
      backupConfig: { providers: { 'drive-a': providerSettings('drive-a') } },
    });
    const body = (await json<SettingsBody>(res)) as SettingsBody;
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.backupConfig.providers['drive-a']?.sheetsSyncEnabled).toBeUndefined();
  });
});
