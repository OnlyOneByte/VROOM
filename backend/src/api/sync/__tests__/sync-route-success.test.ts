// Success and derivation paths of the sync routes, driven through the real routes over in-memory
// SQLite with no provider network: status flags, restore provider sourceTypes, the empty-backup
// success envelope, and the backup download.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, json, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

/** Seed (or replace) the user's backup_config JSON directly (the raw-seed pattern). */
function seedBackupConfig(config: unknown): void {
  ctx.sqlite.run('INSERT OR REPLACE INTO user_preferences (user_id, backup_config) VALUES (?, ?)', [
    ctx.user.id,
    JSON.stringify(config),
  ]);
}

/** Seed an active storage provider owned by the test user; returns its id. */
function seedStorageProvider(id: string, displayName = 'My Drive'): string {
  ctx.sqlite.run(
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
    seedBackupConfig({
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
    seedBackupConfig({
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
    const id = seedStorageProvider('prov-both');
    seedBackupConfig({
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
    // zip needs enabled+lastBackupAt; sheets needs sheetsSyncEnabled+sheetsSpreadsheetId. Neither holds
    // (enabled but never backed up) → sourceTypes empty → the provider is omitted from the list.
    seedStorageProvider('prov-empty');
    seedBackupConfig({
      providers: {
        'prov-empty': { enabled: true, folderPath: 'B', retentionCount: 5 }, // no lastBackupAt
      },
    });

    const res = await ctx.authed('GET', '/api/v1/sync/restore/providers');
    const body = await json<RestoreProvidersBody>(res);
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(0);
  });

  test('a provider with no backupConfig entry at all is skipped (continue branch)', async () => {
    seedStorageProvider('prov-unconfigured');
    // No seedBackupConfig → config.providers is empty → the provider has no config entry → continue.
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

// A backup where every provider failed must not return 200. A failing fake strategy is registered
// for the test and overwritten with a no-op afterwards.
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
      ctx.sqlite.run(
        `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, config, status)
         VALUES ('rf', ?, 'storage', 'fake-route-fail', 'Fake', ?, '{}', 'active')`,
        [ctx.user.id, encrypt(JSON.stringify({ refreshToken: 'x' }))]
      );
      ctx.sqlite.run(
        'INSERT OR REPLACE INTO user_preferences (user_id, backup_config) VALUES (?, ?)',
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
});

// Provider-free paths: the download exports the user's own data, and the list is empty when no
// backup provider is enabled.
describe('GET /api/v1/sync/backups/download — the manual backup-export route', () => {
  test('returns a real ZIP with the attachment headers (no provider needed — own-data export)', async () => {
    // Seed a row so the export has content (the user already exists via the harness).
    await ctx.authed('POST', '/api/v1/vehicles', { make: 'Toyota', model: 'Camry', year: 2022 });

    const res = await ctx.authed('GET', '/api/v1/sync/backups/download');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition') ?? '').toContain('attachment');
    expect(res.headers.get('content-disposition') ?? '').toContain('vroom-backup-');
    // A real ZIP body: the central-directory/local-file signature starts with 'PK', and
    // Content-Length matches the bytes.
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
