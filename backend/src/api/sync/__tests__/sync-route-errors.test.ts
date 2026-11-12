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

  test('an unauthenticated sync request → 401 via the central handler (AppError keeps its status)', async () => {
    const res = await ctx.anon('POST', '/api/v1/sync', { syncTypes: ['backup'] });
    expect(res.status).toBe(401);
    const body = (await json<ErrorBody>(res)) as ErrorBody;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('AuthenticationError');
  });

  test('GET /sync/health is unauthenticated-safe and returns healthy (no error path)', async () => {
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
