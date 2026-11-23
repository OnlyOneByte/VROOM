import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';
import type { BackupStrategyContext, BackupStrategyResult } from '../backup-strategy';

let ctx: TestApp;
const seen: BackupStrategyContext['providerConfig'][] = [];

beforeEach(async () => {
  ctx = await createTestApp();
  seen.length = 0;
  const { encrypt } = await import('../../../utils/encryption');
  ctx.sqlite.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, config, status)
     VALUES ('psheets', ?, 'storage', 'fake-sheets-pause', 'Drive', ?, '{}', 'active')`,
    [ctx.user.id, encrypt(JSON.stringify({ refreshToken: 'fake' }))]
  );
  const { backupStrategyRegistry } = await import('../backup-strategy-registry');
  backupStrategyRegistry.register('fake-sheets-pause', {
    async execute(context): Promise<BackupStrategyResult> {
      seen.push(context.providerConfig);
      return {
        success: true,
        capabilities: context.providerConfig.sheetsSyncEnabled
          ? { sheets: { success: true, metadata: { spreadsheetId: 'sheet-1' } } }
          : {},
      };
    },
  });
});
afterEach(() => ctx.close());

function setBackupConfig(settings: Record<string, unknown>): void {
  ctx.sqlite.run(
    `INSERT INTO user_preferences (user_id, backup_config) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET backup_config = excluded.backup_config`,
    [ctx.user.id, JSON.stringify({ providers: { psheets: settings } })]
  );
}

function storedSettings(): Record<string, unknown> {
  const row = ctx.sqlite
    .query('SELECT backup_config FROM user_preferences WHERE user_id = ?')
    .get(ctx.user.id) as { backup_config: string };
  return JSON.parse(row.backup_config).providers.psheets;
}

async function makeAChange(): Promise<void> {
  const res = await ctx.authed('POST', '/api/v1/vehicles', {
    make: 'Toyota',
    model: 'Camry',
    year: 2022,
  });
  expect(res.status).toBe(201);
}

const PAUSED = {
  enabled: false,
  folderPath: 'Backups',
  retentionCount: 5,
  sheetsSyncEnabled: true,
  sheetsSpreadsheetId: 'sheet-1',
  sheetsAutoPausedAt: '2026-11-23T10:00:00.000Z',
};

describe('automatic Sheets backups pause after a refused restore', () => {
  test('an automatic run skips the paused spreadsheet', async () => {
    setBackupConfig(PAUSED);
    await makeAChange();
    const { backupOrchestrator } = await import('../backup-orchestrator');

    const result = await backupOrchestrator.execute(ctx.user.id, 'U', false);

    expect(seen).toEqual([]);
    expect(result.results).toEqual({});
    expect(storedSettings().sheetsAutoPausedAt).toBe(PAUSED.sheetsAutoPausedAt);
  });

  test('an automatic run still makes the ZIP backup, without the paused Sheets sync', async () => {
    setBackupConfig({ ...PAUSED, enabled: true });
    await makeAChange();
    const { backupOrchestrator } = await import('../backup-orchestrator');

    await backupOrchestrator.execute(ctx.user.id, 'U', false);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.enabled).toBe(true);
    expect(seen[0]?.sheetsSyncEnabled).toBe(false);
    expect(storedSettings().sheetsAutoPausedAt).toBe(PAUSED.sheetsAutoPausedAt);
  });

  test('a backup the user starts writes the spreadsheet and ends the pause', async () => {
    setBackupConfig(PAUSED);
    const { backupOrchestrator } = await import('../backup-orchestrator');

    await backupOrchestrator.execute(ctx.user.id, 'U', true);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.sheetsSyncEnabled).toBe(true);
    expect(storedSettings()).not.toHaveProperty('sheetsAutoPausedAt');
  });

  test('a backup the user starts keeps the pause when the Sheets write fails', async () => {
    setBackupConfig(PAUSED);
    const { backupStrategyRegistry } = await import('../backup-strategy-registry');
    backupStrategyRegistry.register('fake-sheets-pause', {
      async execute(): Promise<BackupStrategyResult> {
        return { success: false, capabilities: { sheets: { success: false, message: 'quota' } } };
      },
    });
    const { backupOrchestrator } = await import('../backup-orchestrator');

    await backupOrchestrator.execute(ctx.user.id, 'U', true);

    expect(storedSettings().sheetsAutoPausedAt).toBe(PAUSED.sheetsAutoPausedAt);
  });

  test('a settings save from the app cannot set the pause either', async () => {
    const { sheetsAutoPausedAt: _paused, ...unpaused } = PAUSED;
    setBackupConfig(unpaused);

    const res = await ctx.authed('PUT', '/api/v1/settings', {
      backupConfig: { providers: { psheets: PAUSED } },
    });

    expect(res.status).toBe(200);
    expect(storedSettings()).not.toHaveProperty('sheetsAutoPausedAt');
  });

  test('resuming from the notice ends the pause', async () => {
    setBackupConfig(PAUSED);

    const res = await ctx.authed('POST', '/api/v1/sync/sheets/psheets/resume', {});

    expect(res.status).toBe(200);
    expect(storedSettings()).not.toHaveProperty('sheetsAutoPausedAt');
    expect(storedSettings().sheetsSyncEnabled).toBe(true);
  });

  test('resuming a provider that was never paused changes nothing', async () => {
    const res = await ctx.authed('POST', '/api/v1/sync/sheets/unknown/resume', {});

    expect(res.status).toBe(200);
    const row = ctx.sqlite
      .query('SELECT backup_config FROM user_preferences WHERE user_id = ?')
      .get(ctx.user.id) as { backup_config: string | null } | null;
    expect(row?.backup_config ? JSON.parse(row.backup_config).providers?.unknown : undefined).toBe(
      undefined
    );
  });

  test('a settings save from the app neither clears nor sets the pause', async () => {
    setBackupConfig(PAUSED);
    const { sheetsAutoPausedAt: _paused, ...clientCopy } = PAUSED;

    const res = await ctx.authed('PUT', '/api/v1/settings', {
      backupConfig: { providers: { psheets: { ...clientCopy, retentionCount: 7 } } },
    });

    expect(res.status).toBe(200);
    expect(storedSettings().retentionCount).toBe(7);
    expect(storedSettings().sheetsAutoPausedAt).toBe(PAUSED.sheetsAutoPausedAt);
  });
});
