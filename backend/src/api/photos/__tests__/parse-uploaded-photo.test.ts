import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { parseUploadedPhoto } from '../helpers';

function makeApp() {
  const app = new Hono();
  app.onError((err, c) => {
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
    fd.append('notphoto', 'x');

    const res = await app.request('/u', { method: 'POST', body: fd });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('No photo file provided');
  });

  test('throws 400 when `photo` is a text field, not a File', async () => {
    const app = makeApp();
    const fd = new FormData();
    fd.append('photo', 'just-a-string');

    const res = await app.request('/u', { method: 'POST', body: fd });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('No photo file provided');
  });
});
