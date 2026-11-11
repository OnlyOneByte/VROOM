// A backup run must patch backupConfig rather than rewrite it, so concurrent edits made during the
// run survive. Driven through the real execute() with a strategy that makes the edit mid-run.
// The registry has no delete, so custom types are overwritten with a no-op afterwards.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';
import type { BackupStrategy, BackupStrategyResult } from '../backup-strategy';

interface ProviderConfigEntry {
  enabled?: boolean;
  folderPath?: string;
  retentionCount?: number;
  lastBackupAt?: string;
  sheetsSpreadsheetId?: string;
}

let ctx: TestApp;
let encrypt: (plain: string) => string;
let register: (type: string, strategy: BackupStrategy) => void;
let unregister: (type: string) => void;

beforeEach(async () => {
  ctx = await createTestApp();
  encrypt = (await import('../../../utils/encryption')).encrypt;
  const { backupStrategyRegistry } = await import('../backup-strategy-registry');
  register = (type, strategy) => backupStrategyRegistry.register(type, strategy);
  unregister = (type) =>
    backupStrategyRegistry.register(type, {
      async execute() {
        return { success: true, capabilities: {} };
      },
    });
});
afterEach(() => ctx.close());

function readProviders(): Record<string, ProviderConfigEntry> {
  const row = ctx.sqlite
    .query('SELECT backup_config FROM user_preferences WHERE user_id = ?')
    .get(ctx.user.id) as { backup_config: string | null } | null;
  const config = row?.backup_config
    ? (JSON.parse(row.backup_config) as { providers?: Record<string, ProviderConfigEntry> })
    : {};
  return config.providers ?? {};
}

function writeProviders(providers: Record<string, ProviderConfigEntry>): void {
  ctx.sqlite.run('INSERT OR REPLACE INTO user_preferences (user_id, backup_config) VALUES (?, ?)', [
    ctx.user.id,
    JSON.stringify({ providers }),
  ]);
}

/** A provider row whose credentials the orchestrator can decrypt and parse. */
function seedProviderRow(id: string, providerType: string): void {
  ctx.sqlite.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, config, status)
     VALUES (?, ?, 'storage', ?, 'Fake', ?, ?, 'active')`,
    [id, ctx.user.id, providerType, encrypt(JSON.stringify({ refreshToken: 'fake' })), '{}']
  );
}

/** A tracked data change, so the run passes the change gate. */
function seedDataChange(id: string): void {
  ctx.sqlite.run('INSERT INTO vehicles (id, user_id, make, model, year) VALUES (?, ?, ?, ?, ?)', [
    id,
    ctx.user.id,
    'T',
    'C',
    2022,
  ]);
}

/** A strategy that runs `duringRun` before reporting success. */
function strategyThatEditsConfig(duringRun: () => Promise<void>): BackupStrategy {
  return {
    async execute(): Promise<BackupStrategyResult> {
      await duringRun();
      return { success: true, capabilities: { zip: { success: true } } };
    },
  };
}

describe('a backup run patches backupConfig instead of rewriting it', () => {
  test('a provider switched OFF mid-run stays off', async () => {
    const { preferencesRepository } = await import('../../settings/repository');
    register(
      'fake-self-disable',
      strategyThatEditsConfig(async () => {
        // The user turns this provider's backup off in Settings mid-run.
        await preferencesRepository.mergeJsonField(ctx.user.id, 'backupConfig', {
          providers: { p1: { enabled: false } },
        });
      })
    );
    try {
      seedProviderRow('p1', 'fake-self-disable');
      writeProviders({ p1: { enabled: true, folderPath: 'B', retentionCount: 5 } });
      seedDataChange('v-p1');

      const { backupOrchestrator } = await import('../backup-orchestrator');
      const result = await backupOrchestrator.execute(ctx.user.id, 'U', true);
      expect(result.outcome).toBe('success');

      const providers = readProviders();
      // The run records its own stamp without resurrecting the setting it overlapped.
      expect(providers.p1?.enabled, 'the mid-run disable survives the run').toBe(false);
      expect(providers.p1?.lastBackupAt, 'the run still records when it succeeded').toBeTruthy();
      // Untouched sibling keys survive, which shows a patch rather than a replacement.
      expect(providers.p1?.folderPath).toBe('B');
      expect(providers.p1?.retentionCount).toBe(5);
    } finally {
      unregister('fake-self-disable');
    }
  });

  test('a provider disconnected mid-run is not resurrected as a ghost entry', async () => {
    const { preferencesRepository } = await import('../../settings/repository');
    register(
      'fake-sibling-remover',
      strategyThatEditsConfig(async () => {
        // The user disconnects the other provider mid-run.
        ctx.sqlite.run('DELETE FROM user_providers WHERE id = ?', ['p-gone']);
        await preferencesRepository.mergeJsonField(ctx.user.id, 'backupConfig', {
          providers: { 'p-gone': null },
        });
      })
    );
    register('fake-doomed', {
      async execute(): Promise<BackupStrategyResult> {
        return { success: false, message: 'provider disconnected', capabilities: {} };
      },
    });
    try {
      seedProviderRow('p-keep', 'fake-sibling-remover');
      seedProviderRow('p-gone', 'fake-doomed');
      writeProviders({
        'p-keep': { enabled: true, folderPath: 'B', retentionCount: 5 },
        'p-gone': { enabled: true, folderPath: 'B', retentionCount: 5 },
      });
      seedDataChange('v-keep');

      const { backupOrchestrator } = await import('../backup-orchestrator');
      const result = await backupOrchestrator.execute(ctx.user.id, 'U', true);
      expect(result.outcome).toBe('partial');

      const providers = readProviders();
      // The disconnected provider stays gone. A leftover enabled entry would name a missing row.
      expect(Object.keys(providers), 'only the surviving provider remains').toEqual(['p-keep']);
      expect(providers['p-keep']?.lastBackupAt).toBeTruthy();
    } finally {
      unregister('fake-sibling-remover');
      unregister('fake-doomed');
    }
  });

  test('the spreadsheet id a run learns is still persisted', async () => {
    register('fake-sheets', {
      async execute(): Promise<BackupStrategyResult> {
        return {
          success: true,
          capabilities: { sheets: { success: true, metadata: { spreadsheetId: 'sheet-xyz' } } },
        };
      },
    });
    try {
      seedProviderRow('p-sheets', 'fake-sheets');
      writeProviders({ 'p-sheets': { enabled: true, folderPath: 'B', retentionCount: 5 } });
      seedDataChange('v-sheets');

      const { backupOrchestrator } = await import('../backup-orchestrator');
      await backupOrchestrator.execute(ctx.user.id, 'U', true);

      const providers = readProviders();
      expect(providers['p-sheets']?.sheetsSpreadsheetId).toBe('sheet-xyz');
      expect(providers['p-sheets']?.lastBackupAt).toBeTruthy();
    } finally {
      unregister('fake-sheets');
    }
  });
});
