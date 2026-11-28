import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
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

async function seedBackupConfig(config: unknown): Promise<void> {
  await ctx.sql.run(
    'INSERT INTO user_preferences (user_id, backup_config) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET backup_config = excluded.backup_config',
    [ctx.user.id, JSON.stringify(config)]
  );
}

async function seedStorageProvider(id: string, displayName = 'My Drive'): Promise<string> {
  await ctx.sql.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, config, status)
     VALUES (?, ?, 'storage', 'google-drive', ?, 'enc', ?, 'active')`,
    [id, ctx.user.id, displayName, JSON.stringify({ accountEmail: 'me@example.com' })]
  );
  return id;
}

interface StatusBody {
  success: boolean;
  data: {
    backupEnabled: boolean;
    sheetsSyncEnabled: boolean;
    syncOnInactivity: boolean;
    lastSyncDate: string | null;
  };
}

describe('GET /api/v1/sync/status — derived flags from backupConfig', () => {
  test('no backupConfig → both flags false, but a shaped 200 (getOrCreate default)', async () => {
    const res = await ctx.authed('GET', '/api/v1/sync/status');
    const body = await json<StatusBody>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.backupEnabled).toBe(false);
    expect(body.data.sheetsSyncEnabled).toBe(false);
    expect(typeof body.data.syncOnInactivity).toBe('boolean');
  });

  test('a provider with enabled=true → backupEnabled true; sheetsSyncEnabled reflects its own flag', async () => {
    await seedBackupConfig({
      providers: {
        p1: { enabled: true, folderPath: 'B', retentionCount: 5, sheetsSyncEnabled: false },
      },
    });
    const res = await ctx.authed('GET', '/api/v1/sync/status');
    const body = await json<StatusBody>(res);
    expect(res.status).toBe(200);
    expect(body.data.backupEnabled).toBe(true);
    expect(body.data.sheetsSyncEnabled).toBe(false);
  });

  test('a Sheets-only provider (enabled=false, sheetsSyncEnabled=true) → backupEnabled false, sheets true', async () => {
    await seedBackupConfig({
      providers: {
        p1: { enabled: false, folderPath: 'B', retentionCount: 5, sheetsSyncEnabled: true },
      },
    });
    const res = await ctx.authed('GET', '/api/v1/sync/status');
    const body = await json<StatusBody>(res);
    expect(body.data.backupEnabled).toBe(false);
    expect(body.data.sheetsSyncEnabled).toBe(true);
  });
});

interface RestoreProvidersBody {
  success: boolean;
  data: Array<{ providerId: string; sourceTypes: string[]; accountEmail: string }>;
}

describe('GET /api/v1/sync/restore/providers — sourceTypes derivation', () => {
  test('a provider with a completed ZIP backup AND a sheets spreadsheet offers both sourceTypes', async () => {
    const id = await seedStorageProvider('prov-both');
    await seedBackupConfig({
      providers: {
        'prov-both': {
          enabled: true,
          folderPath: 'B',
          retentionCount: 5,
          lastBackupAt: '2024-06-01T00:00:00Z',
          sheetsSyncEnabled: true,
          sheetsSpreadsheetId: 'sheet-1',
        },
      },
    });

    const res = await ctx.authed('GET', '/api/v1/sync/restore/providers');
    const body = await json<RestoreProvidersBody>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.providerId).toBe(id);
    expect(body.data[0]?.sourceTypes.sort()).toEqual(['sheets', 'zip']);
    expect(body.data[0]?.accountEmail).toBe('me@example.com');
  });

  test('a provider enabled but with NO lastBackupAt (and no sheets) offers NO sourceTypes → skipped', async () => {
    await seedStorageProvider('prov-empty');
    await seedBackupConfig({
      providers: {
        'prov-empty': { enabled: true, folderPath: 'B', retentionCount: 5 },
      },
    });

    const res = await ctx.authed('GET', '/api/v1/sync/restore/providers');
    const body = await json<RestoreProvidersBody>(res);
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(0);
  });

  test('a provider with no backupConfig entry at all is skipped (continue branch)', async () => {
    await seedStorageProvider('prov-unconfigured');
    const res = await ctx.authed('GET', '/api/v1/sync/restore/providers');
    const body = await json<RestoreProvidersBody>(res);
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(0);
  });
});

describe('POST /api/v1/sync — success envelope', () => {
  test('valid syncTypes with NO enabled providers → 200 success (orchestrator no-op)', async () => {
    const res = await ctx.authed('POST', '/api/v1/sync', { syncTypes: ['backup'] });
    const body = await json<{ success: boolean; message: string; data: { results: unknown } }>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.results).toBeDefined();
  });
});

describe('POST /api/v1/sync — honest HTTP status on backup failure', () => {
  test('all providers fail → 502 error envelope (not a 200 false success)', async () => {
    const { backupStrategyRegistry } = await import('../backup-strategy-registry');
    const { encrypt } = await import('../../../utils/encryption');
    backupStrategyRegistry.register('fake-route-fail', {
      async execute() {
        return { success: false, message: 'boom', capabilities: { zip: { success: false } } };
      },
    });
    try {
      await ctx.sql.run(
        `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, config, status)
         VALUES ('rf', ?, 'storage', 'fake-route-fail', 'Fake', ?, '{}', 'active')`,
        [
          ctx.user.id,
          encrypt(JSON.stringify({ refreshToken: 'x' }), {
            rowId: 'rf',
            userId: ctx.user.id,
            domain: 'storage',
          }),
        ]
      );
      await ctx.sql.run(
        'INSERT INTO user_preferences (user_id, backup_config) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET backup_config = excluded.backup_config',
        [
          ctx.user.id,
          JSON.stringify({
            providers: { rf: { enabled: true, folderPath: 'B', retentionCount: 5 } },
          }),
        ]
      );

      const res = await ctx.authed('POST', '/api/v1/sync', { syncTypes: ['backup'], force: true });
      const body = await json<{ success: boolean; error?: { code: string } }>(res);
      expect(res.status, JSON.stringify(body)).toBe(502);
      expect(body.success).toBe(false);
      expect(body.error?.code).toBe('BACKUP_FAILED');
    } finally {
      backupStrategyRegistry.register('fake-route-fail', {
        async execute() {
          return { success: true, capabilities: {} };
        },
      });
    }
  });

  test('the only enabled provider has unreadable credentials → 502 naming it as unusable, not a no-op', async () => {
    const { backupStrategyRegistry } = await import('../backup-strategy-registry');
    backupStrategyRegistry.register('fake-route-unusable', {
      async execute() {
        return { success: true, capabilities: {} };
      },
    });
    await ctx.sql.run(
      `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, config, status)
       VALUES ('ru', ?, 'storage', 'fake-route-unusable', 'Fake', 'not-a-ciphertext', '{}', 'active')`,
      [ctx.user.id]
    );
    await ctx.sql.run(
      'INSERT INTO user_preferences (user_id, backup_config) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET backup_config = excluded.backup_config',
      [
        ctx.user.id,
        JSON.stringify({
          providers: { ru: { enabled: true, folderPath: 'B', retentionCount: 5 } },
        }),
      ]
    );

    const res = await ctx.authed('POST', '/api/v1/sync', { syncTypes: ['backup'], force: true });
    const body = await json<{
      error?: {
        code: string;
        details?: {
          failedProviders: string[];
          results: Record<string, { success: boolean; unusable?: boolean }>;
        };
      };
    }>(res);
    expect(res.status, JSON.stringify(body)).toBe(502);
    expect(body.error?.code).toBe('BACKUP_FAILED');
    expect(body.error?.details?.failedProviders).toEqual(['ru']);
    expect(body.error?.details?.results.ru).toMatchObject({ success: false, unusable: true });
  });
});

describe('GET /api/v1/sync/backups/download — the manual backup-export route', () => {
  test('returns a real ZIP with the attachment headers (no provider needed — own-data export)', async () => {
    await ctx.authed('POST', '/api/v1/vehicles', { make: 'Toyota', model: 'Camry', year: 2022 });

    const res = await ctx.authed('GET', '/api/v1/sync/backups/download');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition') ?? '').toContain('attachment');
    expect(res.headers.get('content-disposition') ?? '').toContain('vroom-backup-');
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(res.headers.get('content-length')).toBe(String(buf.length));
  });

  test('rejects an unauthenticated download (401)', async () => {
    const res = await ctx.anon('GET', '/api/v1/sync/backups/download');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/sync/backups/providers — list backups', () => {
  test('no enabled providers → 200 with an empty list (listAllBackups no-op)', async () => {
    const res = await ctx.authed('GET', '/api/v1/sync/backups/providers');
    const body = await json<{ success: boolean; data: unknown[] }>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
  });
});

describe('backupService.listAllBackups', () => {
  async function seedProvider(id: string, displayName: string): Promise<void> {
    await ctx.sql.run(
      `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, status)
       VALUES (?, ?, 'storage', 's3', ?, 'enc', 'active')`,
      [id, ctx.user.id, displayName]
    );
  }

  async function listWith(providerIds: string[]) {
    const { backupService } = await import('../backup');
    const providers = Object.fromEntries(providerIds.map((id) => [id, { enabled: true }]));
    const config = spyOn(backupService, 'loadBackupConfig').mockResolvedValue({
      providers,
    } as never);
    const list = spyOn(backupService, 'listBackups').mockImplementation(async (_u, providerId) => {
      if (providerId === 'p-broken') throw new Error('listing failed');
      return [];
    });
    const prepare = spyOn(ctx.sqlite, 'prepare');
    try {
      const results = await backupService.listAllBackups(ctx.user.id);
      return { results, statements: prepare.mock.calls.length };
    } finally {
      prepare.mockRestore();
      list.mockRestore();
      config.mockRestore();
    }
  }

  test('loads provider rows in one query however many providers back up', async () => {
    await seedProvider('p-1', 'One');
    await seedProvider('p-2', 'Two');
    await seedProvider('p-3', 'Three');
    const one = await listWith(['p-1']);
    const three = await listWith(['p-1', 'p-2', 'p-3']);
    expect(three.statements).toBe(one.statements);
    expect(three.results.map((r) => r.providerName)).toEqual(['One', 'Two', 'Three']);
  });

  test('a missing provider row falls back to Unknown and a failing listing gets its own error entry', async () => {
    await seedProvider('p-broken', 'Broken');
    const { results } = await listWith(['p-gone', 'p-broken']);
    expect(results[0]).toMatchObject({
      providerId: 'p-gone',
      providerName: 'Unknown',
      backups: [],
    });
    expect(results[1]).toMatchObject({ providerId: 'p-broken', error: 'listing failed' });
  });
});
