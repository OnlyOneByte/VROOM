import { z } from 'zod';
import type { UserProvider } from '../../../../db/schema';
import { ValidationError } from '../../../../errors';
import { decrypt, secretContextOf } from '../../../../utils/encryption';
import { assertSafeOutboundUrl } from '../../../../utils/outbound-url';
import {
  alwaysAvailable,
  type FieldSpec,
  type ProviderDescriptor,
  validateProviderConfig,
} from '../../descriptor';
import type { ModelDomainLabel } from './model-transport';

export interface ModelProviderSettings {
  apiKey?: string;
  model: string;
  baseUrl?: string;
}

export type ModelCapability = 'ai.llm' | 'ai.vision';
export type ModelTransport = 'openai-compatible' | 'anthropic' | 'gemini';

type AdapterCtor<P> = new (settings: ModelProviderSettings) => P;
export type ModelAdapters<P> = Record<ModelTransport, AdapterCtor<P>>;

export type ModelProviderDescriptor<Cap extends ModelCapability, P> = ProviderDescriptor<
  Cap,
  ModelProviderSettings,
  P,
  Record<string, never>
>;

export const MODEL_DOMAIN_LABEL: Record<ModelCapability, ModelDomainLabel> = {
  'ai.llm': 'LLM',
  'ai.vision': 'VLM',
};

export interface ModelVendorSpec {
  label: string;
  vendor: string;
  description: string;
  transport: ModelTransport;
  model: string;
  baseUrl?: string;
  apiKey: boolean;
}

function modelConfigSchema(domain: ModelDomainLabel, needsBaseUrl: boolean) {
  const modelMessage = `${domain} config must include a model name`;
  const baseUrlMessage = `Self-hosted or OpenAI-compatible ${domain} requires a base URL`;
  return z
    .strictObject({
      model: z.string({ message: modelMessage }).min(1, modelMessage),
      baseUrl: needsBaseUrl
        ? z.string({ message: baseUrlMessage }).min(1, baseUrlMessage)
        : z.string().optional(),
    })
    .superRefine((config, ctx) => {
      if (typeof config.baseUrl !== 'string') return;
      try {
        assertSafeOutboundUrl(config.baseUrl, `${domain} base URL`);
      } catch (error) {
        ctx.addIssue({ code: 'custom', message: (error as Error).message, path: ['baseUrl'] });
      }
    });
}

export function modelDescriptor<Cap extends ModelCapability, P>(
  capability: Cap,
  adapters: ModelAdapters<P>,
  spec: ModelVendorSpec
): ModelProviderDescriptor<Cap, P> {
  const domain = MODEL_DOMAIN_LABEL[capability];
  const fields: FieldSpec[] = [
    { key: 'model', label: 'Model', kind: 'text', required: true, default: spec.model },
  ];
  if (spec.baseUrl) {
    fields.push({
      key: 'baseUrl',
      label: 'Base URL',
      kind: 'url',
      required: true,
      default: spec.baseUrl,
    });
  }
  return {
    capability,
    label: spec.label,
    shortLabel: spec.vendor,
    description: spec.description,
    scope: 'user',
    availability: alwaysAvailable,
    config: { schema: modelConfigSchema(domain, !!spec.baseUrl), fields },
    secrets: spec.apiKey
      ? [{ key: 'apiKey', label: 'API key', required: true, reenterWhenChanged: ['baseUrl'] }]
      : [],
    connect: 'form',
    features: {},
    create: (settings) => {
      if (spec.baseUrl && !settings.baseUrl) {
        throw new ValidationError(`${spec.vendor} ${domain} requires a base URL`);
      }
      if (spec.apiKey && !settings.apiKey) {
        throw new ValidationError(`${spec.vendor} ${domain} requires an API key`);
      }
      return new adapters[spec.transport](settings);
    },
  };
}

export function modelProviderDescriptor<Cap extends ModelCapability, P>(
  descriptors: Record<string, ModelProviderDescriptor<Cap, P>>,
  providerType: string
): ModelProviderDescriptor<Cap, P> | undefined {
  return Object.hasOwn(descriptors, providerType) ? descriptors[providerType] : undefined;
}

// Restored rows can bypass the create/PUT gate, so resolution must validate too.
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
  if (baseUrl) assertSafeOutboundUrl(baseUrl, `${domain} base URL`);

  const credentials = JSON.parse(decrypt(row.credentials, secretContextOf(row))) as Record<
    string,
    unknown
  >;
  const apiKey = typeof credentials.apiKey === 'string' ? credentials.apiKey : undefined;

  return { apiKey, model, baseUrl };
}

export function createModelProviderResolver<Cap extends ModelCapability, P>(
  capability: Cap,
  descriptors: Record<string, ModelProviderDescriptor<Cap, P>>
): (row: UserProvider) => P {
  const domain = MODEL_DOMAIN_LABEL[capability];
  return (row) => {
    const settings = resolveModelSettings(row, domain);
    const descriptor = modelProviderDescriptor(descriptors, row.providerType);
    if (!descriptor) {
      throw new ValidationError(`Unsupported ${domain} provider type: ${row.providerType}`);
    }
    const provider = descriptor.create(settings);
    const config = row.config as Record<string, unknown> | null;
    validateProviderConfig(descriptor, config, Object.keys(config ?? {}));
    return provider;
  };
}
