/**
 * Real-`execute()` skip-path coverage for BackupOrchestrator (C291 deep-review → guard).
 *
 * backup-orchestrator.test.ts pins the pure exports (filterEnabledProviders/needsZipGeneration, C181)
 * but its mutex / change-detection-skip / no-providers cases are LOCAL SIMS (mirrors of logic embedded
 * in execute()), flagged in that file's header as "not reachable from an in-memory harness." That note
 * was over-cautious: createTestApp() rewrites DATABASE_URL to in-memory BEFORE the orchestrator's
 * (dynamically-imported-here) module + its getDb() resolve, so the REAL execute() runs against the
 * harness DB. The EARLY-RETURN skip paths return before any storage-provider/ZIP work, so they ARE
 * drivable for real — converting those sims to genuine coverage of the namesake method.
 *
 * Pinned on the real execute():
 *   - force=false + a brand-new user (no data changes) → { skipped: true } (the no-op-backup guard).
 *   - force=false + an empty backupConfig (no enabled providers) → { results: {} }, NOT skipped
 *     (this user HAS changes — seeding a vehicle bumps lastDataChangeDate — so it passes the change
 *     gate, then short-circuits on zero providers).
 *
 * createTestApp() must run before static config/connection imports — keep imports to the harness.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
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
  results: Record<string, { success: boolean }>;
}

describe('BackupOrchestrator.execute() real skip paths (C291)', () => {
  test('force=false with no data changes since last sync → skipped (the no-op-backup guard)', async () => {
    // A brand-new seeded user has no tracked data change yet, so hasChangesSinceLastSync is false.
    const { backupOrchestrator } = await import('../backup-orchestrator');
    const result = (await backupOrchestrator.execute(
      ctx.user.id,
      'Test User'
    )) as OrchestratorResult;

    expect(result.skipped).toBe(true);
    expect(result.results).toEqual({});
  });

  test('a user WITH changes but NO enabled providers → not skipped, empty results', async () => {
    // Seed a vehicle through the real route — the changeTracker middleware bumps lastDataChangeDate,
    // so this user passes the change gate. With an empty backupConfig (the getOrCreate default), the
    // orchestrator then short-circuits on zero enabled providers: a non-skipped, empty-results run.
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
    // force=true skips hasChangesSinceLastSync entirely; the no-providers short-circuit still applies.
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
});

// #43/#44 — HONEST partial/total-failure reporting. A fake strategy registered for a custom provider
// type lets us drive the REAL execute() fan-out + outcome aggregation over the harness DB with NO
// provider network (the leak-free pattern — register/unregister around each test).
describe('BackupOrchestrator.execute() honest outcome (#43/#44)', () => {
  /**
   * Seed an enabled storage provider of the given type owned by the test user. MERGES into the
   * existing backup_config (so multiple providers can coexist in one run — needed for the orchestrator
   * `partial` case, where one provider succeeds and another fails).
   */
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
    // A data change so the run passes the change gate (force=true also bypasses it, but be explicit).
    ctxApp.sqlite.run(
      'INSERT INTO vehicles (id, user_id, make, model, year) VALUES (?, ?, ?, ?, ?)',
      [`v-${id}`, ctxApp.user.id, 'T', 'C', 2022]
    );
  }

  /** A credentials blob the orchestrator can decrypt (it JSON.parses decrypt(row.credentials)). */
  function encryptedCreds(): string {
    // The orchestrator decrypts then JSON.parses; encrypt a minimal valid JSON refresh-token blob.
    // Use the real encryption util so decrypt() round-trips (the harness shares the test env key).
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
    // The registry is a process-global singleton; the registry Map has no delete, so overwrite with a
    // throwaway no-op to "unregister" the custom type after each test (real google-drive untouched).
    unregister = (type) =>
      backupStrategyRegistry.register(type, {
        async execute() {
          return { success: true, capabilities: {} };
        },
      });
  });

  test('every provider fails → outcome failed AND the sync anchor is NOT advanced (retry, #43)', async () => {
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

      // DATA-SAFETY CORE: a failed backup must leave the user with un-synced changes so it RETRIES.
      const sync = ctx.sqlite
        .query('SELECT last_sync_date FROM sync_state WHERE user_id = ?')
        .get(ctx.user.id) as { last_sync_date: string | null } | null;
      expect(sync?.last_sync_date ?? null).toBeNull();
    } finally {
      unregister('fake-fail');
    }
  });

  test('a single provider that did not fully back up → outcome failed (capability partial = no clean snapshot)', async () => {
    // A lone provider whose strategy returns success:false (e.g. ZIP ok but Sheets failed) means that
    // provider has NO complete backup this run → the honest run-level verdict is `failed` (→ 502), and
    // the sync anchor stays un-advanced so it retries. (Orchestrator `partial` is reserved for a MIX
    // ACROSS providers — see the next test.)
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

  test('one provider succeeds, another fails → outcome partial (#44)', async () => {
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

      // A partial run must NOT advance the global sync anchor either — the failed provider still
      // owes a backup, so leaving the user "unsynced" is what makes it retry next run (#43).
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
});
