import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { UserProvider } from '../../../db/schema';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { AnthropicLlmProvider } from '../domains/llm/anthropic';
import { GeminiLlmProvider } from '../domains/llm/gemini';
import type { LlmProvider } from '../domains/llm/llm-provider';
import { OpenAiCompatibleLlmProvider } from '../domains/llm/openai-compatible';
import { getLlmProvider, LLM_PROVIDERS } from '../domains/llm/registry';
import { type ModelProviderDescriptor, modelDescriptor } from '../domains/model/model-registry';

let ctx: TestApp;
const providers = LLM_PROVIDERS as unknown as Record<
  string,
  ModelProviderDescriptor<'ai.llm', unknown>
>;

beforeEach(async () => {
  ctx = await createTestApp();
  providers.mistral = modelDescriptor<'ai.llm', LlmProvider>(
    'ai.llm',
    {
      'openai-compatible': OpenAiCompatibleLlmProvider,
      anthropic: AnthropicLlmProvider,
      gemini: GeminiLlmProvider,
    },
    {
      label: 'Mistral',
      vendor: 'Mistral',
      description: 'Mistral models',
      transport: 'openai-compatible',
      model: 'mistral-small',
      baseUrl: 'https://api.mistral.ai/v1',
      apiKey: true,
    }
  );
});
afterEach(() => {
  delete providers.mistral;
  ctx.close();
});

describe('a model vendor on the OpenAI-compatible transport is one descriptor entry', () => {
  test('it is listed in the catalog, can be created, and resolves to the OpenAI-compatible adapter', async () => {
    const catalog = await ctx.authed('GET', '/api/v1/providers/catalog');
    const entries = (await json<DataEnvelope<{ id: string; capability: string }[]>>(catalog)).data;
    expect(entries).toContainEqual(
      expect.objectContaining({ id: 'mistral', capability: 'ai.llm' })
    );

    const res = await ctx.authed('POST', '/api/v1/providers', {
      domain: 'llm',
      providerType: 'mistral',
      displayName: 'Mistral',
      credentials: { apiKey: 'sk-mistral' },
      config: { model: 'mistral-small', baseUrl: 'https://api.mistral.ai/v1' },
    });
    expect(res.status).toBe(201);
    const { id } = (await json<DataEnvelope<{ id: string }>>(res)).data;

    const row = ctx.sqlite.query('SELECT * FROM user_providers WHERE id = ?').get(id) as Record<
      string,
      unknown
    >;
    const provider = getLlmProvider({
      ...row,
      providerType: row.provider_type,
      credentials: row.credentials,
      config: JSON.parse(String(row.config)),
    } as unknown as UserProvider);
    expect(provider).toBeInstanceOf(OpenAiCompatibleLlmProvider);
  });

  test('its required fields are enforced from the descriptor', async () => {
    const res = await ctx.authed('POST', '/api/v1/providers', {
      domain: 'llm',
      providerType: 'mistral',
      displayName: 'Mistral',
      credentials: {},
      config: { model: 'mistral-small', baseUrl: 'https://api.mistral.ai/v1' },
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('LLM provider requires an API key');
  });

  test('a model vendor is refused under the storage domain', async () => {
    const res = await ctx.authed('POST', '/api/v1/providers', {
      domain: 'storage',
      providerType: 'mistral',
      displayName: 'Mistral',
      credentials: {},
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('Provider type must be one of');
  });
});
