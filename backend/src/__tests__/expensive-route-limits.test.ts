import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Worker } from 'tesseract.js';
import { setLocalOcrForTest, stopLocalOcr } from '../api/providers/domains/vlm/local-ocr';
import { CONFIG } from '../config';
import { createTestApp, requestAs, type TestApp } from '../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

async function statusesFor(
  count: number,
  send: () => Response | Promise<Response>
): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < count; i++) statuses.push((await send()).status);
  return statuses;
}

async function anotherUser(): Promise<ReturnType<typeof requestAs>> {
  const id = `limits-other-${crypto.randomUUID()}`;
  ctx.sqlite.run('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)', [
    id,
    `${id}@example.com`,
    'Other',
  ]);
  return requestAs(ctx, id);
}

function receiptForm(): FormData {
  const form = new FormData();
  form.append('image', new File([new Uint8Array([1, 2, 3])], 'r.gif', { type: 'image/gif' }));
  return form;
}

describe('per-user limits on expensive routes', () => {
  test('the assistant refuses one message over the limit, and only for that user', async () => {
    const { limit } = CONFIG.rateLimit.assistant;
    const send = () => ctx.authed('POST', '/api/v1/assistant/chat', { message: 'hi' });
    const statuses = await statusesFor(limit + 1, send);
    expect(statuses.slice(0, -1).every((s) => s !== 429)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    const other = await anotherUser();
    expect(
      (await other.request('POST', '/api/v1/assistant/chat', { message: 'hi' })).status
    ).not.toBe(429);
  });

  test('receipt scans are limited per user', async () => {
    const { limit } = CONFIG.rateLimit.receiptScan;
    const send = () =>
      ctx.app.request('/api/v1/receipts/parse', {
        method: 'POST',
        headers: { Cookie: ctx.cookie, Origin: 'http://localhost:3000' },
        body: receiptForm(),
      });
    const statuses = await statusesFor(limit + 1, send);
    expect(statuses.slice(0, -1).every((s) => s !== 429)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  test('CSV imports are limited per user, and previews do not use up that limit', async () => {
    const { limit } = CONFIG.rateLimit.expenseImport;
    const importCsv = (dryRun: boolean) =>
      ctx.authed('POST', '/api/v1/expenses/import', { csv: 'date,amount\n', dryRun });
    const previews = await statusesFor(limit + 5, () => importCsv(true));
    expect(previews.every((s) => s !== 429)).toBe(true);
    const imports = await statusesFor(limit + 1, () => importCsv(false));
    expect(imports.slice(0, -1).every((s) => s !== 429)).toBe(true);
    expect(imports.at(-1)).toBe(429);
  });

  test('photo uploads are limited per user', async () => {
    const { limit } = CONFIG.rateLimit.photoUpload;
    const statuses = await statusesFor(limit + 1, () =>
      ctx.app.request('/api/v1/photos/vehicle/missing', {
        method: 'POST',
        headers: { Cookie: ctx.cookie, Origin: 'http://localhost:3000' },
        body: receiptForm(),
      })
    );
    expect(statuses.slice(0, -1).every((s) => s !== 429)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  test('provider tests are limited per user, and only for that user', async () => {
    const { limit } = CONFIG.rateLimit.providerTest;
    const send = () => ctx.authed('POST', '/api/v1/providers/missing/test');
    const statuses = await statusesFor(limit + 1, send);
    expect(statuses.slice(0, -1).every((s) => s !== 429)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    const other = await anotherUser();
    expect((await other.request('POST', '/api/v1/providers/missing/test')).status).not.toBe(429);
  });

  test('receipt imports from Google Photos are limited per user', async () => {
    const { limit } = CONFIG.rateLimit.receiptDrafts;
    const statuses = await statusesFor(limit + 1, () =>
      ctx.authed('GET', '/api/v1/photos/receipt-drafts')
    );
    expect(statuses.slice(0, -1).every((s) => s !== 429)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});

describe('restores and imports in flight', () => {
  function slowRestore(cookie: string, idempotencyKey: string) {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(
          encoder.encode(
            '--b\r\nContent-Disposition: form-data; name="file"; filename="x.zip"\r\n\r\n'
          )
        );
        await gate;
        controller.enqueue(encoder.encode('not a zip\r\n--b--\r\n'));
        controller.close();
      },
    });
    const response = ctx.app.request('/api/v1/sync/restore/from-backup', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: 'http://localhost:3000',
        'Content-Type': 'multipart/form-data; boundary=b',
        'Idempotency-Key': idempotencyKey,
      },
      body,
      duplex: 'half',
    } as RequestInit);
    return { response, release };
  }

  test('one user runs one at a time, and the server runs at most two', async () => {
    const second = await anotherUser();
    const third = await anotherUser();
    const a = slowRestore(ctx.cookie, crypto.randomUUID());
    await Bun.sleep(20);
    const aAgain = await slowRestore(ctx.cookie, crypto.randomUUID()).response;
    expect(aAgain.status).toBe(429);

    const b = slowRestore(second.cookie, crypto.randomUUID());
    await Bun.sleep(20);
    const c = await slowRestore(third.cookie, crypto.randomUUID()).response;
    expect(c.status).toBe(503);
    expect(c.headers.get('Retry-After')).toBe('5');

    a.release();
    b.release();
    expect((await a.response).status).not.toBe(503);
    expect((await b.response).status).not.toBe(503);
    const afterwards = slowRestore(third.cookie, crypto.randomUUID());
    afterwards.release();
    expect((await afterwards.response).status).not.toBe(503);
  });
});

describe('the built-in text reader is shared fairly', () => {
  afterEach(async () => {
    await stopLocalOcr().catch(() => undefined);
    setLocalOcrForTest();
  });

  test("one user filling their scans at once doesn't make another user's scan fail", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    setLocalOcrForTest({
      createWorker: async () =>
        ({
          recognize: async () => {
            await gate;
            return { data: { text: 'TOTAL 12.34' } };
          },
          terminate: async () => undefined,
        }) as unknown as Worker,
    });
    const scan = (cookie: string) =>
      ctx.app.request('/api/v1/receipts/parse', {
        method: 'POST',
        headers: { Cookie: cookie, Origin: 'http://localhost:3000' },
        body: (() => {
          const form = new FormData();
          form.append(
            'image',
            new File([new Uint8Array([1, 2, 3])], 'r.png', { type: 'image/png' })
          );
          return form;
        })(),
      });

    const mine = Array.from({ length: CONFIG.rateLimit.receiptScansAtOnce }, () =>
      scan(ctx.cookie)
    );
    await Bun.sleep(20);
    expect((await scan(ctx.cookie)).status).toBe(429);

    const other = await anotherUser();
    const theirs = scan(other.cookie);
    await Bun.sleep(20);
    release();
    expect((await theirs).status).toBe(200);
    for (const response of await Promise.all(mine)) expect(response.status).toBe(200);
  });
});
