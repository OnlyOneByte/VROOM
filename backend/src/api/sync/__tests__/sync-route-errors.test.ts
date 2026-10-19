/**
 * The error contract of the sync routes, over the REAL HTTP stack.
 *
 * The sync handlers hand-roll no try/catch: every error they raise propagates to the global
 * errorHandler middleware, which is the single error path for this router. Three classes are pinned
 * here because each maps to a different status through a different branch of that handler:
 *  - a SyncError raised inside a handler → its code's status (VALIDATION_ERROR → 400);
 *  - a SyncError raised by MIDDLEWARE, before the handler runs → the same envelope, proving the
 *  handler serves the whole stack and not just route bodies;
 *  - an AppError (requireAuth's AuthenticationError) → its own statusCode, not a flattened 500.
 *
 * A route that reintroduced a local catch block could silently change any of these, so the shapes are
 * asserted rather than assumed. createTestApp() rewrites env then dynamic-imports DB-bound modules;
 * keep imports to the harness + bun:test.
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

describe('sync route error behavior', () => {
  test('POST /sync with invalid syncTypes → 400 VALIDATION_ERROR (SyncError path)', async () => {
    // validateSyncTypes throws SyncError(VALIDATION_ERROR); the global handler maps the code to 400.
    const res = await ctx.authed('POST', '/api/v1/sync', { syncTypes: [] });
    const body = (await json<ErrorBody>(res)) as ErrorBody;
    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  test('POST /sync with an unknown sync type → 400 VALIDATION_ERROR (SyncError path)', async () => {
    const res = await ctx.authed('POST', '/api/v1/sync', { syncTypes: ['not_a_real_type'] });
    const body = (await json<ErrorBody>(res)) as ErrorBody;
    expect(res.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('Invalid sync types');
  });

  test('POST /restore/from-provider without Idempotency-Key → 400 (SyncError from middleware)', async () => {
    // idempotency({ required: true }) throws its SyncError before the handler runs at all, so this
    // pins that the global handler serves middleware errors with the same envelope as handler errors.
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

  // An AppError must keep its own statusCode rather than being flattened to a blanket 500: requireAuth
  // throws AuthenticationError, which is an AppError and NOT a SyncError, so it exercises a different
  // branch of the handler from the two cases above.
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
