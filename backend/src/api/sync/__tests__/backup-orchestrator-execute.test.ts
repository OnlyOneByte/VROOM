import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import type { BackupStrategyResult } from '../backup-strategy';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

interface OrchestratorResult {
  timestamp: string;
  skipped?: boolean;
  status?: string;
  outcome: 'success' | 'partial' | 'failed' | 'noop';
  failedProviders: string[];
  results: Record<string, { success: boolean; message?: string; unusable?: boolean }>;
}

describe('BackupOrchestrator.execute() real skip paths', () => {
  test('force=false with no data changes since last sync → skipped (the no-op-backup guard)', async () => {
    const { backupOrchestrator } = await import('../backup-orchestrator');
    const result = (await backupOrchestrator.execute(
      ctx.user.id,
      'Test User'
    )) as OrchestratorResult;

    expect(result.skipped).toBe(true);
    expect(result.results).toEqual({});
  });

  test('a user WITH changes but NO enabled providers → not skipped, empty results', async () => {
    const veh = await ctx.authed('POST', '/api/v1/vehicles', {
      make: 'Toyota',
      model: 'Camry',
      year: 2022,
    });
    expect((await json<DataEnvelope<{ id: string }>>(veh)).data.id).toBeTruthy();

    const { backupOrchestrator } = await import('../backup-orchestrator');
    const result = (await backupOrchestrator.execute(
      ctx.user.id,
      'Test User'
    )) as OrchestratorResult;

    expect(result.skipped).toBeUndefined();
    expect(result.results).toEqual({});
    expect(result.outcome).toBe('noop');
  });

  test('force=true bypasses the change gate; with no providers still yields empty results', async () => {
    const { backupOrchestrator } = await import('../backup-orchestrator');
    const result = (await backupOrchestrator.execute(
      ctx.user.id,
      'Test User',
      true
    )) as OrchestratorResult;

    expect(result.skipped).toBeUndefined();
    expect(result.results).toEqual({});
    expect(result.outcome).toBe('noop');
  });

  test('a second run for the same user while one is in flight returns in_progress', async () => {
    const { backupOrchestrator } = await import('../backup-orchestrator');
    const first = backupOrchestrator.execute(ctx.user.id, 'Test User', true);
    const second = (await backupOrchestrator.execute(
      ctx.user.id,
      'Test User',
      true
    )) as OrchestratorResult;

    expect(second.status).toBe('in_progress');
    expect((await first).status).toBeUndefined();
  });

  test('a mutex held past its TTL (twice the backup timeout) does not block a new run', async () => {
    const { backupOrchestrator } = await import('../backup-orchestrator');
    const { OPERATION_TIMEOUTS } = await import('../../../utils/timeout');
    const TTL_MS = 2 * OPERATION_TIMEOUTS.BACKUP;
    const clock = spyOn(Date, 'now').mockReturnValue(1_000_000);
    try {
      const stuck = backupOrchestrator.execute(ctx.user.id, 'Test User', true);
      clock.mockReturnValue(1_000_000 + TTL_MS + 1);

      const fresh = (await backupOrchestrator.execute(
        ctx.user.id,
        'Test User',
        true
      )) as OrchestratorResult;
      expect(fresh.status).toBeUndefined();
      expect(fresh.outcome).toBe('noop');
      await stuck;
    } finally {
      clock.mockRestore();
    }
  });
});

