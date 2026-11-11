/**
 * Resolves a domain:'llm' user_providers row into an LlmProvider. The api key is the only secret; it
 * is decrypted here and must never be logged.
 */

import type { UserProvider } from '../../../../db/schema';
import { ValidationError } from '../../../../errors';
import { decrypt } from '../../../../utils/encryption';
import { AnthropicLlmProvider } from './anthropic';
import { GeminiLlmProvider } from './gemini';
import type { LlmProvider } from './llm-provider';
import { OpenAiCompatibleLlmProvider } from './openai-compatible';

/** Resolved, decrypted LLM provider settings handed to an adapter constructor. */
export interface LlmProviderSettings {
  /** Absent for keyless self-hosted ollama. */
  apiKey?: string;
  model: string;
  baseUrl?: string;
}

/** Rows that bypass the create/PUT gate (for example via restore) still fail here instead of building a broken adapter. */
export function resolveLlmSettings(row: UserProvider): LlmProviderSettings {
  const config = (row.config ?? {}) as Record<string, unknown>;
  const model = config.model;
  if (typeof model !== 'string' || model.length === 0) {
    throw new ValidationError('LLM provider config is missing a model name');
  }
  const baseUrl = typeof config.baseUrl === 'string' ? config.baseUrl : undefined;

  const decrypted = decrypt(row.credentials);
  const credentials = JSON.parse(decrypted) as Record<string, unknown>;
  const apiKey = typeof credentials.apiKey === 'string' ? credentials.apiKey : undefined;

  return { apiKey, model, baseUrl };
}

function buildOpenAiCompatibleProvider(settings: LlmProviderSettings): LlmProvider {
  if (!settings.baseUrl) {
    throw new ValidationError('OpenAI-compatible LLM requires a base URL');
  }
  return new OpenAiCompatibleLlmProvider(settings);
}

function buildOllamaProvider(settings: LlmProviderSettings): LlmProvider {
  if (!settings.baseUrl) {
    throw new ValidationError('Ollama LLM requires a base URL');
  }
  // Ollama serves the OpenAI-compatible tools API, so it reuses that adapter.
  return new OpenAiCompatibleLlmProvider(settings);
}

function buildAnthropicProvider(settings: LlmProviderSettings): LlmProvider {
  if (!settings.apiKey) {
    throw new ValidationError('Anthropic LLM requires an API key');
  }
  return new AnthropicLlmProvider(settings);
}

function buildGeminiProvider(settings: LlmProviderSettings): LlmProvider {
  if (!settings.apiKey) {
    throw new ValidationError('Gemini LLM requires an API key');
  }
  return new GeminiLlmProvider(settings);
}

export function getLlmProvider(row: UserProvider): LlmProvider {
  const settings = resolveLlmSettings(row);

  switch (row.providerType) {
    case 'openai-compatible':
      return buildOpenAiCompatibleProvider(settings);
    case 'ollama':
      return buildOllamaProvider(settings);
    case 'anthropic':
      return buildAnthropicProvider(settings);
    case 'gemini':
      return buildGeminiProvider(settings);
    default:
      throw new ValidationError(`Unsupported LLM provider type: ${row.providerType}`);
  }
}
