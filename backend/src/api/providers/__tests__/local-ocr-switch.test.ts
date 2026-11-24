import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { CONFIG } from '../../../config';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';
import { LOCAL_OCR_PROVIDER_ID } from '../domains/vlm/registry';

let ctx: TestApp;
const localOcr = CONFIG.localOcr as { enabled: boolean };
const enabledBefore = localOcr.enabled;

beforeEach(async () => {
  ctx = await createTestApp();
  localOcr.enabled = false;
});
afterEach(() => {
  localOcr.enabled = enabledBefore;
  ctx.close();
});

function scanReceipt(): Response | Promise<Response> {
  const form = new FormData();
  form.append('image', new File([new Uint8Array([1, 2, 3])], 'r.png', { type: 'image/png' }));
  return ctx.app.request('/api/v1/receipts/parse', {
    method: 'POST',
    headers: { Cookie: ctx.cookie, Origin: 'http://localhost:3000' },
    body: form,
  });
}

describe('LOCAL_OCR=off', () => {
  test('the built-in text reader leaves the catalog', async () => {
    const res = await ctx.authed('GET', '/api/v1/providers/catalog');
    const ids = ((await res.json()) as { data: { id: string }[] }).data.map((e) => e.id);
    expect(ids).toContain('openai-compatible');
    expect(ids).not.toContain('local-ocr');
  });

  test('a user with no vision provider is told to add one, not given the built-in reader', async () => {
    const res = await scanReceipt();
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NO_PROVIDER');
  });

  test('a default saved earlier as the built-in reader is not used', async () => {
    localOcr.enabled = true;
    const saved = await ctx.authed('PUT', '/api/v1/settings', {
      providerDefaults: { 'ai.vision': LOCAL_OCR_PROVIDER_ID },
    });
    expect(saved.status).toBe(200);
    localOcr.enabled = false;
    const res = await scanReceipt();
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NO_PROVIDER');
  });

  test('the built-in reader cannot be chosen as the default', async () => {
    const res = await ctx.authed('PUT', '/api/v1/settings', {
      providerDefaults: { 'ai.vision': LOCAL_OCR_PROVIDER_ID },
    });
    expect(res.status).toBe(400);
  });
});

describe('LOCAL_OCR=on (the default)', () => {
  test('the built-in reader is in the catalog and can be chosen as the default', async () => {
    localOcr.enabled = true;
    const catalog = await ctx.authed('GET', '/api/v1/providers/catalog');
    const ids = ((await catalog.json()) as { data: { id: string }[] }).data.map((e) => e.id);
    expect(ids).toContain('local-ocr');
    const res = await ctx.authed('PUT', '/api/v1/settings', {
      providerDefaults: { 'ai.vision': LOCAL_OCR_PROVIDER_ID },
    });
    expect(res.status).toBe(200);
  });
});