describe('BackupOrchestrator.execute() outcome', () => {
  async function seedEnabledProvider(
    ctxApp: TestApp,
    id: string,
    providerType: string
  ): Promise<void> {
    await ctxApp.sql.run(
      `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, config, status)
       VALUES (?, ?, 'storage', ?, 'Fake', ?, ?, 'active')`,
      [id, ctxApp.user.id, providerType, encryptedCreds(id, ctxApp.user.id), JSON.stringify({})]
    );
    const existing = (await ctxApp.sql.get(
      'SELECT backup_config FROM user_preferences WHERE user_id = ?',
      [ctxApp.user.id]
    )) as { backup_config: string | null } | null;
    const config = existing?.backup_config
      ? (JSON.parse(existing.backup_config) as { providers: Record<string, unknown> })
      : { providers: {} };
    config.providers[id] = { enabled: true, folderPath: 'B', retentionCount: 5 };
    await ctxApp.sql.run(
      'INSERT INTO user_preferences (user_id, backup_config) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET backup_config = excluded.backup_config',
      [ctxApp.user.id, JSON.stringify(config)]
    );
    await ctxApp.sql.run(
      'INSERT INTO vehicles (id, user_id, make, model, year) VALUES (?, ?, ?, ?, ?)',
      [`v-${id}`, ctxApp.user.id, 'T', 'C', 2022]
    );
  }

  function encryptedCreds(rowId: string, userId: string): string {
    return enc(JSON.stringify({ refreshToken: 'fake' }), { rowId, userId, domain: 'storage' });
  }

  let enc: typeof import('../../../utils/encryption').encrypt;
  let registerFake: (type: string, succeed: boolean | 'partial') => void;
  let unregister: (type: string) => void;

  beforeEach(async () => {
    const { encrypt } = await import('../../../utils/encryption');
    enc = encrypt;
    const { backupStrategyRegistry } = await import('../backup-strategy-registry');
    registerFake = (type, mode) => {
      backupStrategyRegistry.register(type, {
        async execute(): Promise<BackupStrategyResult> {
          if (mode === true) return { success: true, capabilities: { zip: { success: true } } };
          if (mode === 'partial') {
            return {
              success: false,
              message: 'zip failed',
              capabilities: {
                zip: { success: false, message: 'zip failed' },
                sheets: { success: true },
              },
            };
          }
          return {
            success: false,
            message: 'all failed',
            capabilities: { zip: { success: false } },
          };
        },
      });
    };
    unregister = (type) =>
      backupStrategyRegistry.register(type, {
        async execute() {
          return { success: true, capabilities: {} };
        },
      });
  });

  test('every provider fails → outcome failed AND the sync anchor is NOT advanced (retry)', async () => {
    registerFake('fake-fail', false);
    try {
      await seedEnabledProvider(ctx, 'pf', 'fake-fail');
      const { backupOrchestrator } = await import('../backup-orchestrator');
      const result = (await backupOrchestrator.execute(
        ctx.user.id,
        'U',
        true
      )) as OrchestratorResult;

      expect(result.outcome).toBe('failed');
      expect(result.failedProviders).toContain('pf');
      expect(result.results.pf?.success).toBe(false);

      const sync = (await ctx.sql.get('SELECT last_sync_date FROM sync_state WHERE user_id = ?', [
        ctx.user.id,
      ])) as { last_sync_date: string | null } | null;
      expect(sync?.last_sync_date ?? null).toBeNull();
    } finally {
      unregister('fake-fail');
    }
  });

  test('a single provider that did not fully back up → outcome failed', async () => {
    registerFake('fake-cap-partial', 'partial');
    try {
      await seedEnabledProvider(ctx, 'pcp', 'fake-cap-partial');
      const { backupOrchestrator } = await import('../backup-orchestrator');
      const result = (await backupOrchestrator.execute(
        ctx.user.id,
        'U',
        true
      )) as OrchestratorResult;

      expect(result.outcome).toBe('failed');
      expect(result.failedProviders).toContain('pcp');
    } finally {
      unregister('fake-cap-partial');
    }
  });

  test('one provider succeeds, another fails → outcome partial', async () => {
    registerFake('fake-ok-2', true);
    registerFake('fake-fail-2', false);
    try {
      await seedEnabledProvider(ctx, 'pok', 'fake-ok-2');
      await seedEnabledProvider(ctx, 'pbad', 'fake-fail-2');
      const { backupOrchestrator } = await import('../backup-orchestrator');
      const result = (await backupOrchestrator.execute(
        ctx.user.id,
        'U',
        true
      )) as OrchestratorResult;

      expect(result.outcome).toBe('partial');
      expect(result.failedProviders).toEqual(['pbad']);
      expect(result.results.pok?.success).toBe(true);

      const sync = (await ctx.sql.get('SELECT last_sync_date FROM sync_state WHERE user_id = ?', [
        ctx.user.id,
      ])) as { last_sync_date: string | null } | null;
      expect(sync?.last_sync_date ?? null).toBeNull();
    } finally {
      unregister('fake-ok-2');
      unregister('fake-fail-2');
    }
  });

  test('an upload whose old-backup cleanup fails still counts as backed up, with a warning', async () => {
    const { backupStrategyRegistry } = await import('../backup-strategy-registry');
    const { ZipBackupStrategy, RETENTION_WARNING } = await import(
      '../../providers/backup-strategies/zip-strategy'
    );
    const { getStorageProviderRegistry } = await import('../../providers/domains/storage/registry');
    const { backupService } = await import('../backup');
    backupStrategyRegistry.register('fake-zip-cleanup', new ZipBackupStrategy());
    const upload = spyOn(getStorageProviderRegistry(), 'createProviderInstance').mockResolvedValue({
      upload: async () => ({ externalId: 'ref-1' }),
    } as never);
    const zip = spyOn(backupService, 'exportAsZip').mockResolvedValue(Buffer.from('zip'));
    const cleanup = spyOn(backupService, 'enforceRetention').mockRejectedValue(
      new Error('AccessDenied: list not allowed')
    );
    try {
      await seedEnabledProvider(ctx, 'pz', 'fake-zip-cleanup');
      const { backupOrchestrator } = await import('../backup-orchestrator');
      const result = (await backupOrchestrator.execute(
        ctx.user.id,
        'U',
        true
      )) as OrchestratorResult & {
        results: Record<string, { capabilities: Record<string, { warning?: string }> }>;
      };

      expect(result.outcome).toBe('success');
      expect(result.failedProviders).toEqual([]);
      expect(result.results.pz?.capabilities.zip?.warning).toBe(RETENTION_WARNING);

      const sync = (await ctx.sql.get('SELECT last_sync_date FROM sync_state WHERE user_id = ?', [
        ctx.user.id,
      ])) as { last_sync_date: string | null } | null;
      expect(sync?.last_sync_date ?? null).not.toBeNull();
    } finally {
      upload.mockRestore();
      zip.mockRestore();
      cleanup.mockRestore();
      unregister('fake-zip-cleanup');
    }
  });

  test('provider succeeds → outcome success', async () => {
    registerFake('fake-ok', true);
    try {
      await seedEnabledProvider(ctx, 'po', 'fake-ok');
      const { backupOrchestrator } = await import('../backup-orchestrator');
      const result = (await backupOrchestrator.execute(
        ctx.user.id,
        'U',
        true
      )) as OrchestratorResult;

      expect(result.outcome).toBe('success');
      expect(result.failedProviders).toEqual([]);
    } finally {
      unregister('fake-ok');
    }
  });

  test('a rejected per-provider attempt counts as a failed provider, not a skip', async () => {
    registerFake('fake-reject', true);
    const { backupStrategyRegistry } = await import('../backup-strategy-registry');
    const lookup = spyOn(backupStrategyRegistry, 'get').mockImplementation(() => {
      throw new Error('lookup exploded');
    });
    try {
      await seedEnabledProvider(ctx, 'prej', 'fake-reject');
      const { backupOrchestrator } = await import('../backup-orchestrator');
      const result = (await backupOrchestrator.execute(
        ctx.user.id,
        'U',
        true
      )) as OrchestratorResult;

      expect(result.failedProviders).toEqual(['prej']);
      expect(result.outcome).toBe('failed');
      expect(result.results.prej?.success).toBe(false);
      expect(result.results.prej?.message).toBe('lookup exploded');
    } finally {
      lookup.mockRestore();
      unregister('fake-reject');
    }
  });

  test('a backup-config entry with no provider row is skipped while the live provider still runs', async () => {
    registerFake('fake-live', true);
    try {
      await seedEnabledProvider(ctx, 'plive', 'fake-live');
      await seedEnabledProvider(ctx, 'pghost', 'fake-live');
      await ctx.sql.run('DELETE FROM user_providers WHERE id = ?', ['pghost']);
      const { backupOrchestrator } = await import('../backup-orchestrator');
      const result = (await backupOrchestrator.execute(
        ctx.user.id,
        'U',
        true
      )) as OrchestratorResult;

      expect(Object.keys(result.results)).toEqual(['plive']);
      expect(result.failedProviders).toEqual([]);
      expect(result.outcome).toBe('success');
    } finally {
      unregister('fake-live');
    }
  });

  test('a provider whose stored credentials cannot be read is reported unusable, not skipped', async () => {
    registerFake('fake-readable', true);
    try {
      await seedEnabledProvider(ctx, 'pread', 'fake-readable');
      await seedEnabledProvider(ctx, 'pbroken', 'fake-readable');
      await ctx.sql.run("UPDATE user_providers SET credentials = 'garbage' WHERE id = ?", [
        'pbroken',
      ]);
      const { backupOrchestrator } = await import('../backup-orchestrator');
      const result = (await backupOrchestrator.execute(
        ctx.user.id,
        'U',
        true
      )) as OrchestratorResult;

      expect(result.outcome).toBe('partial');
      expect(result.failedProviders).toEqual(['pbroken']);
      expect(result.results.pbroken).toMatchObject({
        success: false,
        message: "Stored credentials can't be read",
        unusable: true,
      });
      expect(result.results.pread?.unusable).toBeUndefined();

      const health = async (id: string) =>
        (await ctx.sql.get(
          'SELECT status, last_error_code, last_sync_at FROM user_providers WHERE id = ?',
          [id]
        )) as {
          status: string;
          last_error_code: string | null;
          last_sync_at: number | null;
        };
      expect(await health('pbroken')).toMatchObject({
        status: 'needs_reauth',
        last_error_code: 'auth',
      });
      expect(await health('pread')).toMatchObject({ status: 'active', last_error_code: null });
      expect((await health('pread')).last_sync_at).not.toBeNull();
    } finally {
      unregister('fake-readable');
    }
  });

  test('a provider whose type has no registered strategy fails instead of being skipped', async () => {
    await seedEnabledProvider(ctx, 'punreg', 'no-such-provider-type');
    const { backupOrchestrator } = await import('../backup-orchestrator');
    const result = (await backupOrchestrator.execute(ctx.user.id, 'U', true)) as OrchestratorResult;

    expect(result.results.punreg?.success).toBe(false);
    expect(result.results.punreg?.message).toContain('no-such-provider-type');
    expect(result.failedProviders).toEqual(['punreg']);
    expect(result.outcome).toBe('failed');
  });

  test('a Sheets-only provider is attempted by the run, and no ZIP is built for it', async () => {
    let zipSeen: Buffer | null | undefined;
    const { backupStrategyRegistry } = await import('../backup-strategy-registry');
    backupStrategyRegistry.register('fake-sheets-only', {
      async execute(context) {
        zipSeen = context.zipBuffer;
        return { success: true, capabilities: { sheets: { success: true } } };
      },
    });
    const { backupService } = await import('../backup');
    const zipSpy = spyOn(backupService, 'exportAsZip');
    try {
      await seedEnabledProvider(ctx, 'psheets', 'fake-sheets-only');
      await ctx.sql.run(
        'INSERT INTO user_preferences (user_id, backup_config) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET backup_config = excluded.backup_config',
        [
          ctx.user.id,
          JSON.stringify({
            providers: {
              psheets: {
                enabled: false,
                folderPath: 'B',
                retentionCount: 5,
                sheetsSyncEnabled: true,
              },
            },
          }),
        ]
      );
      const { backupOrchestrator } = await import('../backup-orchestrator');
      const result = (await backupOrchestrator.execute(
        ctx.user.id,
        'U',
        true
      )) as OrchestratorResult;

      expect(result.results.psheets?.success).toBe(true);
      expect(zipSpy).not.toHaveBeenCalled();
      expect(zipSeen).toBeNull();
    } finally {
      zipSpy.mockRestore();
      backupStrategyRegistry.register('fake-sheets-only', {
        async execute() {
          return { success: true, capabilities: {} };
        },
      });
    }
  });

  test('a failed ZIP build does not abort the run; the strategy gets a null ZIP', async () => {
    let zipSeen: Buffer | null | undefined;
    const { backupStrategyRegistry } = await import('../backup-strategy-registry');
    backupStrategyRegistry.register('fake-zip-probe', {
      async execute(context) {
        zipSeen = context.zipBuffer;
        return { success: true, capabilities: { zip: { success: true } } };
      },
    });
    const { backupService } = await import('../backup');
    const zipSpy = spyOn(backupService, 'exportAsZip').mockRejectedValue(new Error('zip exploded'));
    try {
      await seedEnabledProvider(ctx, 'pzip', 'fake-zip-probe');
      const { backupOrchestrator } = await import('../backup-orchestrator');
      const result = (await backupOrchestrator.execute(
        ctx.user.id,
        'U',
        true
      )) as OrchestratorResult;

      expect(zipSpy).toHaveBeenCalledTimes(1);
      expect(zipSeen).toBeNull();
      expect(result.outcome).toBe('success');
    } finally {
      zipSpy.mockRestore();
      backupStrategyRegistry.register('fake-zip-probe', {
        async execute() {
          return { success: true, capabilities: {} };
        },
      });
    }
  });
});
