/**
 * Resolves a domain:'vlm' user_providers row into a VlmProvider. The api key is the only secret; it is
 * decrypted here and must never be logged.
 */

import type { UserProvider } from '../../../../db/schema';
import { ValidationError } from '../../../../errors';
import { decrypt } from '../../../../utils/encryption';
import { AnthropicVlmProvider } from './anthropic';
import { GeminiVlmProvider } from './gemini';
import { OpenAiCompatibleVlmProvider } from './openai-compatible';
import type { VlmProvider } from './vlm-provider';

export interface VlmProviderSettings {
  /** Absent for keyless self-hosted ollama. */
  apiKey?: string;
  model: string;
  baseUrl?: string;
}

/** Rows that bypass the create/PUT gate (for example via restore) still fail here instead of building a broken adapter. */
export function resolveVlmSettings(row: UserProvider): VlmProviderSettings {
  const config = (row.config ?? {}) as Record<string, unknown>;
  const model = config.model;
  if (typeof model !== 'string' || model.length === 0) {
    throw new ValidationError('VLM provider config is missing a model name');
  }
  const baseUrl = typeof config.baseUrl === 'string' ? config.baseUrl : undefined;

  const decrypted = decrypt(row.credentials);
  const credentials = JSON.parse(decrypted) as Record<string, unknown>;
  const apiKey = typeof credentials.apiKey === 'string' ? credentials.apiKey : undefined;

  return { apiKey, model, baseUrl };
}

// The create/PUT gate already enforces per-type required fields; these re-check before construction.
function buildOpenAiCompatibleProvider(settings: VlmProviderSettings): VlmProvider {
  if (!settings.baseUrl) {
    throw new ValidationError('OpenAI-compatible VLM requires a base URL');
  }
  return new OpenAiCompatibleVlmProvider(settings);
}

function buildAnthropicProvider(settings: VlmProviderSettings): VlmProvider {
  if (!settings.apiKey) {
    throw new ValidationError('Anthropic VLM requires an API key');
  }
  return new AnthropicVlmProvider(settings);
}

function buildGeminiProvider(settings: VlmProviderSettings): VlmProvider {
  if (!settings.apiKey) {
    throw new ValidationError('Gemini VLM requires an API key');
  }
  return new GeminiVlmProvider(settings);
}

function buildOllamaProvider(settings: VlmProviderSettings): VlmProvider {
  if (!settings.baseUrl) {
    throw new ValidationError('Ollama VLM requires a base URL');
  }
  // Ollama serves the OpenAI-compatible chat API, so it reuses that adapter.
  return new OpenAiCompatibleVlmProvider(settings);
}

export function getVlmProvider(row: UserProvider): VlmProvider {
  const settings = resolveVlmSettings(row);

  switch (row.providerType) {
    case 'openai-compatible':
      return buildOpenAiCompatibleProvider(settings);
    case 'anthropic':
      return buildAnthropicProvider(settings);
    case 'gemini':
      return buildGeminiProvider(settings);
    case 'ollama':
      return buildOllamaProvider(settings);
    default:
      throw new ValidationError(`Unsupported VLM provider type: ${row.providerType}`);
  }
}
