// GET /sync/restore/providers over the real route and in-memory DB. sync-route-success covers the
// both-sources and neither-source cases; this file covers each source on its own, the Sheets flag
// without a spreadsheet, inactive providers, and per-provider independence.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, json, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

function seedProvider(id: string, options: { accountEmail?: string; status?: string } = {}): void {
  const config = options.accountEmail ? { accountEmail: options.accountEmail } : {};
  ctx.sqlite.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, config, status)
     VALUES (?, ?, 'storage', 'google-drive', ?, 'enc', ?, ?)`,
    [id, ctx.user.id, `Drive ${id}`, JSON.stringify(config), options.status ?? 'active']
  );
}

function seedBackupConfig(providers: Record<string, unknown>): void {
  ctx.sqlite.run('INSERT OR REPLACE INTO user_preferences (user_id, backup_config) VALUES (?, ?)', [
    ctx.user.id,
    JSON.stringify({ providers }),
  ]);
}

interface RestoreProvidersBody {
  success: boolean;
  data: Array<{ providerId: string; sourceTypes: string[]; accountEmail: string }>;
}

async function listRestoreProviders(): Promise<RestoreProvidersBody['data']> {
  const res = await ctx.authed('GET', '/api/v1/sync/restore/providers');
  const body = await json<RestoreProvidersBody>(res);
  expect(res.status, JSON.stringify(body)).toBe(200);
  return body.data;
}

describe('restore provider sourceTypes', () => {
  test('a ZIP backup alone offers only the zip source', async () => {
    seedProvider('prov-zip', { accountEmail: 'alice@example.com' });
    seedBackupConfig({
      'prov-zip': {
        enabled: true,
        folderPath: 'B',
        retentionCount: 5,
        lastBackupAt: '2024-01-01T00:00:00Z',
      },
    });

    const [only] = await listRestoreProviders();
    expect(only?.sourceTypes).toEqual(['zip']);
    expect(only?.accountEmail).toBe('alice@example.com');
  });

  test('a Sheets mirror alone offers only the sheets source', async () => {
    seedProvider('prov-sheets');
    seedBackupConfig({
      'prov-sheets': {
        enabled: false,
        folderPath: 'B',
        retentionCount: 5,
        sheetsSyncEnabled: true,
        sheetsSpreadsheetId: 'sheet-123',
      },
    });

    const [only] = await listRestoreProviders();
    expect(only?.sourceTypes).toEqual(['sheets']);
  });

  test('a Sheets flag with no spreadsheet id offers nothing, so the provider is omitted', async () => {
    seedProvider('prov-no-sheet');
    seedBackupConfig({
      'prov-no-sheet': {
        enabled: false,
        folderPath: 'B',
        retentionCount: 5,
        sheetsSyncEnabled: true,
      },
    });

    expect(await listRestoreProviders()).toHaveLength(0);
  });

  test('an inactive provider is never listed, even with a complete backup config', async () => {
    seedProvider('prov-inactive', { status: 'inactive' });
    seedBackupConfig({
      'prov-inactive': {
        enabled: true,
        folderPath: 'B',
        retentionCount: 5,
        lastBackupAt: '2024-01-01T00:00:00Z',
      },
    });

    expect(await listRestoreProviders()).toHaveLength(0);
  });

  test('each provider is evaluated on its own config', async () => {
    seedProvider('prov-a', { accountEmail: 'a@example.com' });
    seedProvider('prov-b', { accountEmail: 'b@example.com' });
    seedProvider('prov-c');
    seedBackupConfig({
      'prov-a': {
        enabled: true,
        folderPath: 'B',
        retentionCount: 5,
        lastBackupAt: '2024-01-01T00:00:00Z',
      },
      'prov-b': {
        enabled: false,
        folderPath: 'B',
        retentionCount: 5,
        sheetsSyncEnabled: true,
        sheetsSpreadsheetId: 'sheet-456',
      },
      'prov-c': { enabled: false, folderPath: 'B', retentionCount: 5 },
    });

    const data = await listRestoreProviders();
    expect(data.map((p) => p.providerId).sort()).toEqual(['prov-a', 'prov-b']);
    expect(data.find((p) => p.providerId === 'prov-a')?.sourceTypes).toEqual(['zip']);
    expect(data.find((p) => p.providerId === 'prov-b')?.sourceTypes).toEqual(['sheets']);
  });

  test('accountEmail is an empty string when the provider config has none', async () => {
    seedProvider('prov-noemail');
    seedBackupConfig({
      'prov-noemail': {
        enabled: true,
        folderPath: 'B',
        retentionCount: 5,
        lastBackupAt: '2024-01-01T00:00:00Z',
      },
    });

    const [only] = await listRestoreProviders();
    expect(only?.accountEmail).toBe('');
  });
});
