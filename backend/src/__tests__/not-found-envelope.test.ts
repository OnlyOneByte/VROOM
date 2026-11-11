// An unmatched route must answer the same error envelope as a thrown error. A string-valued error
// leaves the client's error.message undefined.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, json, type TestApp } from '../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

interface ErrorBody {
  success: boolean;
  error: { code: string; message: string; details?: { path?: string } };
}

describe('the 404 handler', () => {
  test('answers the standard error envelope, not a string-valued `error`', async () => {
    const res = await ctx.app.request('/api/v1/no-such-endpoint');
    expect(res.status).toBe(404);

    const body = await json<ErrorBody>(res);
    expect(body.success).toBe(false);
    // A string error would leave error.message undefined on the client.
    expect(typeof body.error).toBe('object');
    expect(body.error.code).toBe('NotFoundError');
    expect(body.error.message).toBe('The requested endpoint does not exist');
    expect(body.error.details?.path).toBe('/api/v1/no-such-endpoint');
  });

  test('a thrown NotFoundError on a REAL route uses the same envelope keys', async () => {
    // Same shape from the other direction, so the two 404 paths cannot drift apart.
    const res = await ctx.authed('GET', '/api/v1/vehicles/no-such-vehicle');
    expect(res.status).toBe(404);
    const body = await json<ErrorBody>(res);
    expect(body.success).toBe(false);
    expect(typeof body.error).toBe('object');
    expect(typeof body.error.code).toBe('string');
    expect(typeof body.error.message).toBe('string');
  });
});
