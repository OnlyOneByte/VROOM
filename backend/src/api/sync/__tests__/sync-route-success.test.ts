/**
 * HTTP success-path coverage for sync/routes.ts (C188 guard ratchet — the 31%-line low spot).
 *
 * sync-route-errors.test.ts (C30/C36) pins the ERROR paths (validation 400s, auth 401, health). This
 * complements it with the uncovered SUCCESS/derivation handlers — all pure DB-read + in-handler
 * derivation, so they drive the REAL routes via createTestApp() over in-memory SQLite with NO provider
 * network and NO mock.module (avoiding the C38/C91 cross-suite trap + the C163 restoreFromSheets gap):
 *   - GET /status — the backupEnabled / sheetsSyncEnabled derivation from backupConfig (lines 105-110),
 *   - GET /restore/providers — the sourceTypes (zip needs enabled+lastBackupAt; sheets needs
 *     sheetsSyncEnabled+sheetsSpreadsheetId) derivation + the skip-when-neither branch (280-298),
 *   - POST / — the no-enabled-providers success envelope (the 95 happy path).
 *
 * createTestApp() rewrites env then dynamic-imports DB-bound modules; keep imports to the harness.
 */

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
    // A field from the prefs row proves the handler assembled the real response.
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
    // validateSyncTypes passes; backupOrchestrator.execute with no enabled providers returns
    // { results: {} } (not in_progress), so the route hits createSuccessResponse — the 95 happy path.
    const res = await ctx.authed('POST', '/api/v1/sync', { syncTypes: ['backup'] });
    const body = await json<{ success: boolean; message: string; data: { results: unknown } }>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.results).toBeDefined();
  });
});
