import {
  createModelProviderResolver,
  type ModelAdapters,
  type ModelProviderDescriptor,
  modelDescriptor,
} from '../model/model-registry';
import { AnthropicLlmProvider } from './anthropic';
import { GeminiLlmProvider } from './gemini';
import type { LlmProvider } from './llm-provider';
import { OpenAiCompatibleLlmProvider } from './openai-compatible';

const ADAPTERS: ModelAdapters<LlmProvider> = {
  'openai-compatible': OpenAiCompatibleLlmProvider,
  anthropic: AnthropicLlmProvider,
  gemini: GeminiLlmProvider,
};

export const LLM_PROVIDERS = {
  'openai-compatible': modelDescriptor('ai.llm', ADAPTERS, {
    label: 'OpenAI-compatible',
    vendor: 'OpenAI-compatible',
    description: 'OpenAI or any OpenAI-compatible API',
    transport: 'openai-compatible',
    model: 'gpt-4o-mini',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: true,
  }),
  anthropic: modelDescriptor('ai.llm', ADAPTERS, {
    label: 'Anthropic (Claude)',
    vendor: 'Anthropic',
    description: 'Claude models from Anthropic',
    transport: 'anthropic',
    model: 'claude-opus-5-5',
    apiKey: true,
  }),
  gemini: modelDescriptor('ai.llm', ADAPTERS, {
    label: 'Google Gemini',
    vendor: 'Gemini',
    description: 'Gemini models from Google',
    transport: 'gemini',
    model: 'gemini-1.5-flash',
    apiKey: true,
  }),
  ollama: modelDescriptor('ai.llm', ADAPTERS, {
    label: 'Ollama (self-hosted)',
    vendor: 'Ollama',
    description: 'A model you run yourself with Ollama',
    transport: 'openai-compatible',
    model: 'llama3.1',
    baseUrl: 'http://localhost:11434/v1',
    apiKey: false,
  }),
} satisfies Record<string, ModelProviderDescriptor<'ai.llm', LlmProvider>>;

export const getLlmProvider = createModelProviderResolver<'ai.llm', LlmProvider>(
  'ai.llm',
  LLM_PROVIDERS
);
