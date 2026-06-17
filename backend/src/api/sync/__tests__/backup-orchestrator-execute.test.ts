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

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

interface OrchestratorResult {
  timestamp: string;
  skipped?: boolean;
  status?: string;
  results: Record<string, unknown>;
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
  });
});
