/**
 * VLM provider registry (vlm-receipt-parsing T2) — mirrors storage/registry.ts:createProviderInstance.
 * Resolves a `user_providers` row (domain:'vlm') into a typed VlmProvider: decrypt the credentials
 * blob, read the model/baseUrl from `config`, and switch on providerType. The per-type ADAPTER bodies
 * (the live HTTP) land in T3; T2 establishes the decrypt + dispatch seam + the unknown-type guard, and
 * the build helpers throw a clear `NotImplemented`-style ValidationError until T3 fills them.
 *
 * The api key is the ONLY secret — it rides the encrypted credentials blob (decrypted here, never
 * logged). config.model + config.baseUrl are non-secret. This keeps the untrusted-output discipline
 * out of the adapters: an adapter only transports; prompt.ts's parseExtraction validates the result.
 */

import type { UserProvider } from '../../../../db/schema';
import { ValidationError } from '../../../../errors';
import { decrypt } from '../../../../utils/encryption';
import type { VlmProvider } from './vlm-provider';

/** Resolved, decrypted VLM provider settings handed to an adapter constructor. */
export interface VlmProviderSettings {
  /** The api key (empty/absent for keyless self-hosted ollama). */
  apiKey?: string;
  /** The model name to call (required — validated at create/PUT). */
  model: string;
  /** Base URL for self-hosted/OpenAI-compatible endpoints (required for ollama/openai-compatible). */
  baseUrl?: string;
}

/**
 * Read + validate the non-secret config + the decrypted credentials into VlmProviderSettings. Throws
 * a ValidationError if the row is malformed (a defense-in-depth mirror of the create/PUT gate — a row
 * that bypassed the route gate, e.g. via restore, still cannot instantiate a broken adapter).
 */
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

// --- Per-type adapter construction (bodies land in T3) ---
// Each mirrors storage/registry.ts's build<Type>Provider helpers. For T2 they validate the
// type-specific required fields and throw a clear not-yet-implemented error; T3 returns a real adapter.

function buildOpenAiCompatibleProvider(settings: VlmProviderSettings): VlmProvider {
  if (!settings.baseUrl) {
    throw new ValidationError('OpenAI-compatible VLM requires a base URL');
  }
  throw new ValidationError('VLM adapter "openai-compatible" is not implemented yet (T3)');
}

function buildAnthropicProvider(settings: VlmProviderSettings): VlmProvider {
  if (!settings.apiKey) {
    throw new ValidationError('Anthropic VLM requires an API key');
  }
  throw new ValidationError('VLM adapter "anthropic" is not implemented yet (T3)');
}

function buildGeminiProvider(settings: VlmProviderSettings): VlmProvider {
  if (!settings.apiKey) {
    throw new ValidationError('Gemini VLM requires an API key');
  }
  throw new ValidationError('VLM adapter "gemini" is not implemented yet (T3)');
}

function buildOllamaProvider(settings: VlmProviderSettings): VlmProvider {
  if (!settings.baseUrl) {
    throw new ValidationError('Ollama VLM requires a base URL');
  }
  throw new ValidationError('VLM adapter "ollama" is not implemented yet (T3)');
}

/**
 * Instantiate a VlmProvider from a user_providers row. Decrypts credentials + switches on providerType,
 * throwing on an unknown/non-VLM type (the same shape as storage/registry.ts's default branch).
 */
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
