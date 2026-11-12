import type { ModelProviderSettings } from '../model/model-registry';
import { postModelJson, trimBaseUrl } from '../model/model-transport';
import {
  type ChatMessage,
  type ChatRequest,
  type ChatResult,
  type LlmProvider,
  parseToolArguments,
  type ToolCall,
  type ToolDefinition,
} from './llm-provider';

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
interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | Record<string, unknown>[];
}

export class AnthropicLlmProvider implements LlmProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(settings: ModelProviderSettings) {
    if (!settings.apiKey) {
      throw new Error('Anthropic LLM requires an API key');
    }
    this.apiKey = settings.apiKey;
    this.model = settings.model;
    this.baseUrl = trimBaseUrl(settings.baseUrl ?? DEFAULT_BASE_URL);
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    // Anthropic takes the system prompt as a top-level field, not a message.
    const system = request.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');

    const json = await postModelJson<AnthropicResponse>({
      domain: 'LLM',
      providerType: 'anthropic',
      model: this.model,
      url: `${this.baseUrl}/v1/messages`,
      headers: { 'x-api-key': this.apiKey, 'anthropic-version': ANTHROPIC_VERSION },
      timeoutMs: REQUEST_TIMEOUT_MS,
      body: {
        model: this.model,
        max_tokens: MAX_TOKENS,
        temperature: 0,
        ...(system ? { system } : {}),
        messages: toAnthropicMessages(request.messages),
        ...(request.tools.length > 0 ? { tools: request.tools.map(toAnthropicTool) } : {}),
      },
    });
    return normalizeResponse(json);
  }
}

// Anthropic requires every tool_result for a turn in one user message after the tool_use turn.
function toAnthropicMessages(messages: ChatMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content };
      const prev = out[out.length - 1];
      if (prev?.role === 'user' && Array.isArray(prev.content) && isToolResults(prev.content)) {
        prev.content.push(block);
      } else {
        out.push({ role: 'user', content: [block] });
      }
      continue;
    }
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      out.push({
        role: 'assistant',
        content: [
          ...(m.content.length > 0 ? [{ type: 'text', text: m.content }] : []),
          ...m.toolCalls.map((c) => ({
            type: 'tool_use',
            id: c.id,
            name: c.name,
            input: parseToolArguments(c.argumentsJson),
          })),
        ],
      });
      continue;
    }
    out.push({ role: m.role, content: m.content });
  }
  return out;
}

function isToolResults(blocks: Record<string, unknown>[]): boolean {
  return blocks.every((b) => b.type === 'tool_result');
}

function toAnthropicTool(t: ToolDefinition): Record<string, unknown> {
  return { name: t.name, description: t.description, input_schema: t.parameters };
}

function normalizeResponse(json: AnthropicResponse | null): ChatResult {
  const blocks = json?.content ?? [];
  const text = blocks
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('');
  const toolUses = blocks.filter((b) => b.type === 'tool_use');
  if (toolUses.length > 0) {
    const toolCalls: ToolCall[] = toolUses.map((b, i) => ({
      id: typeof b.id === 'string' ? b.id : `call_${i}`,
      name: typeof b.name === 'string' ? b.name : '',
      argumentsJson: JSON.stringify(b.input ?? {}),
    }));
    return text ? { text, toolCalls } : { toolCalls };
  }
  return { text };
}
