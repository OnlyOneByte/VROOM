import { createModelProviderResolver } from '../model/model-registry';
import { AnthropicLlmProvider } from './anthropic';
import { GeminiLlmProvider } from './gemini';
import type { LlmProvider } from './llm-provider';
import { OpenAiCompatibleLlmProvider } from './openai-compatible';

/** Resolves a domain:'llm' user_providers row into an LlmProvider. */
export const getLlmProvider = createModelProviderResolver<LlmProvider>('LLM', {
  'openai-compatible': OpenAiCompatibleLlmProvider,
  anthropic: AnthropicLlmProvider,
  gemini: GeminiLlmProvider,
});
