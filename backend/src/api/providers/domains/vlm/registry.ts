import { createModelProviderResolver } from '../model/model-registry';
import { AnthropicVlmProvider } from './anthropic';
import { GeminiVlmProvider } from './gemini';
import { OpenAiCompatibleVlmProvider } from './openai-compatible';
import type { VlmProvider } from './vlm-provider';

/** Resolves a domain:'vlm' user_providers row into a VlmProvider. */
export const getVlmProvider = createModelProviderResolver<VlmProvider>('VLM', {
  'openai-compatible': OpenAiCompatibleVlmProvider,
  anthropic: AnthropicVlmProvider,
  gemini: GeminiVlmProvider,
});
