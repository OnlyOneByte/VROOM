import { z } from 'zod';
import { CONFIG } from '../../../../config';
import type { UserProvider } from '../../../../db/schema';
import type { ProviderDescriptor } from '../../descriptor';
import {
  createModelProviderResolver,
  type ModelAdapters,
  type ModelProviderDescriptor,
  modelDescriptor,
} from '../model/model-registry';
import { AnthropicVlmProvider } from './anthropic';
import { GeminiVlmProvider } from './gemini';
import { LocalOcrVlmProvider } from './local-ocr';
import { OpenAiCompatibleVlmProvider } from './openai-compatible';
import type { VlmProvider } from './vlm-provider';

const ADAPTERS: ModelAdapters<VlmProvider> = {
  'openai-compatible': OpenAiCompatibleVlmProvider,
  anthropic: AnthropicVlmProvider,
  gemini: GeminiVlmProvider,
};

export const VISION_PROVIDERS = {
  'openai-compatible': modelDescriptor('ai.vision', ADAPTERS, {
    label: 'OpenAI-compatible',
    vendor: 'OpenAI-compatible',
    description: 'OpenAI or any OpenAI-compatible API',
    transport: 'openai-compatible',
    model: 'gpt-4o-mini',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: true,
  }),
  anthropic: modelDescriptor('ai.vision', ADAPTERS, {
    label: 'Anthropic (Claude)',
    vendor: 'Anthropic',
    description: 'Claude models from Anthropic',
    transport: 'anthropic',
    model: 'claude-opus-5-5',
    apiKey: true,
  }),
  gemini: modelDescriptor('ai.vision', ADAPTERS, {
    label: 'Google Gemini',
    vendor: 'Gemini',
    description: 'Gemini models from Google',
    transport: 'gemini',
    model: 'gemini-1.5-flash',
    apiKey: true,
  }),
  ollama: modelDescriptor('ai.vision', ADAPTERS, {
    label: 'Ollama (self-hosted)',
    vendor: 'Ollama',
    description: 'A model you run yourself with Ollama',
    transport: 'openai-compatible',
    model: 'llava',
    baseUrl: 'http://localhost:11434/v1',
    apiKey: false,
  }),
} satisfies Record<string, ModelProviderDescriptor<'ai.vision', VlmProvider>>;

export const LOCAL_OCR_PROVIDER_ID = 'builtin:local-ocr';

export const BUILTIN_VISION_PROVIDERS = {
  'local-ocr': {
    capability: 'ai.vision',
    label: 'Built-in text reader',
    shortLabel: 'Built-in',
    description:
      'Reads the total, date, station and fuel quantity on your VROOM server. No AI model, no key, and the image never leaves your server.',
    scope: 'builtin',
    availability: () => (CONFIG.localOcr.enabled ? 'available' : 'hidden'),
    config: { schema: z.strictObject({}), fields: [] },
    secrets: [],
    connect: 'none',
    features: {},
    create: () => new LocalOcrVlmProvider(),
  },
} satisfies Record<
  string,
  ProviderDescriptor<'ai.vision', Record<string, never>, VlmProvider, Record<string, never>>
>;

export function builtinVisionRow(userId: string): UserProvider {
  const { label } = BUILTIN_VISION_PROVIDERS['local-ocr'];
  return {
    id: LOCAL_OCR_PROVIDER_ID,
    userId,
    domain: 'vlm',
    providerType: 'local-ocr',
    providerAccountId: null,
    displayName: label,
    credentials: '',
    config: {},
    status: 'active',
    lastSyncAt: null,
    lastErrorCode: null,
    lastCheckedAt: null,
    failureCount: 0,
    createdAt: null,
    updatedAt: null,
  };
}

const getUserVlmProvider = createModelProviderResolver<'ai.vision', VlmProvider>(
  'ai.vision',
  VISION_PROVIDERS
);

export function localOcrEnabled(): boolean {
  return BUILTIN_VISION_PROVIDERS['local-ocr'].availability() === 'available';
}

export async function getVlmProvider(row: UserProvider): Promise<VlmProvider> {
  if (row.id === LOCAL_OCR_PROVIDER_ID) return BUILTIN_VISION_PROVIDERS['local-ocr'].create();
  return getUserVlmProvider(row);
}
