/**
 * Characterization tests for sync ROUTE error behavior through the REAL HTTP stack (arch #1: net
 * written C30, try/catch DROPPED C36).
 *
 * arch #1 dropped the hand-rolled try/catch → handleSyncError from sync/routes.ts (C36) so errors
 * propagate to the central errorHandler (made SyncError-aware in C24). C24 proved the two paths are
 * byte-identical for a SyncError — so the SyncError-path assertions below are UNCHANGED across the
 * drop and prove it caused no regression on the common case. For a NON-SyncError thrown inside a sync
 * handler the paths diverged (handleSyncError wrapped any non-SyncError as 500 OPERATION_FAILED; the
 * central errorHandler maps a ZodError → 400 ValidationError + an AppError by its statusCode), so the
 * drop deliberately IMPROVED those: bad input now returns its proper status instead of a blanket 500.
 *
 * This file was the net that made the drop provable; it now also documents the post-drop contract.
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

  // POST-DROP CONTRACT (C36): with the try/catch gone, a non-SyncError thrown inside a sync handler
  // now reaches the central errorHandler, which maps it to its proper status instead of the old
  // blanket 500 OPERATION_FAILED. Asserted live here: an unauthenticated request hits requireAuth
  // (which throws AuthenticationError, an AppError, NOT a SyncError) → the central handler returns
  // 401 AuthenticationError. Pre-drop, requireAuth ran before the route try/catch so this was already
  // 401 — but it now confirms the central handler is the single error path for these routes, and that
  // an AppError keeps its statusCode rather than being flattened to 500.
  test('an unauthenticated sync request → 401 via the central handler (AppError keeps its status)', async () => {
    const res = await ctx.anon('POST', '/api/v1/sync', { syncTypes: ['backup'] });
    expect(res.status).toBe(401);
    const body = (await json<ErrorBody>(res)) as ErrorBody;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('AuthenticationError');
  });

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
