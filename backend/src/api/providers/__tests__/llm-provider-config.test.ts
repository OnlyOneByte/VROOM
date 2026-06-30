/**
 * LLM (assistant) provider domain — config validation + encrypted-credential guard (llm-assistant T1).
 * An LLM provider is a NEW DOMAIN ('llm') in the EXISTING domain-agnostic user_providers system, REUSING
 * the vlm-receipt-parsing provider-domain plumbing: the api key rides the encrypted `credentials` blob
 * exactly like a storage refreshToken/S3 secret, and `config` carries the non-secret model name + optional
 * baseUrl. NO schema change. The SAME 4 model provider types serve both the `vlm` and `llm` domains; the
 * per-type required-field gate + the domain↔type guard were generalized from vlm-specific to model-domain
 * (vlm OR llm) in T1 — these pin that the `llm` domain is now first-class:
 *  - the api key is ENCRYPTED AT REST + NEVER echoed (SAX-03 — same control as vlm/storage);
 *  - the required-field gate fails FAST at CREATE *and* PUT (the #103/#123 both-paths discipline);
 *  - a config-only PUT (changing the model) does NOT falsely demand the apiKey be re-sent;
 *  - domain↔type consistency now accepts a model type in the 'llm' domain (the key new behavior) while
 *    still rejecting a model type in a non-model domain and a storage type in 'llm';
 *  - ollama may be keyless (the self-hosted, no-data-leaves-host assistant path);
 *  - an `llm` and a `vlm` provider with the SAME provider type coexist (the domains are independent).
 */

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

