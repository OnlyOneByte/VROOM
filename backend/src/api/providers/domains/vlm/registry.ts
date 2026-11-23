import {
  createModelProviderResolver,
  type ModelAdapters,
  type ModelProviderDescriptor,
  modelDescriptor,
} from '../model/model-registry';
import { AnthropicVlmProvider } from './anthropic';
import { GeminiVlmProvider } from './gemini';
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

export const getVlmProvider = createModelProviderResolver<'ai.vision', VlmProvider>(
  'ai.vision',
  VISION_PROVIDERS
);
