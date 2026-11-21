import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import {
  AuthenticationError,
  ConflictError,
  DatabaseError,
  NotFoundError,
  SyncError,
  SyncErrorCode,
  ValidationError,
} from '../../errors';
import { zValidator } from '../../utils/validation';
import { errorHandler } from '../error-handler';

interface ErrorBody {
  success: boolean;
  error: { code: string; message: string; details?: unknown };
}

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

  test('a malformed JSON body from the validator is a 400 ValidationError', async () => {
    const res = await appThatThrows(
      new HTTPException(400, { message: 'Malformed JSON in request body' })
    ).request('/boom');
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('ValidationError');
    expect(body.error.message).toBe('Malformed request body');
  });

  test('malformed JSON sent to a zValidator route is a 400 ValidationError', async () => {
    const app = new Hono();
    app.onError(errorHandler);
    app.post('/json', zValidator('json', z.object({ n: z.number() })), (c) => c.json({ ok: true }));
    const res = await app.request('/json', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.code).toBe('ValidationError');
  });

  test('an HTTPException with no message gets a readable one', async () => {
    const res = await appThatThrows(new HTTPException(403)).request('/boom');
    expect(res.status).toBe(403);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.message).not.toBe('');
  });

  test('an unknown (non-AppError) Error yields a generic 500', async () => {
    const res = await appThatThrows(new Error('raw internal detail')).request('/boom');
    expect(res.status).toBe(500);
    const body = (await res.json()) as ErrorBody;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('InternalServerError');
  });
});

describe('errorHandler — database errors outside development', () => {
  test('a 5xx AppError keeps its message but drops driver details', async () => {
    const res = await appThatThrows(
      new DatabaseError('Failed to create insurance policy', {
        code: 'SQLITE_CONSTRAINT',
        errno: 19,
      })
    ).request('/boom');
    expect(res.status).toBe(500);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.message).toBe('Failed to create insurance policy');
    expect(body.error.details).toBeUndefined();
  });

  test('a 4xx AppError keeps its details', async () => {
    const res = await appThatThrows(new ValidationError('bad input', [{ path: ['name'] }])).request(
      '/boom'
    );
    const body = (await res.json()) as ErrorBody;
    expect(body.error.details).toEqual([{ path: ['name'] }]);
  });

  test('a raw driver error is mapped by its code and never echoes the driver text', async () => {
    const driverError = Object.assign(new Error('UNIQUE constraint failed: vehicles.id'), {
      code: 'SQLITE_CONSTRAINT_PRIMARYKEY',
    });
    const res = await appThatThrows(driverError).request('/boom');
    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('ConflictError');
    expect(JSON.stringify(body)).not.toContain('vehicles.id');
  });
});

describe('errorHandler — SyncError convergence', () => {
  const EXPECTED_STATUS: Record<SyncErrorCode, number> = {
    [SyncErrorCode.AUTH_INVALID]: 401,
    [SyncErrorCode.PERMISSION_DENIED]: 403,
    [SyncErrorCode.CONFLICT_DETECTED]: 409,
    [SyncErrorCode.SYNC_IN_PROGRESS]: 409,
    [SyncErrorCode.QUOTA_EXCEEDED]: 429,
    [SyncErrorCode.NETWORK_ERROR]: 503,
  };
  const SYNC_CASES = Object.values(SyncErrorCode).map((code) => ({
    code,
    status: EXPECTED_STATUS[code],
  }));

  test('every SyncErrorCode has a pinned status (the case list cannot go stale)', () => {
    expect(SYNC_CASES.length).toBe(Object.keys(SyncErrorCode).length);
    expect(SYNC_CASES.every(({ status }) => typeof status === 'number')).toBe(true);
  });

  test('every SyncErrorCode maps to its proper status (not a generic 500)', async () => {
    for (const { code, status } of SYNC_CASES) {
      const res = await appThatThrows(new SyncError(code, `${code} happened`)).request('/boom');
      expect(res.status).toBe(status);
      const body = (await res.json()) as ErrorBody;
      expect(body.success).toBe(false);
      expect(body.error.code).toBe(code);
      expect(body.error.message).toBe(`${code} happened`);
    }
  });

  test('SyncError details are preserved in the envelope', async () => {
    const res = await appThatThrows(
      new SyncError(SyncErrorCode.CONFLICT_DETECTED, 'bad', { field: 'syncTypes' })
    ).request('/boom');
    const body = (await res.json()) as ErrorBody;
    expect(body.error.details).toEqual({ field: 'syncTypes' });
  });
});
