/**
 * Unit net for `parseUploadedPhoto` (photos/helpers.ts) — the multipart upload-body parse + File
 * validation extracted (C221) from the two byte-identical upload routes (photos/routes.ts +
 * vehicles/photo-routes.ts). Pure of any storage provider: it only parses the request body and asserts
 * a `photo` File, throwing AppError(400) otherwise. Driven through a minimal Hono app + real FormData
 * requests (the same path Hono's parseBody runs in production), so this exercises the genuine helper.
 *
 * Pins the upload-input contract one place now that both routes share it — the natural seam for future
 * size/type/magic-byte validation (the #34 follow-on).
 */

import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { parseUploadedPhoto } from '../helpers';

/** A tiny app whose one route returns the parsed file's name (200) or lets the helper throw. */
function makeApp() {
  const app = new Hono();
  app.onError((err, c) => {
    // AppError carries a statusCode; surface it so the test can assert the 400.
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    return c.json({ error: err.message }, status as 400 | 500);
  });
  app.post('/u', async (c) => {
    const file = await parseUploadedPhoto(c);
    return c.json({ name: file.name, size: file.size });
  });
  return app;
}

describe('parseUploadedPhoto', () => {
  test('returns the File when a `photo` part is present', async () => {
    const app = makeApp();
    const fd = new FormData();
    fd.append('photo', new File([new Uint8Array([1, 2, 3, 4])], 'pic.jpg', { type: 'image/jpeg' }));

    const res = await app.request('/u', { method: 'POST', body: fd });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string; size: number };
    expect(body.name).toBe('pic.jpg');
    expect(body.size).toBe(4);
  });

  test('throws 400 when the `photo` part is missing entirely', async () => {
    const app = makeApp();
    const fd = new FormData();
    fd.append('notphoto', 'x'); // some other field, no `photo`

    const res = await app.request('/u', { method: 'POST', body: fd });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('No photo file provided');
  });

  test('throws 400 when `photo` is a text field, not a File', async () => {
    // A client sending photo as a string (not a file part) must be rejected, not coerced.
    const app = makeApp();
    const fd = new FormData();
    fd.append('photo', 'just-a-string');

    const res = await app.request('/u', { method: 'POST', body: fd });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('No photo file provided');
  });
});
