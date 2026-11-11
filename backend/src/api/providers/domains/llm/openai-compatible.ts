/**
 * OpenAI Chat Completions adapter, also used for Ollama and other OpenAI-compatible endpoints.
 * Dumb transport: it never executes tools or trusts tool args. Failures throw so the chat route
 * can answer 502 instead of a fake success.
 */

import { logger } from '../../../../utils/logger';
import type {
  ChatMessage,
  ChatRequest,
  ChatResult,
  LlmProvider,
  ToolCall,
  ToolDefinition,
} from './llm-provider';
import type { LlmProviderSettings } from './registry';

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

  constructor(settings: LlmProviderSettings) {
    if (!settings.baseUrl) {
      throw new Error('OpenAI-compatible LLM requires a base URL');
    }
    this.apiKey = settings.apiKey;
    this.model = settings.model;
    this.baseUrl = settings.baseUrl.replace(/\/+$/, '');
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const body = {
      model: this.model,
      max_tokens: MAX_TOKENS,
      temperature: 0,
      messages: request.messages.map(toOpenAiMessage),
      ...(request.tools.length > 0 ? { tools: request.tools.map(toOpenAiTool) } : {}),
    };

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // Logs must never include the api key or the prompt.
      const message = err instanceof Error ? err.message : 'network error';
      logger.warn('LLM openai-compatible request failed', { model: this.model, error: message });
      throw new Error(`LLM request failed: ${message}`);
    }

    if (!res.ok) {
      // The error body is logged, never echoed to the client.
      const detail = await res.text().catch(() => '');
      logger.warn('LLM openai-compatible non-2xx', {
        model: this.model,
        status: res.status,
        detail: detail.slice(0, 200),
      });
      throw new Error(`LLM provider returned HTTP ${res.status}`);
    }

    const json = (await res.json().catch(() => null)) as OpenAiResponse | null;
    return normalizeResponse(json);
  }
}

function toOpenAiMessage(m: ChatMessage): Record<string, unknown> {
  if (m.role === 'tool') {
    return {
      role: 'tool',
      content: m.content,
      ...(m.toolName ? { name: m.toolName } : {}),
      ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
    };
  }
  return { role: m.role, content: m.content };
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
  const rawCalls = message?.tool_calls;
  if (Array.isArray(rawCalls) && rawCalls.length > 0) {
    const toolCalls: ToolCall[] = rawCalls.map((c, i) => ({
      id: typeof c.id === 'string' ? c.id : `call_${i}`,
      name: c.function?.name ?? '',
      argumentsJson: typeof c.function?.arguments === 'string' ? c.function.arguments : '{}',
    }));
    return { toolCalls };
  }
  const content = message?.content;
  return { text: typeof content === 'string' ? content : '' };
}
