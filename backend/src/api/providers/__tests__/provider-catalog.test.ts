import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { CONFIG } from '../../../config';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';

interface CatalogEntry {
  id: string;
  capability: string;
  label: string;
  fields: { key: string; required: boolean }[];
  secrets: { key: string }[];
  features: Record<string, unknown>;
}

let ctx: TestApp;
const config = CONFIG as { allowFakeStorageProvider: boolean };
const previousFake = config.allowFakeStorageProvider;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => {
  config.allowFakeStorageProvider = previousFake;
  ctx.close();
});

async function catalog(capability = 'storage'): Promise<CatalogEntry[]> {
  const res = await ctx.authed('GET', '/api/v1/providers/catalog');
  expect(res.status).toBe(200);
  const entries = (await json<DataEnvelope<CatalogEntry[]>>(res)).data;
  return entries.filter((e) => e.capability === capability);
}

function hasFunction(value: unknown): boolean {
  if (typeof value === 'function') return true;
  if (value && typeof value === 'object') return Object.values(value).some(hasFunction);
  return false;
}

describe('GET /api/v1/providers/catalog', () => {
  test('lists Google Drive, Google Photos and S3 as storage providers', async () => {
    config.allowFakeStorageProvider = false;
    const entries = await catalog();
    expect(entries.map((e) => e.id)).toEqual(['google-drive', 'google-photos', 's3']);
  });

  test('lists the assistant and receipt-reading model providers with their defaults', async () => {
    for (const capability of ['ai.llm', 'ai.vision']) {
      const entries = await catalog(capability);
      expect(entries.map((e) => e.id)).toEqual([
        'openai-compatible',
        'anthropic',
        'gemini',
        'ollama',
        ...(capability === 'ai.vision' ? ['local-ocr'] : []),
      ]);
      const ollama = entries.find((e) => e.id === 'ollama');
      expect(ollama?.secrets).toEqual([]);
      expect(ollama?.fields.map((f) => [f.key, f.required])).toEqual([
        ['model', true],
        ['baseUrl', true],
      ]);
      expect(entries.find((e) => e.id === 'anthropic')?.secrets.map((s) => s.key)).toEqual([
        'apiKey',
      ]);
    }
  });

  test('lists the built-in text reader as a receipt-scanning provider with nothing to set up', async () => {
    const ocr = (await catalog('ai.vision')).find((e) => e.id === 'local-ocr');
    expect(ocr).toMatchObject({ scope: 'builtin', connect: 'none', fields: [], secrets: [] });
  });

  test('lists every built-in import format, matching GET /expenses/import/formats', async () => {
    const entries = await catalog('import');
    const formats = await ctx.authed('GET', '/api/v1/expenses/import/formats');
    const list = (await json<DataEnvelope<{ formats: { id: string; label: string }[] }>>(formats))
      .data.formats;
    expect(entries.map((e) => [e.id, e.label])).toEqual(list.map((f) => [f.id, f.label]));
    expect(entries.every((e) => e.features.detect === true)).toBe(true);
  });

  test('lists the fake provider only when it is enabled', async () => {
    config.allowFakeStorageProvider = true;
    expect((await catalog()).map((e) => e.id)).toEqual([
      'google-drive',
      'google-photos',
      's3',
      'fake',
    ]);
  });

  test('carries the S3 field specs and secret names, with no functions or secret values', async () => {
    await ctx.authed('POST', '/api/v1/providers', {
      domain: 'storage',
      providerType: 's3',
      displayName: 'S3',
      credentials: { accessKeyId: 'AKIA-catalog', secretAccessKey: 'catalog-secret-value' },
      config: { endpoint: 'https://s3.example.com', bucket: 'b', region: 'us-east-1' },
    });
    const res = await ctx.authed('GET', '/api/v1/providers/catalog');
    const raw = await res.text();
    expect(raw).not.toContain('catalog-secret-value');
    expect(raw).not.toContain('AKIA-catalog');

    const entries = (JSON.parse(raw) as DataEnvelope<CatalogEntry[]>).data;
    expect(hasFunction(entries)).toBe(false);
    const s3 = entries.find((e) => e.id === 's3');
    expect(s3?.fields.map((f) => [f.key, f.required])).toEqual([
      ['endpoint', true],
      ['bucket', true],
      ['region', true],
    ]);
    expect(s3?.secrets.map((s) => s.key)).toEqual(['accessKeyId', 'secretAccessKey']);
    expect(s3?.features).toMatchObject({ photoOnly: false, backupSheets: false });
    expect(entries.find((e) => e.id === 'google-drive')?.features).toMatchObject({
      backupSheets: true,
    });
  });

  test('needs a signed-in user', async () => {
    const res = await ctx.anon('GET', '/api/v1/providers/catalog');
    expect(res.status).toBe(401);
  });
});
