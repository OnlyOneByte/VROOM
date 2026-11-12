import { describe, expect, test } from 'bun:test';
import { type Context, Hono } from 'hono';
import { bodyLimit } from '../body-limit';

interface BodyLimitErrorBody {
  success: boolean;
  error: { code: string; message: string };
}

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
    expect(body.error.message).toContain('maximum size of');
    expect(body.error.message).toContain('MB');
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
    const { app } = makeApp({ maxSize: 5 * 1024 * 1024 });
    const res = await uploadWithLength(app, `${10 * 1024 * 1024}`);
    expect(res.status).toBe(413);
    const body = (await res.json()) as BodyLimitErrorBody;
    expect(body.error.message).toContain('5.00MB');
    expect(body.error.message).toContain('10.00MB');
  });
});
