import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';

let ctx: TestApp;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubModel(content: string): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      // biome-ignore lint/suspicious/noExplicitAny: test fetch stub.
    })) as any;
}

function stubModelFailure(status: number): void {
  // biome-ignore lint/suspicious/noExplicitAny: test fetch stub.
  globalThis.fetch = (async () => new Response('upstream error', { status })) as any;
}

async function seedVlmProvider(): Promise<void> {
  const res = await ctx.authed('POST', '/api/v1/providers', {
    domain: 'vlm',
    providerType: 'openai-compatible',
    displayName: 'My VLM',
    credentials: { apiKey: 'sk-secret-key' },
    config: { model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1' },
  });
  expect(res.status).toBe(201);
}

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};
async function postImage(
  bytes: Buffer | Uint8Array,
  mimeType: string,
  field = 'image'
): Promise<Response> {
  const ext = EXT_BY_MIME[mimeType] ?? 'bin';
  const form = new FormData();
  form.append(field, new Blob([bytes], { type: mimeType }), `receipt.${ext}`);
  return ctx.app.request('/api/v1/receipts/parse', {
    method: 'POST',
    headers: { Cookie: ctx.cookie, 'Sec-Fetch-Site': 'same-origin' },
    body: form,
  });
}

const IMG = Buffer.from('fake-jpeg-bytes');

interface DraftEnvelope {
  draft: {
    amount?: number;
    date?: string;
    odometer?: number;
    category?: string;
    vendor?: string;
  };
}

function expenseCount(): number {
  return (ctx.sqlite.query('SELECT COUNT(*) as n FROM expenses').get() as { n: number }).n;
}

describe('POST /api/v1/receipts/parse', () => {
  test('a good model response returns a clean DRAFT and PERSISTS NOTHING', async () => {
    await seedVlmProvider();
    stubModel('{"amount": 42.5, "date": "2024-03-15", "category": "fuel", "vendor": "Shell"}');

    const before = expenseCount();
    const res = await postImage(IMG, 'image/jpeg');
    expect(res.status).toBe(200);

    const { draft } = (await json<DataEnvelope<DraftEnvelope>>(res)).data;
    expect(draft).toEqual({ amount: 42.5, date: '2024-03-15', category: 'fuel', vendor: 'Shell' });
    expect(expenseCount()).toBe(before);
  });

  test('the fail-closed schema drops bad fields from the model output', async () => {
    await seedVlmProvider();
    stubModel('{"amount": -5, "category": "groceries", "date": "2024-06-01", "vendor": "BP"}');

    const res = await postImage(IMG, 'image/jpeg');
    expect(res.status).toBe(200);
    const { draft } = (await json<DataEnvelope<DraftEnvelope>>(res)).data;
    expect(draft).toEqual({ date: '2024-06-01', vendor: 'BP' });
  });

  test('an unparseable model response yields an empty draft (200, user fills by hand)', async () => {
    await seedVlmProvider();
    stubModel('I could not read this receipt.');
    const res = await postImage(IMG, 'image/jpeg');
    expect(res.status).toBe(200);
    expect((await json<DataEnvelope<DraftEnvelope>>(res)).data.draft).toEqual({});
  });

  test('NO configured vlm provider → 400 with an actionable message (not 500)', async () => {
    stubModel('{"amount": 10}');
    const res = await postImage(IMG, 'image/jpeg');
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toMatch(/VLM|Settings|configured/i);
  });

  test('a provider transport or HTTP failure returns 502', async () => {
    await seedVlmProvider();
    stubModelFailure(429);
    const res = await postImage(IMG, 'image/jpeg');
    expect(res.status).toBe(502);
  });

  test('a wrong image type → 400', async () => {
    await seedVlmProvider();
    stubModel('{"amount": 1}');
    const res = await postImage(IMG, 'application/pdf');
    expect(res.status).toBe(400);
  });

  test('a missing image file → 400', async () => {
    await seedVlmProvider();
    stubModel('{"amount": 1}');
    const res = await postImage(IMG, 'image/jpeg', 'wrongfield');
    expect(res.status).toBe(400);
  });

  test('the api key is never echoed in the response', async () => {
    await seedVlmProvider();
    stubModel('{"amount": 9.99}');
    const res = await postImage(IMG, 'image/jpeg');
    const text = await res.text();
    expect(text).not.toContain('sk-secret-key');
  });

  test('an unauthenticated request is rejected', async () => {
    await seedVlmProvider();
    stubModel('{"amount": 1}');
    const form = new FormData();
    form.append('image', new Blob([IMG], { type: 'image/jpeg' }), 'r.jpg');
    const res = await ctx.app.request('/api/v1/receipts/parse', {
      method: 'POST',
      headers: { 'Sec-Fetch-Site': 'same-origin' },
      body: form,
    });
    expect(res.status).toBe(401);
  });
});
