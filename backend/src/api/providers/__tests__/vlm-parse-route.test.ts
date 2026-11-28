import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { stopLocalOcr } from '../domains/vlm/local-ocr';

let ctx: TestApp;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterAll(stopLocalOcr);

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

async function expenseCount(): Promise<number> {
  return ((await ctx.sql.get('SELECT COUNT(*) as n FROM expenses')) as { n: number }).n;
}

describe('POST /api/v1/receipts/parse', () => {
  test('a good model response returns a clean DRAFT and PERSISTS NOTHING', async () => {
    await seedVlmProvider();
    stubModel('{"amount": 42.5, "date": "2024-03-15", "category": "fuel", "vendor": "Shell"}');

    const before = await expenseCount();
    const res = await postImage(IMG, 'image/jpeg');
    expect(res.status).toBe(200);

    const { draft } = (await json<DataEnvelope<DraftEnvelope>>(res)).data;
    expect(draft).toEqual({ amount: 42.5, date: '2024-03-15', category: 'fuel', vendor: 'Shell' });
    expect(await expenseCount()).toBe(before);
  });

  test('the fail-closed schema drops bad fields from the model output', async () => {
    await seedVlmProvider();
    stubModel('{"amount": -5, "category": "groceries", "date": "2024-06-01", "vendor": "BP"}');

    const res = await postImage(IMG, 'image/jpeg');
    expect(res.status).toBe(200);
    const { draft } = (await json<DataEnvelope<DraftEnvelope>>(res)).data;
    expect(draft).toEqual({ date: '2024-06-01', vendor: 'BP' });
  });

  test.each([
    ['a refusal in prose', 'I could not read this receipt.'],
    ['an empty reply', ''],
    ['JSON with no usable field', '{"amount": -5, "category": "groceries"}'],
  ])('%s is a 422 that asks for a better photo, not an empty success', async (_, reply) => {
    await seedVlmProvider();
    stubModel(reply);
    const res = await postImage(IMG, 'image/jpeg');
    expect(res.status).toBe(422);
    expect(await res.text()).toMatch(/Couldn't read anything on this receipt/);
  });

  test('an impossible date from the model is dropped', async () => {
    await seedVlmProvider();
    stubModel('{"amount": 10, "date": "2024-02-30"}');
    const res = await postImage(IMG, 'image/jpeg');
    expect(res.status).toBe(200);
    expect((await json<DataEnvelope<DraftEnvelope>>(res)).data.draft).toEqual({ amount: 10 });
  });

  test('with no configured provider, the built-in reader answers and an unreadable image is a 422', async () => {
    const res = await postImage(IMG, 'image/jpeg');
    expect(res.status).toBe(422);
    expect(await res.text()).toMatch(/No readable text found/);
  }, 60_000);

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

  test('a body that is not readable multipart → 400', async () => {
    await seedVlmProvider();
    stubModel('{"amount": 1}');
    const res = await ctx.app.request('/api/v1/receipts/parse', {
      method: 'POST',
      headers: {
        Cookie: ctx.cookie,
        'Sec-Fetch-Site': 'same-origin',
        'content-type': 'multipart/form-data',
      },
      body: 'no boundary here',
    });
    expect(res.status).toBe(400);
  });

  test('an oversized image sent without Content-Length → 413 with the PAYLOAD_TOO_LARGE code', async () => {
    await seedVlmProvider();
    stubModel('{"amount": 1}');
    const res = await postImage(new Uint8Array(8 * 1024 * 1024 + 1), 'image/jpeg');

    expect(res.status).toBe(413);
    const body = await json<{ error: { code: string; message: string } }>(res);
    expect(body.error).toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Receipt image exceeds the 8MB limit',
    });
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
