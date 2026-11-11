/**
 * OpenAI Chat Completions adapter, also used for Ollama and other OpenAI-compatible endpoints.
 * Dumb transport: it never executes tools or trusts tool args.
 */

import type { ModelProviderSettings } from '../model/model-registry';
import { postModelJson, trimBaseUrl } from '../model/model-transport';
import type {
  ChatMessage,
  ChatRequest,
  ChatResult,
  LlmProvider,
  ToolCall,
  ToolDefinition,
} from './llm-provider';

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_TOKENS = 1024;

interface OpenAiToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}
interface OpenAiResponse {
  choices?: { message?: { content?: unknown; tool_calls?: OpenAiToolCall[] } }[];
}

export class OpenAiCompatibleLlmProvider implements LlmProvider {
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(settings: ModelProviderSettings) {
    if (!settings.baseUrl) {
      throw new Error('OpenAI-compatible LLM requires a base URL');
    }
    this.apiKey = settings.apiKey;
    this.model = settings.model;
    this.baseUrl = trimBaseUrl(settings.baseUrl);
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    const json = await postModelJson<OpenAiResponse>({
      domain: 'LLM',
      providerType: 'openai-compatible',
      model: this.model,
      url: `${this.baseUrl}/chat/completions`,
      headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
      timeoutMs: REQUEST_TIMEOUT_MS,
      body: {
        model: this.model,
        max_tokens: MAX_TOKENS,
        temperature: 0,
        messages: request.messages.map(toOpenAiMessage),
        ...(request.tools.length > 0 ? { tools: request.tools.map(toOpenAiTool) } : {}),
      },
    });
    return normalizeResponse(json);
  }
}

function toOpenAiMessage(m: ChatMessage): Record<string, unknown> {
  switch (m.role) {
    case 'tool':
      return { role: 'tool', tool_call_id: m.toolCallId, name: m.toolName, content: m.content };
    case 'assistant':
      if (m.toolCalls && m.toolCalls.length > 0) {
        return {
          role: 'assistant',
          content: m.content.length > 0 ? m.content : null,
          tool_calls: m.toolCalls.map((c) => ({
            id: c.id,
            type: 'function',
            function: { name: c.name, arguments: c.argumentsJson },
          })),
        };
      }
      return { role: 'assistant', content: m.content };
    default:
      return { role: m.role, content: m.content };
  }
}

function toOpenAiTool(t: ToolDefinition): Record<string, unknown> {
  return {
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  };
}

/** A malformed 2xx body yields empty text rather than throwing. */
function normalizeResponse(json: OpenAiResponse | null): ChatResult {
  const message = json?.choices?.[0]?.message;
  const content = typeof message?.content === 'string' ? message.content : '';
  const rawCalls = message?.tool_calls;
  if (Array.isArray(rawCalls) && rawCalls.length > 0) {
    const toolCalls: ToolCall[] = rawCalls.map((c, i) => ({
      id: typeof c.id === 'string' ? c.id : `call_${i}`,
      name: c.function?.name ?? '',
      argumentsJson: typeof c.function?.arguments === 'string' ? c.function.arguments : '{}',
    }));
    return content ? { text: content, toolCalls } : { toolCalls };
  }
  return { text: content };
}
