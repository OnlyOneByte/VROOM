import { createModelProviderResolver } from '../model/model-registry';
import { AnthropicLlmProvider } from './anthropic';
import { GeminiLlmProvider } from './gemini';
import type { LlmProvider } from './llm-provider';
import { OpenAiCompatibleLlmProvider } from './openai-compatible';

export const getLlmProvider = createModelProviderResolver<LlmProvider>('LLM', {
  'openai-compatible': OpenAiCompatibleLlmProvider,
  anthropic: AnthropicLlmProvider,
  gemini: GeminiLlmProvider,
});
