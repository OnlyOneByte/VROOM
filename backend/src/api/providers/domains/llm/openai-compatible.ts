/**
 * OpenAI-compatible LLM (assistant) adapter (llm-assistant T3a). Implements `LlmProvider.chat` against
 * the OpenAI Chat Completions API with function/tool calling (`POST {baseUrl}/chat/completions` with a
 * `tools` array). This ONE adapter covers OpenAI itself, the many OpenAI-API-compatible gateways, AND
 * self-hosted Ollama (same `/v1/chat/completions` + tools shape via a `baseUrl`) — the common denominator
 * of every D1 option (design §3). The first-party Anthropic + Gemini adapters land in T3b.
 *
 * DUMB TRANSPORT (the load-bearing safety boundary, design §3/§4): it maps VROOM's `ChatMessage[]` +
 * `ToolDefinition[]` into the OpenAI wire format, sends them, and normalizes the response into either
 * assistant text OR a list of requested tool calls. It NEVER executes a tool and NEVER trusts the
 * tool-call args — the orchestrator (T4) allowlist-checks the name + Zod-validates the args + runs the
 * tool userId-scoped. A non-2xx / network / timeout failure THROWS (the chat route maps it to a 502;
 * never a faked success — the #43/#44/#144 anti-fail-open lesson). The api key (when present) goes in the
 * Authorization header; a keyless config (self-hosted Ollama) omits it.
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

/** Hard ceiling on a single chat round (cost + a hung-endpoint guard). */
const REQUEST_TIMEOUT_MS = 60_000;
/** Cap the completion size — a grounded answer + a few tool calls is small. */
const MAX_TOKENS = 1024;

/** The OpenAI wire shapes we read off the response (only the fields we use). */
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
      // Defense-in-depth: the create/PUT gate + resolveLlmSettings already require this.
      throw new Error('OpenAI-compatible LLM requires a base URL');
    }
    this.apiKey = settings.apiKey;
    this.model = settings.model;
    // Normalize: callers give e.g. https://api.openai.com/v1 (or an Ollama http://host:11434/v1).
    this.baseUrl = settings.baseUrl.replace(/\/+$/, '');
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    // Keyless self-hosted (Ollama) sends no Authorization header; everything else uses Bearer.
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const body = {
      model: this.model,
      max_tokens: MAX_TOKENS,
      // Low temperature — a grounded data answer, not creative writing.
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
      // Network failure / timeout — surface honestly (route → 502). Do NOT log the api key or the prompt.
      const message = err instanceof Error ? err.message : 'network error';
      logger.warn('LLM openai-compatible request failed', { model: this.model, error: message });
      throw new Error(`LLM request failed: ${message}`);
    }

    if (!res.ok) {
      // Read a short error body for the log, but never echo it to the client verbatim.
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

/** Map a VROOM ChatMessage to the OpenAI wire shape. A `tool` result carries its tool name + call id. */
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

/** Map a VROOM ToolDefinition to the OpenAI `tools[]` function-calling shape. */
function toOpenAiTool(t: ToolDefinition): Record<string, unknown> {
  return {
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  };
}

/**
 * Normalize the OpenAI response into the dumb-transport `ChatResult`. If the model requested tool calls,
 * return them (name + RAW args string — the orchestrator validates); otherwise return the assistant text.
 * A missing/empty content with no tool calls yields `{ text: '' }` (the route renders a generic fallback),
 * never a throw — a malformed-but-2xx body is not a transport failure.
 */
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