/** A well-formed openai-compatible LLM (assistant) provider create body. */
function llmBody(over: Record<string, unknown> = {}) {
  return {
    domain: 'llm',
    providerType: 'openai-compatible',
    displayName: 'My Assistant LLM',
    credentials: { apiKey: 'sk-super-secret-llm-key-123' },
    config: { model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1' },
    ...over,
  };
}

function rawCredentials(id: string): string | null {
  const row = ctx.sqlite.query('SELECT credentials FROM user_providers WHERE id = ?').get(id) as {
    credentials: string;
  } | null;
  return row?.credentials ?? null;
}

describe('POST /api/v1/providers — LLM domain (T1)', () => {
  test('creates an llm provider (201), api key ENCRYPTED at rest + STRIPPED from the response', async () => {
    const res = await ctx.authed('POST', '/api/v1/providers', llmBody());
    expect(res.status).toBe(201);
    const data = (await json<DataEnvelope<ProviderResponse>>(res)).data;

    expect(data.domain).toBe('llm');
    expect(data.providerType).toBe('openai-compatible');
    expect(data.config).toEqual({ model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1' });
    expect(JSON.stringify(data)).not.toContain('sk-super-secret-llm-key-123');
    expect((data as unknown as Record<string, unknown>).credentials).toBeUndefined();

    const stored = rawCredentials(data.id);
    expect(stored).toBeTruthy();
    expect(stored).not.toContain('sk-super-secret-llm-key-123');
    expect(stored).not.toBe(JSON.stringify({ apiKey: 'sk-super-secret-llm-key-123' }));
  });

  test('rejects an llm create with NO model (400, nothing persisted)', async () => {
    const res = await ctx.authed(
      'POST',
      '/api/v1/providers',
      llmBody({ config: { baseUrl: 'https://x/v1' } })
    );
    expect(res.status).toBe(400);
    const list = await ctx.authed('GET', '/api/v1/providers?domain=llm');
    expect((await json<DataEnvelope<ProviderResponse[]>>(list)).data).toHaveLength(0);
  });

  test('rejects a non-ollama llm create with NO api key (400)', async () => {
    const res = await ctx.authed('POST', '/api/v1/providers', llmBody({ credentials: {} }));
    expect(res.status).toBe(400);
  });

  test('rejects an openai-compatible / ollama llm create with NO baseUrl (400)', async () => {
    const res = await ctx.authed(
      'POST',
      '/api/v1/providers',
      llmBody({ config: { model: 'gpt-4o' } })
    );
    expect(res.status).toBe(400);
  });

  test('allows an ollama (self-hosted, KEYLESS) llm provider — the local assistant path', async () => {
    const res = await ctx.authed(
      'POST',
      '/api/v1/providers',
      llmBody({
        providerType: 'ollama',
        credentials: {},
        config: { model: 'llama3.1', baseUrl: 'http://localhost:11434/v1' },
      })
    );
    expect(res.status).toBe(201);
    expect((await json<DataEnvelope<ProviderResponse>>(res)).data.providerType).toBe('ollama');
  });

  test('rejects a domain↔type mismatch: a model type in a non-model domain (400)', async () => {
    const res = await ctx.authed('POST', '/api/v1/providers', llmBody({ domain: 'storage' }));
    expect(res.status).toBe(400);
  });

  test('rejects a domain↔type mismatch: a storage type in the llm domain (400)', async () => {
    const res = await ctx.authed('POST', '/api/v1/providers', {
      domain: 'llm',
      providerType: 's3',
      displayName: 'wrong',
      credentials: { accessKeyId: 'k', secretAccessKey: 's' },
      config: { endpoint: 'https://s3', bucket: 'b', region: 'us-east-1' },
    });
    expect(res.status).toBe(400);
  });

  test('an llm and a vlm provider with the SAME provider type coexist (independent domains)', async () => {
    const llm = await ctx.authed(
      'POST',
      '/api/v1/providers',
      llmBody({ providerType: 'anthropic' })
    );
    expect(llm.status).toBe(201);
    const vlm = await ctx.authed('POST', '/api/v1/providers', {
      domain: 'vlm',
      providerType: 'anthropic',
      displayName: 'My VLM',
      credentials: { apiKey: 'sk-vlm-key' },
      config: { model: 'claude-3-5-sonnet-latest' },
    });
    expect(vlm.status).toBe(201);
    // Each domain lists exactly its own provider.
    const llmList = await json<DataEnvelope<ProviderResponse[]>>(
      await ctx.authed('GET', '/api/v1/providers?domain=llm')
    );
    const vlmList = await json<DataEnvelope<ProviderResponse[]>>(
      await ctx.authed('GET', '/api/v1/providers?domain=vlm')
    );
    expect(llmList.data).toHaveLength(1);
    expect(llmList.data[0]?.domain).toBe('llm');
    expect(vlmList.data).toHaveLength(1);
    expect(vlmList.data[0]?.domain).toBe('vlm');
  });
});

describe('PUT /api/v1/providers/:id — LLM domain (T1, the #123 both-paths gate)', () => {
  async function createLlm(): Promise<string> {
    const res = await ctx.authed('POST', '/api/v1/providers', llmBody());
    expect(res.status).toBe(201);
    return (await json<DataEnvelope<ProviderResponse>>(res)).data.id;
  }

  test('a config-only update (change the model) succeeds WITHOUT re-sending the api key', async () => {
    const id = await createLlm();
    const res = await ctx.authed('PUT', `/api/v1/providers/${id}`, {
      config: { model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1' },
    });
    expect(res.status).toBe(200);
    expect((await json<DataEnvelope<ProviderResponse>>(res)).data.config).toEqual({
      model: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
    });
  });

  test('a config update that drops the model is rejected (400) — no bricked row', async () => {
    const id = await createLlm();
    const res = await ctx.authed('PUT', `/api/v1/providers/${id}`, {
      config: { baseUrl: 'https://api.openai.com/v1' },
    });
    expect(res.status).toBe(400);
  });

  test('a credentials update that drops the key on a non-ollama type is rejected (400)', async () => {
    const id = await createLlm();
    const res = await ctx.authed('PUT', `/api/v1/providers/${id}`, { credentials: {} });
    expect(res.status).toBe(400);
  });

  test('a credentials update re-encrypts the new key (absent from the raw row as plaintext)', async () => {
    const id = await createLlm();
    const res = await ctx.authed('PUT', `/api/v1/providers/${id}`, {
      credentials: { apiKey: 'sk-rotated-llm-999' },
    });
    expect(res.status).toBe(200);
    const stored = rawCredentials(id);
    expect(stored).toBeTruthy();
    expect(stored).not.toContain('sk-rotated-llm-999');
  });
});
