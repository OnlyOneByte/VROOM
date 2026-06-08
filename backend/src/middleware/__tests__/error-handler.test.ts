/**
 * Characterization tests for the global errorHandler + SyncError convergence (arch, cycle 24).
 *
 * Context: the `sync` routes hand-roll try/catch → handleSyncError in every handler. The arch goal
 * is to drop that boilerplate and let the central errorHandler shape SyncErrors instead. That is
 * only safe if the middleware produces a BYTE-IDENTICAL response to handleSyncError for a SyncError
 * — SyncError extends Error (not AppError), so before this cycle it fell through to a generic 500,
 * losing its code→status mapping. These tests pin:
 *   1. every existing errorHandler branch (there was NO prior coverage), and
 *   2. the equivalence handleSyncError(err) === errorHandler(err) for SyncErrors,
 * so the try/catch removal next cycle can be proven behavior-preserving against this net.
 */

import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import {
  AuthenticationError,
  ConflictError,
  handleSyncError,
  NotFoundError,
  SyncError,
  SyncErrorCode,
  ValidationError,
} from '../../errors';
import { errorHandler } from '../error-handler';

/** Shape of the standard error envelope, for typed assertions on res.json() (which is unknown). */
interface ErrorBody {
  success: boolean;
  error: { code: string; message: string; details?: unknown };
}

/** Build a minimal app whose single route throws the given error, routed through errorHandler. */
function appThatThrows(err: unknown): Hono {
  const app = new Hono();
  app.onError(errorHandler);
  app.get('/boom', () => {
    throw err;
  });
  return app;
}

describe('errorHandler — application error branches', () => {
  test('AppError subclasses map to their statusCode + constructor-name code', async () => {
    const cases: Array<{ err: Error; status: number; code: string }> = [
      { err: new ValidationError('bad input'), status: 400, code: 'ValidationError' },
      { err: new AuthenticationError('nope'), status: 401, code: 'AuthenticationError' },
      { err: new NotFoundError('Thing'), status: 404, code: 'NotFoundError' },
      { err: new ConflictError('dupe'), status: 409, code: 'ConflictError' },
    ];
    for (const { err, status, code } of cases) {
      const res = await appThatThrows(err).request('/boom');
      expect(res.status).toBe(status);
      const body = (await res.json()) as ErrorBody;
      expect(body.success).toBe(false);
      expect(body.error.code).toBe(code);
      expect(body.error.message).toBe(err.message);
    }
  });

  test('ZodError becomes a 400 ValidationError envelope', async () => {
    const schema = z.object({ n: z.number() });
    let zodErr: unknown;
    try {
      schema.parse({ n: 'not-a-number' });
    } catch (e) {
      zodErr = e;
    }
    const res = await appThatThrows(zodErr).request('/boom');
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('ValidationError');
  });

  test('HTTPException is passed through with its own status', async () => {
    const res = await appThatThrows(new HTTPException(418, { message: 'teapot' })).request('/boom');
    expect(res.status).toBe(418);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('HTTPException');
    expect(body.error.message).toBe('teapot');
  });

  test('an unknown (non-AppError) Error yields a generic 500', async () => {
    const res = await appThatThrows(new Error('raw internal detail')).request('/boom');
    expect(res.status).toBe(500);
    const body = (await res.json()) as ErrorBody;
    expect(body.success).toBe(false);
    // In non-development the raw message is hidden behind a generic InternalServerError.
    expect(body.error.code).toBe('InternalServerError');
  });
});

describe('errorHandler — SyncError convergence', () => {
  const SYNC_CASES: Array<{ code: SyncErrorCode; status: number }> = [
    { code: SyncErrorCode.VALIDATION_ERROR, status: 400 },
    { code: SyncErrorCode.AUTH_INVALID, status: 401 },
    { code: SyncErrorCode.PERMISSION_DENIED, status: 403 },
    { code: SyncErrorCode.CONFLICT_DETECTED, status: 409 },
    { code: SyncErrorCode.SYNC_IN_PROGRESS, status: 409 },
    { code: SyncErrorCode.QUOTA_EXCEEDED, status: 429 },
    { code: SyncErrorCode.NETWORK_ERROR, status: 503 },
  ];

  test('every SyncErrorCode maps to its proper status (not a generic 500)', async () => {
    for (const { code, status } of SYNC_CASES) {
      const res = await appThatThrows(new SyncError(code, `${code} happened`)).request('/boom');
      expect(res.status).toBe(status);
      const body = (await res.json()) as ErrorBody;
      expect(body.success).toBe(false);
      expect(body.error.code).toBe(code); // the SyncErrorCode IS the response code
      expect(body.error.message).toBe(`${code} happened`);
    }
  });

  test('SyncError details are preserved in the envelope', async () => {
    const res = await appThatThrows(
      new SyncError(SyncErrorCode.VALIDATION_ERROR, 'bad', { field: 'syncTypes' })
    ).request('/boom');
    const body = (await res.json()) as ErrorBody;
    expect(body.error.details).toEqual({ field: 'syncTypes' });
  });

  test('middleware output is IDENTICAL to handleSyncError for every SyncErrorCode', async () => {
    for (const { code } of SYNC_CASES) {
      const err = new SyncError(code, `${code} msg`, { ctx: code });

      // Path A: the central middleware.
      const viaMiddleware = await appThatThrows(err).request('/boom');
      const middlewareBody = (await viaMiddleware.json()) as ErrorBody;

      // Path B: the local handleSyncError (what the route catch blocks call today).
      const stubCtx = {
        get: () => ({ id: 'user-123' }),
        json: (body: unknown, status: number) =>
          new Response(JSON.stringify(body), {
            status,
            headers: { 'content-type': 'application/json' },
          }),
      } as unknown as Parameters<typeof handleSyncError>[0];
      const viaLocal = handleSyncError(stubCtx, err, 'test op');
      const localBody = (await viaLocal.json()) as ErrorBody;

      expect(viaMiddleware.status).toBe(viaLocal.status);
      expect(middlewareBody).toEqual(localBody);
    }
  });
});
