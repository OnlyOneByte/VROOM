/**
 * Resolves a model-domain (llm or vlm) user_providers row into an adapter instance. The api key is the
 * only secret; it is decrypted here and must never be logged.
 */

import type { UserProvider } from '../../../../db/schema';
import { ValidationError } from '../../../../errors';
import { decrypt } from '../../../../utils/encryption';
import type { ModelDomainLabel } from './model-transport';

/** Resolved, decrypted settings handed to an adapter constructor. */
export interface ModelProviderSettings {
  /** Absent for keyless self-hosted ollama. */
  apiKey?: string;
  model: string;
  baseUrl?: string;
}

type AdapterCtor<P> = new (settings: ModelProviderSettings) => P;

export interface ModelAdapters<P> {
  /** Also serves ollama, which speaks the OpenAI-compatible API. */
  'openai-compatible': AdapterCtor<P>;
  anthropic: AdapterCtor<P>;
  gemini: AdapterCtor<P>;
}

/** Rows that bypass the create/PUT gate (for example via restore) still fail here instead of building a broken adapter. */
export function resolveModelSettings(
  row: UserProvider,
  domain: ModelDomainLabel
): ModelProviderSettings {
  const config = (row.config ?? {}) as Record<string, unknown>;
  const model = config.model;
  if (typeof model !== 'string' || model.length === 0) {
    throw new ValidationError(`${domain} provider config is missing a model name`);
  }
  const baseUrl = typeof config.baseUrl === 'string' ? config.baseUrl : undefined;

  const credentials = JSON.parse(decrypt(row.credentials)) as Record<string, unknown>;
  const apiKey = typeof credentials.apiKey === 'string' ? credentials.apiKey : undefined;

  return { apiKey, model, baseUrl };
}

function requireBaseUrl(settings: ModelProviderSettings, label: string): void {
  if (!settings.baseUrl) throw new ValidationError(`${label} requires a base URL`);
}

function requireApiKey(settings: ModelProviderSettings, label: string): void {
  if (!settings.apiKey) throw new ValidationError(`${label} requires an API key`);
}

export function createModelProviderResolver<P>(
  domain: ModelDomainLabel,
  adapters: ModelAdapters<P>
): (row: UserProvider) => P {
  return (row) => {
    const settings = resolveModelSettings(row, domain);
    switch (row.providerType) {
      case 'openai-compatible':
        requireBaseUrl(settings, `OpenAI-compatible ${domain}`);
        return new adapters['openai-compatible'](settings);
      case 'ollama':
        requireBaseUrl(settings, `Ollama ${domain}`);
        return new adapters['openai-compatible'](settings);
      case 'anthropic':
        requireApiKey(settings, `Anthropic ${domain}`);
        return new adapters.anthropic(settings);
      case 'gemini':
        requireApiKey(settings, `Gemini ${domain}`);
        return new adapters.gemini(settings);
      default:
        throw new ValidationError(`Unsupported ${domain} provider type: ${row.providerType}`);
    }
  };
}
