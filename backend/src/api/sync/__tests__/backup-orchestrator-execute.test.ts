// Real execute() skip paths against the in-memory harness DB. These return before any provider or
// ZIP work. createTestApp() must run before static config/connection imports.

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import type { BackupStrategyResult } from '../backup-strategy';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

interface OrchestratorResult {
  timestamp: string;
  skipped?: boolean;
  status?: string;
  outcome: 'success' | 'partial' | 'failed' | 'noop';
  failedProviders: string[];
  results: Record<string, { success: boolean; message?: string }>;
}

describe('BackupOrchestrator.execute() real skip paths', () => {
  test('force=false with no data changes since last sync → skipped (the no-op-backup guard)', async () => {
    // A brand-new user has no tracked data change, so there is nothing to back up.
    const { backupOrchestrator } = await import('../backup-orchestrator');
    const result = (await backupOrchestrator.execute(
      ctx.user.id,
      'Test User'
    )) as OrchestratorResult;

    expect(result.skipped).toBe(true);
    expect(result.results).toEqual({});
  });

  test('a user WITH changes but NO enabled providers → not skipped, empty results', async () => {
    // Seeding a vehicle through the route bumps lastDataChangeDate, so the change gate passes.
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

    expect(result.skipped).toBeUndefined(); // it had changes → did NOT skip on the change gate
    expect(result.results).toEqual({}); // ...but no enabled providers → empty results
    expect(result.outcome).toBe('noop'); // nothing attempted → noop (not a false success)
  });

  test('force=true bypasses the change gate; with no providers still yields empty results', async () => {
    const { backupOrchestrator } = await import('../backup-orchestrator');
    const result = (await backupOrchestrator.execute(
      ctx.user.id,
      'Test User',
      true
    )) as OrchestratorResult;

    expect(result.skipped).toBeUndefined(); // forced → did not take the change-skip path
    expect(result.results).toEqual({});
    expect(result.outcome).toBe('noop');
  });

  test('a second run for the same user while one is in flight returns in_progress', async () => {
    const { backupOrchestrator } = await import('../backup-orchestrator');
    // The mutex is taken synchronously on entry, before the first await, so the second call sees it.
    const first = backupOrchestrator.execute(ctx.user.id, 'Test User', true);
    const second = (await backupOrchestrator.execute(
      ctx.user.id,
      'Test User',
      true
    )) as OrchestratorResult;

    expect(second.status).toBe('in_progress');
    expect((await first).status).toBeUndefined();
  });

  test('a mutex held past the 5-minute TTL does not block a new run', async () => {
    const { backupOrchestrator } = await import('../backup-orchestrator');
    const TTL_MS = 5 * 60 * 1000;
    const clock = spyOn(Date, 'now').mockReturnValue(1_000_000);
    try {
      // The stuck run takes the mutex at t0 and is still in flight when the clock moves past the TTL.
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

// A fake strategy registered under a custom provider type drives the real fan-out and outcome
// aggregation without any provider network. Each test registers and then unregisters it.
describe('BackupOrchestrator.execute() outcome', () => {
  /** Seeds an enabled storage provider, merging into any existing backup config. */
  function seedEnabledProvider(ctxApp: TestApp, id: string, providerType: string): void {
    ctxApp.sqlite.run(
      `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, config, status)
       VALUES (?, ?, 'storage', ?, 'Fake', ?, ?, 'active')`,
      [id, ctxApp.user.id, providerType, encryptedCreds(), JSON.stringify({})]
    );
    const existing = ctxApp.sqlite
      .query('SELECT backup_config FROM user_preferences WHERE user_id = ?')
      .get(ctxApp.user.id) as { backup_config: string | null } | null;
    const config = existing?.backup_config
      ? (JSON.parse(existing.backup_config) as { providers: Record<string, unknown> })
      : { providers: {} };
    config.providers[id] = { enabled: true, folderPath: 'B', retentionCount: 5 };
    ctxApp.sqlite.run(
      'INSERT OR REPLACE INTO user_preferences (user_id, backup_config) VALUES (?, ?)',
      [ctxApp.user.id, JSON.stringify(config)]
    );
    // A data change so the run passes the change gate.
    ctxApp.sqlite.run(
      'INSERT INTO vehicles (id, user_id, make, model, year) VALUES (?, ?, ?, ?, ?)',
      [`v-${id}`, ctxApp.user.id, 'T', 'C', 2022]
    );
  }

  /** A credentials blob the orchestrator can decrypt and parse. */
  function encryptedCreds(): string {
    // Uses the real encryption util so decrypt() round-trips.
    return enc(JSON.stringify({ refreshToken: 'fake' }));
  }

  let enc: (plain: string) => string;
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
    // The registry has no delete, so the custom type is overwritten with a no-op.
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
      seedEnabledProvider(ctx, 'pf', 'fake-fail');
      const { backupOrchestrator } = await import('../backup-orchestrator');
      const result = (await backupOrchestrator.execute(
        ctx.user.id,
        'U',
        true
      )) as OrchestratorResult;

      expect(result.outcome).toBe('failed');
      expect(result.failedProviders).toContain('pf');
      expect(result.results.pf?.success).toBe(false);

      // A failed backup must leave the user with unsynced changes so it retries.
      const sync = ctx.sqlite
        .query('SELECT last_sync_date FROM sync_state WHERE user_id = ?')
        .get(ctx.user.id) as { last_sync_date: string | null } | null;
      expect(sync?.last_sync_date ?? null).toBeNull();
    } finally {
      unregister('fake-fail');
    }
  });

  test('a single provider that did not fully back up → outcome failed', async () => {
    // A lone provider with success:false has no complete backup, so the run is failed, not partial.
    registerFake('fake-cap-partial', 'partial');
    try {
      seedEnabledProvider(ctx, 'pcp', 'fake-cap-partial');
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
      seedEnabledProvider(ctx, 'pok', 'fake-ok-2');
      seedEnabledProvider(ctx, 'pbad', 'fake-fail-2');
      const { backupOrchestrator } = await import('../backup-orchestrator');
      const result = (await backupOrchestrator.execute(
        ctx.user.id,
        'U',
        true
      )) as OrchestratorResult;

      expect(result.outcome).toBe('partial');
      expect(result.failedProviders).toEqual(['pbad']);
      expect(result.results.pok?.success).toBe(true);

      // A partial run must not advance the sync anchor, so the failed provider retries.
      const sync = ctx.sqlite
        .query('SELECT last_sync_date FROM sync_state WHERE user_id = ?')
        .get(ctx.user.id) as { last_sync_date: string | null } | null;
      expect(sync?.last_sync_date ?? null).toBeNull();
    } finally {
      unregister('fake-ok-2');
      unregister('fake-fail-2');
    }
  });

  test('provider succeeds → outcome success', async () => {
    registerFake('fake-ok', true);
    try {
      seedEnabledProvider(ctx, 'po', 'fake-ok');
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
    // The lookup runs outside the per-provider try, so a throw there rejects the attempt itself.
    const lookup = spyOn(backupStrategyRegistry, 'get').mockImplementation(() => {
      throw new Error('lookup exploded');
    });
    try {
      seedEnabledProvider(ctx, 'prej', 'fake-reject');
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
      seedEnabledProvider(ctx, 'plive', 'fake-live');
      seedEnabledProvider(ctx, 'pghost', 'fake-live');
      // The config still names pghost, but its provider row was deleted.
      ctx.sqlite.run('DELETE FROM user_providers WHERE id = ?', ['pghost']);
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

  test('a provider whose type has no registered strategy is skipped, not failed', async () => {
    seedEnabledProvider(ctx, 'punreg', 'no-such-provider-type');
    const { backupOrchestrator } = await import('../backup-orchestrator');
    const result = (await backupOrchestrator.execute(ctx.user.id, 'U', true)) as OrchestratorResult;

    expect(result.results).toEqual({});
    expect(result.failedProviders).toEqual([]);
    expect(result.outcome).toBe('noop');
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
      seedEnabledProvider(ctx, 'psheets', 'fake-sheets-only');
      ctx.sqlite.run(
        'INSERT OR REPLACE INTO user_preferences (user_id, backup_config) VALUES (?, ?)',
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
      seedEnabledProvider(ctx, 'pzip', 'fake-zip-probe');
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
