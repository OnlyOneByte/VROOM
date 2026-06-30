/**
 * LLM provider registry (llm-assistant T3a) — mirrors vlm/registry.ts. Resolves a `user_providers` row
 * (domain:'llm') into a typed LlmProvider: decrypt the credentials blob, read the model/baseUrl from
 * `config`, and switch on providerType. T3a wires the openai-compatible + ollama types LIVE (Ollama
 * speaks the same /v1/chat/completions + tools shape, so it reuses the openai-compatible adapter via a
 * baseUrl); the first-party anthropic + gemini adapters throw a clear T3b-placeholder until that slice.
 *
 * The api key is the ONLY secret — it rides the encrypted credentials blob (decrypted here, never
 * logged). config.model + config.baseUrl are non-secret. The untrusted-output discipline lives in the
 * ORCHESTRATOR (T4), not here: an adapter only transports; the orchestrator validates tool calls.
 */

import type { UserProvider } from '../../../../db/schema';
import { ValidationError } from '../../../../errors';
import { decrypt } from '../../../../utils/encryption';
import type { LlmProvider } from './llm-provider';
import { OpenAiCompatibleLlmProvider } from './openai-compatible';

/** Resolved, decrypted LLM provider settings handed to an adapter constructor. */
export interface LlmProviderSettings {
  /** The api key (empty/absent for keyless self-hosted ollama). */
  apiKey?: string;
  /** The model name to call (required — validated at create/PUT). */
  model: string;
  /** Base URL for self-hosted/OpenAI-compatible endpoints (required for ollama/openai-compatible). */
  baseUrl?: string;
}

/**
 * Read + validate the non-secret config + the decrypted credentials into LlmProviderSettings. Throws a
 * ValidationError if the row is malformed (a defense-in-depth mirror of the create/PUT gate — a row that
 * bypassed the route gate, e.g. via restore, still cannot instantiate a broken adapter). Mirrors
 * vlm/registry.ts:resolveVlmSettings exactly.
 */
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

// --- Per-type adapter construction (mirrors vlm/registry.ts) ---
// openai-compatible + ollama share the /v1/chat/completions + tools adapter (T3a; Ollama is keyless
// self-hosted, just the compatible adapter + a baseUrl). anthropic + gemini are first-party — T3b.

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
  // Ollama exposes the OpenAI-compatible /v1/chat/completions + tools shape, so it reuses that adapter
  // (the self-hosted, no-data-leaves-host assistant path is the compatible adapter + a baseUrl).
  return new OpenAiCompatibleLlmProvider(settings);
}

/**
 * Instantiate an LlmProvider from a user_providers row. Decrypts credentials + switches on providerType,
 * throwing on an unknown/non-LLM type (the same shape as vlm/registry.ts's default branch). anthropic +
 * gemini throw a clear T3b-not-yet-implemented ValidationError until that slice wires their adapters.
 */
export function getLlmProvider(row: UserProvider): LlmProvider {
  const settings = resolveLlmSettings(row);

  switch (row.providerType) {
    case 'openai-compatible':
      return buildOpenAiCompatibleProvider(settings);
    case 'ollama':
      return buildOllamaProvider(settings);
    case 'anthropic':
    case 'gemini':
      throw new ValidationError(
        `LLM provider type "${row.providerType}" is not yet available (coming in T3b)`
      );
    default:
      throw new ValidationError(`Unsupported LLM provider type: ${row.providerType}`);
  }
}
