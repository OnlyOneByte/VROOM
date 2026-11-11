/**
 * Anthropic Messages API adapter. Dumb transport: it never executes tools or trusts tool args.
 * Failures throw so the chat route can answer 502 instead of a fake success.
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
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_BASE_URL = 'https://api.anthropic.com';

interface AnthropicBlock {
  type?: string;
  text?: unknown;
  id?: string;
  name?: string;
  input?: unknown;
}
interface AnthropicResponse {
  content?: AnthropicBlock[];
}

export class AnthropicLlmProvider implements LlmProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(settings: LlmProviderSettings) {
    if (!settings.apiKey) {
      throw new Error('Anthropic LLM requires an API key');
    }
    this.apiKey = settings.apiKey;
    this.model = settings.model;
    this.baseUrl = (settings.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    // Anthropic takes the system prompt as a top-level field, not a message.
    const system = request.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const messages = request.messages.filter((m) => m.role !== 'system').map(toAnthropicMessage);

    const body = {
      model: this.model,
      max_tokens: MAX_TOKENS,
      temperature: 0,
      ...(system ? { system } : {}),
      messages,
      ...(request.tools.length > 0 ? { tools: request.tools.map(toAnthropicTool) } : {}),
    };

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'network error';
      logger.warn('LLM anthropic request failed', { model: this.model, error: message });
      throw new Error(`LLM request failed: ${message}`);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      logger.warn('LLM anthropic non-2xx', {
        model: this.model,
        status: res.status,
        detail: detail.slice(0, 200),
      });
      throw new Error(`LLM provider returned HTTP ${res.status}`);
    }

    const json = (await res.json().catch(() => null)) as AnthropicResponse | null;
    return normalizeResponse(json);
  }
}

function toAnthropicMessage(m: ChatMessage): Record<string, unknown> {
  if (m.role === 'tool') {
    return {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: m.toolCallId ?? '', content: m.content }],
    };
  }
  return { role: m.role, content: m.content };
}

function toAnthropicTool(t: ToolDefinition): Record<string, unknown> {
  return { name: t.name, description: t.description, input_schema: t.parameters };
}

/** A malformed 2xx body yields empty text rather than throwing. */
function normalizeResponse(json: AnthropicResponse | null): ChatResult {
  const blocks = json?.content ?? [];
  const toolUses = blocks.filter((b) => b.type === 'tool_use');
  if (toolUses.length > 0) {
    const toolCalls: ToolCall[] = toolUses.map((b, i) => ({
      id: typeof b.id === 'string' ? b.id : `call_${i}`,
      name: typeof b.name === 'string' ? b.name : '',
      argumentsJson: JSON.stringify(b.input ?? {}),
    }));
    return { toolCalls };
  }
  const text = blocks
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('');
  return { text };
}
