/**
 * Characterization net for the body-limit middleware (guard, cycle 156).
 *
 * bodyLimit is a DoS guard wired LIVE in two places — globally (app.ts:41) and on the backup upload
 * (sync/routes.ts:209, maxSize=CONFIG.backup.maxFileSize) — yet sat ~35% line: only the happy path was
 * incidentally exercised, leaving the 413 rejection branch, its MB-formatted message, the strict-`>`
 * boundary, and the header-absent/malformed passthroughs unpinned. These drive the middleware through a
 * minimal Hono app (the rate-limit/idempotency convention) with a handler-run counter that proves whether
 * `next()` ran, pinning the full contract:
 *   1. under the limit → handler runs, 200;
 *   2. over the limit → 413 PAYLOAD_TOO_LARGE, handler NOT run, MB-formatted default message;
 *   3. EXACTLY at the limit → passes (the check is strict `size > maxSize`);
 *   4. no Content-Length header → passthrough (a chunked/streaming request isn't size-checked here —
 *      documenting the known gap, which the uncompressed-size guards backstop for the backup path);
 *   5. a malformed Content-Length (NaN) → passthrough (NaN > maxSize is false);
 *   6. a custom `message` overrides the default copy.
 *
 * `maxSize`/`message` come from the config ARG (not a frozen CONFIG singleton), so the harness controls
 * them directly — no vacuity trap. Content-Length is a request header, so the body need not actually be
 * that large; the middleware trusts the declared header (its documented contract).
 */

import { describe, expect, test } from 'bun:test';
import { type Context, Hono } from 'hono';
import { bodyLimit } from '../body-limit';

interface BodyLimitErrorBody {
  success: boolean;
  error: { code: string; message: string };
}

/**
 * Minimal app: bodyLimit(maxSize) in front of a trivial 200 handler that bumps a run-counter, so a test
 * can assert whether the downstream handler actually ran (i.e. whether next() was called).
 */
function makeApp(opts: { maxSize: number; message?: string }) {
  let handlerRuns = 0;
  const app = new Hono();
  app.use('*', bodyLimit({ maxSize: opts.maxSize, message: opts.message }));
  app.post('/upload', (c: Context) => {
    handlerRuns++;
    return c.json({ ok: true });
  });
  return { app, runs: () => handlerRuns };
}

/** POST /upload with an explicit Content-Length header (string, as a real client sends it). */
function uploadWithLength(app: Hono, contentLength: string) {
  return app.request('/upload', {
    method: 'POST',
    headers: { 'content-length': contentLength },
  });
}

describe('body-limit middleware — size enforcement', () => {
  test('a request UNDER the max passes through to the handler (200)', async () => {
    const { app, runs } = makeApp({ maxSize: 1000 });
    const res = await uploadWithLength(app, '500');
    expect(res.status).toBe(200);
    expect(runs()).toBe(1);
  });

  test('a request OVER the max is rejected with 413 PAYLOAD_TOO_LARGE and the handler never runs', async () => {
    const { app, runs } = makeApp({ maxSize: 1000 });
    const res = await uploadWithLength(app, '2000');
    expect(res.status).toBe(413);
    const body = (await res.json()) as BodyLimitErrorBody;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
    // Default message is MB-formatted (maxSize/1024/1024 to 2dp) — these are sub-MB, so both read 0.00MB.
    expect(body.error.message).toContain('maximum size of');
    expect(body.error.message).toContain('MB');
    // The downstream handler must NOT run when the request is rejected.
    expect(runs()).toBe(0);
  });

  test('a request EXACTLY at the max passes (the check is strict `size > maxSize`)', async () => {
    const { app, runs } = makeApp({ maxSize: 1000 });
    const res = await uploadWithLength(app, '1000');
    expect(res.status).toBe(200);
    expect(runs()).toBe(1);
  });

  test('a request with NO Content-Length header passes through (the header-absent / streaming gap)', async () => {
    const { app, runs } = makeApp({ maxSize: 10 });
    // No content-length header at all — Hono's app.request without a body sets none.
    const res = await app.request('/upload', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(runs()).toBe(1);
  });

  test('a malformed (non-numeric) Content-Length passes through (NaN > maxSize is false)', async () => {
    const { app, runs } = makeApp({ maxSize: 10 });
    const res = await uploadWithLength(app, 'not-a-number');
    expect(res.status).toBe(200);
    expect(runs()).toBe(1);
  });

  test('a custom message overrides the default 413 copy', async () => {
    const custom = 'Upload too big — trim it down.';
    const { app } = makeApp({ maxSize: 1000, message: custom });
    const res = await uploadWithLength(app, '5000');
    expect(res.status).toBe(413);
    const body = (await res.json()) as BodyLimitErrorBody;
    expect(body.error.message).toBe(custom);
  });

  test('the MB-formatted default message reflects a multi-MB max and received size', async () => {
    const { app } = makeApp({ maxSize: 5 * 1024 * 1024 }); // 5.00MB cap
    const res = await uploadWithLength(app, `${10 * 1024 * 1024}`); // received 10.00MB
    expect(res.status).toBe(413);
    const body = (await res.json()) as BodyLimitErrorBody;
    expect(body.error.message).toContain('5.00MB');
    expect(body.error.message).toContain('10.00MB');
  });
});
