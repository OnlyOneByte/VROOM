import { beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});

interface ProviderResponse {
  id: string;
  domain: string;
  providerType: string;
  displayName: string;
  status: string;
  config: Record<string, unknown>;
  lastSyncAt: string | null;
  createdAt: string | null;
}

function vlmBody(over: Record<string, unknown> = {}) {
  return {
    domain: 'vlm',
    providerType: 'openai-compatible',
    displayName: 'My VLM',
    credentials: { apiKey: 'sk-super-secret-vlm-key-123' },
    config: { model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1' },
    ...over,
  };
}

function rawCredentials(id: string): string | null {
  const row = ctx.sqlite.query('SELECT credentials FROM user_providers WHERE id = ?').get(id) as {
    credentials: string;
  } | null;
  return row?.credentials ?? null;
}

describe('POST /api/v1/providers — VLM domain', () => {
  test('creates a vlm provider (201), api key ENCRYPTED at rest + STRIPPED from the response', async () => {
    const res = await ctx.authed('POST', '/api/v1/providers', vlmBody());
    expect(res.status).toBe(201);
    const data = (await json<DataEnvelope<ProviderResponse>>(res)).data;

    expect(data.domain).toBe('vlm');
    expect(data.providerType).toBe('openai-compatible');
    expect(data.config).toEqual({ model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1' });
    expect(JSON.stringify(data)).not.toContain('sk-super-secret-vlm-key-123');
    expect((data as unknown as Record<string, unknown>).credentials).toBeUndefined();

    const stored = rawCredentials(data.id);
    expect(stored).toBeTruthy();
    expect(stored).not.toContain('sk-super-secret-vlm-key-123');
    expect(stored).not.toBe(JSON.stringify({ apiKey: 'sk-super-secret-vlm-key-123' }));
  });

  test('rejects a vlm create with NO model (400, nothing persisted)', async () => {
    const res = await ctx.authed(
      'POST',
      '/api/v1/providers',
      vlmBody({ config: { baseUrl: 'https://x/v1' } })
    );
    expect(res.status).toBe(400);
    const list = await ctx.authed('GET', '/api/v1/providers?domain=vlm');
    expect((await json<DataEnvelope<ProviderResponse[]>>(list)).data).toHaveLength(0);
  });

  test('rejects a non-ollama vlm create with NO api key (400)', async () => {
    const res = await ctx.authed('POST', '/api/v1/providers', vlmBody({ credentials: {} }));
    expect(res.status).toBe(400);
  });

  test('rejects an openai-compatible / ollama create with NO baseUrl (400)', async () => {
    const res = await ctx.authed(
      'POST',
      '/api/v1/providers',
      vlmBody({ config: { model: 'gpt-4o-mini' } })
    );
    expect(res.status).toBe(400);
  });

  test('allows an ollama (self-hosted, KEYLESS) provider — the no-data-leaves-host path', async () => {
    const res = await ctx.authed(
      'POST',
      '/api/v1/providers',
      vlmBody({
        providerType: 'ollama',
        credentials: {},
        config: { model: 'llava', baseUrl: 'http://localhost:11434/v1' },
      })
    );
    expect(res.status).toBe(201);
    const data = (await json<DataEnvelope<ProviderResponse>>(res)).data;
    expect(data.providerType).toBe('ollama');
  });

  test('rejects a domain↔type mismatch: a vlm type in a non-vlm domain (400)', async () => {
    const res = await ctx.authed('POST', '/api/v1/providers', vlmBody({ domain: 'storage' }));
    expect(res.status).toBe(400);
  });

  test('rejects a domain↔type mismatch: a storage type in the vlm domain (400)', async () => {
    const res = await ctx.authed('POST', '/api/v1/providers', {
      domain: 'vlm',
      providerType: 's3',
      displayName: 'wrong',
      credentials: { accessKeyId: 'k', secretAccessKey: 's' },
      config: { endpoint: 'https://s3', bucket: 'b', region: 'us-east-1' },
    });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/v1/providers/:id — VLM domain', () => {
  async function createVlm(): Promise<string> {
    const res = await ctx.authed('POST', '/api/v1/providers', vlmBody());
    expect(res.status).toBe(201);
    return (await json<DataEnvelope<ProviderResponse>>(res)).data.id;
  }

  test('a config-only update (change the model) succeeds WITHOUT re-sending the api key', async () => {
    const id = await createVlm();
    const res = await ctx.authed('PUT', `/api/v1/providers/${id}`, {
      config: { model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1' },
    });
    expect(res.status).toBe(200);
    const data = (await json<DataEnvelope<ProviderResponse>>(res)).data;
    expect(data.config).toEqual({ model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1' });
  });

  test('a config update that drops the model is rejected (400) — no bricked row', async () => {
    const id = await createVlm();
    const res = await ctx.authed('PUT', `/api/v1/providers/${id}`, {
      config: { baseUrl: 'https://api.openai.com/v1' },
    });
    expect(res.status).toBe(400);
  });

  test('a credentials update that drops the key on a non-ollama type is rejected (400)', async () => {
    const id = await createVlm();
    const res = await ctx.authed('PUT', `/api/v1/providers/${id}`, { credentials: {} });
    expect(res.status).toBe(400);
  });

  test('a credentials update re-encrypts the new key (still absent from the raw row as plaintext)', async () => {
    const id = await createVlm();
    const res = await ctx.authed('PUT', `/api/v1/providers/${id}`, {
      credentials: { apiKey: 'sk-rotated-key-999' },
    });
    expect(res.status).toBe(200);
    const stored = rawCredentials(id);
    expect(stored).toBeTruthy();
    expect(stored).not.toContain('sk-rotated-key-999');
  });
});
