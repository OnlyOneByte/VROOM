/**
 * A backup run may stamp its own result into backupConfig without discarding anyone else's edit.
 *
 * The orchestrator reads backupConfig at the top of a run whose per-provider budget is ten minutes,
 * then used to write the WHOLE column back from that snapshot plus its lastBackupAt / spreadsheet-id
 * stamps. Every concurrent write to the column inside that window was therefore lost: a provider the
 * user disconnected mid-run came back as a ghost entry pointing at a user_providers row that no longer
 * exists, and — the user-visible half — a provider whose backup the user switched OFF in Settings
 * mid-run was silently switched on again, so backups the user had stopped kept running. Both concurrent
 * writers are already atomic json_patch merges; the run itself was the one whole-column writer left.
 *
 * Driven through the REAL execute() with a fake strategy that performs the concurrent edit while the
 * run is in flight — the only honest way to put a write inside the window. The registry is a process
 * global with no delete, so each custom type is overwritten with a no-op afterwards (the pattern
 * backup-orchestrator-execute.test.ts established).
 *
 * createTestApp() rewrites env then dynamic-imports DB-bound modules, so keep static imports to the
 * harness + bun:test.
 */

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

/** A provider row whose credentials the orchestrator can decrypt and JSON.parse. */
function seedProviderRow(id: string, providerType: string): void {
  ctx.sqlite.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, config, status)
     VALUES (?, ?, 'storage', ?, 'Fake', ?, ?, 'active')`,
    [id, ctx.user.id, providerType, encrypt(JSON.stringify({ refreshToken: 'fake' })), '{}']
  );
}

/** A tracked data change, so the run passes the change gate even without force. */
function seedDataChange(id: string): void {
  ctx.sqlite.run('INSERT INTO vehicles (id, user_id, make, model, year) VALUES (?, ?, ?, ?, ?)', [
    id,
    ctx.user.id,
    'T',
    'C',
    2022,
  ]);
}

/** A strategy that runs `duringRun` before reporting success — i.e. inside the run's window. */
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
        // The user opens Settings mid-run and turns this provider's backup off. The settings route
        // merges per-provider, so this is the shape that write takes.
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
      // THE ASSERTION: the run records its own stamp without resurrecting the setting it overlapped.
      expect(providers.p1?.enabled, 'the mid-run disable survives the run').toBe(false);
      expect(providers.p1?.lastBackupAt, 'the run still records when it succeeded').toBeTruthy();
      // The untouched sibling keys are still there — a patch, not a replacement.
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
        // The user disconnects the OTHER provider mid-run. Disconnecting deletes the provider row and
        // json_patches its config key away (a null value in an RFC-7386 patch deletes the key).
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
      // THE ASSERTION: the disconnected provider is gone for good. Left in the config with
      // enabled:true it names a user_providers row that no longer exists, and every later run selects
      // it, fails to find the row, and logs a skip.
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
