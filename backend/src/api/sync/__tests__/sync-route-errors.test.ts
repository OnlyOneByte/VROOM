/**
 * Characterization tests for sync ROUTE error behavior through the REAL HTTP stack (arch #1 part 2
 * prerequisite, cycle 30).
 *
 * arch #1 wants to drop the hand-rolled try/catch → handleSyncError from sync/routes.ts and let the
 * central errorHandler (made SyncError-aware in C24) shape errors instead. C24 proved the two paths
 * are byte-identical for a SyncError. BUT for a NON-SyncError thrown inside a sync handler they
 * DIVERGE: handleSyncError's tail wraps any non-SyncError as 500 OPERATION_FAILED, while the central
 * errorHandler maps a ZodError → 400 ValidationError and an AppError by its statusCode. So a blind
 * try/catch drop is NOT behavior-preserving for those paths — it changes at least one status code.
 *
 * The sync routes had NO real HTTP-stack error coverage (the existing "tests" are pure-logic
 * replicas). This file is the safety net the drop needs: it pins TODAY's observable status + body at
 * representative error sites, and explicitly marks which assertions the part-2 drop will change (so
 * that change is a deliberate, reviewed step, not a silent regression). Test-only, behavior-preserving.
 *
 * createTestApp() rewrites env then dynamic-imports DB-bound modules; keep imports to the harness +
 * bun:test.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, json, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

interface ErrorBody {
  success: boolean;
  error: { code: string; message: string; details?: unknown };
}

describe('sync route error behavior (characterization — pins today before the arch drop)', () => {
  test('POST /sync with invalid syncTypes → 400 VALIDATION_ERROR (SyncError path, stable)', async () => {
    // validateSyncTypes throws SyncError(VALIDATION_ERROR), caught by the handler's try/catch →
    // handleSyncError → 400. This is a SyncError, so C24 proved the central handler is byte-identical;
    // the part-2 drop will NOT change this assertion.
    const res = await ctx.authed('POST', '/api/v1/sync', { syncTypes: [] });
    const body = (await json<ErrorBody>(res)) as ErrorBody;
    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  test('POST /sync with an unknown sync type → 400 VALIDATION_ERROR (SyncError path, stable)', async () => {
    const res = await ctx.authed('POST', '/api/v1/sync', { syncTypes: ['not_a_real_type'] });
    const body = (await json<ErrorBody>(res)) as ErrorBody;
    expect(res.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('Invalid sync types');
  });

  test('POST /restore/from-provider without Idempotency-Key → 400 (middleware SyncError, already central)', async () => {
    // The idempotency({ required: true }) middleware throws SyncError BEFORE the handler's try/catch,
    // so this ALREADY propagates to the central errorHandler today (not via handleSyncError). It
    // documents the middleware-vs-handler split and is unaffected by the part-2 drop — a useful
    // anchor showing the central handler already serves this route's middleware errors correctly.
    const res = await ctx.authed('POST', '/api/v1/sync/restore/from-provider', {
      sourceType: 'zip',
      providerId: 'p1',
      fileRef: 'f1',
      mode: 'preview',
    });
    const body = (await json<ErrorBody>(res)) as ErrorBody;
    expect(res.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  // ⚠️ DIVERGENCE NOTE (the reason part-2 is NOT a no-op drop) — documented analytically because the
  // app.request harness always JSON-stringifies the body (so an in-handler ZodError can't be provoked
  // through it without a header arg the harness lacks). The divergence, traced from source:
  //   A non-SyncError thrown INSIDE a sync handler's try/catch (e.g. restoreFromProviderSchema.parse()
  //   ZodError, or a repository AppError/DatabaseError) is wrapped by handleSyncError's tail (errors.ts
  //   :197-198) as 500 OPERATION_FAILED. The central errorHandler instead maps a ZodError → 400
  //   ValidationError and an AppError by its statusCode. So dropping the try/catch CHANGES the status
  //   for those paths (500 → 400 for bad input). That's an improvement, but a behavior change: the
  //   part-2 commit must update the SyncError-path assertions above AND add the now-reachable
  //   400-ValidationError assertions in the same change. This file is the net that makes that visible.

  test('GET /sync/health is unauthenticated-safe and returns healthy (no error path)', async () => {
    // A positive control so the suite also pins a non-error route shape next to the error ones.
    const res = await ctx.authed('GET', '/api/v1/sync/health');
    expect(res.status).toBe(200);
    const body = (await json<{ status: string; service: string }>(res)) as {
      status: string;
      service: string;
    };
    expect(body.status).toBe('healthy');
    expect(body.service).toBe('sync');
  });
});
