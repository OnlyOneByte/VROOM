import { createModelProviderResolver } from '../model/model-registry';
import { AnthropicVlmProvider } from './anthropic';
import { GeminiVlmProvider } from './gemini';
import { OpenAiCompatibleVlmProvider } from './openai-compatible';
import type { VlmProvider } from './vlm-provider';

export const getVlmProvider = createModelProviderResolver<VlmProvider>('VLM', {
  'openai-compatible': OpenAiCompatibleVlmProvider,
  anthropic: AnthropicVlmProvider,
  gemini: GeminiVlmProvider,
});
