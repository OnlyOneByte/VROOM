/**
 * Guard: an unmatched route answers the SAME error envelope as a thrown error.
 *
 * `app.notFound` shaped its own body with a string-valued `error` ("Not Found") instead of the
 * `{ code, message, details }` object every other error path produces. The frontend's api-client
 * reads `errorBody.error?.message` — on a string that is `undefined`, so a typo'd or moved endpoint
 * surfaced to the user as a bare "Request failed with status 404" with no `code` for the
 * error-message map to key on.
 *
 * createTestApp() must run before static config/connection imports — keep imports to the harness.
 */

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
    // An object with a readable `message` is the whole contract: `typeof error === 'string'` is the
    // defect, because `error.message` is then undefined at every client.
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
