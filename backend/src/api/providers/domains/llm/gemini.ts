/**
 * Gemini generateContent adapter. Dumb transport: it never executes tools or trusts tool args.
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
const MAX_OUTPUT_TOKENS = 1024;
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';

interface GeminiPart {
  text?: unknown;
  functionCall?: { name?: string; args?: unknown };
}
interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] } }[];
}

export class GeminiLlmProvider implements LlmProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(settings: LlmProviderSettings) {
    if (!settings.apiKey) {
      throw new Error('Gemini LLM requires an API key');
    }
    this.apiKey = settings.apiKey;
    this.model = settings.model;
    this.baseUrl = (settings.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    const system = request.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const contents = request.messages.filter((m) => m.role !== 'system').map(toGeminiContent);

    const body = {
      contents,
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      ...(request.tools.length > 0
        ? { tools: [{ functionDeclarations: request.tools.map(toGeminiFunctionDecl) }] }
        : {}),
      generationConfig: { temperature: 0, maxOutputTokens: MAX_OUTPUT_TOKENS },
    };

    // Gemini takes the key as a query param; it must never reach a log line.
    const url = `${this.baseUrl}/v1beta/models/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'network error';
      logger.warn('LLM gemini request failed', { model: this.model, error: message });
      throw new Error(`LLM request failed: ${message}`);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      logger.warn('LLM gemini non-2xx', {
        model: this.model,
        status: res.status,
        detail: detail.slice(0, 200),
      });
      throw new Error(`LLM provider returned HTTP ${res.status}`);
    }

    const json = (await res.json().catch(() => null)) as GeminiResponse | null;
    return normalizeResponse(json);
  }
}

function toGeminiContent(m: ChatMessage): Record<string, unknown> {
  if (m.role === 'tool') {
    return {
      role: 'function',
      parts: [
        {
          functionResponse: {
            name: m.toolName ?? '',
            response: { content: m.content },
          },
        },
      ],
    };
  }
  return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] };
}

function toGeminiFunctionDecl(t: ToolDefinition): Record<string, unknown> {
  return { name: t.name, description: t.description, parameters: t.parameters };
}

/** A malformed 2xx body yields empty text rather than throwing. */
function normalizeResponse(json: GeminiResponse | null): ChatResult {
  const parts = json?.candidates?.[0]?.content?.parts ?? [];
  const calls = parts.filter((p) => p.functionCall && typeof p.functionCall.name === 'string');
  if (calls.length > 0) {
    const toolCalls: ToolCall[] = calls.map((p, i) => ({
      id: `call_${i}`,
      name: p.functionCall?.name ?? '',
      argumentsJson: JSON.stringify(p.functionCall?.args ?? {}),
    }));
    return { toolCalls };
  }
  const text = parts
    .filter((p) => typeof p.text === 'string')
    .map((p) => p.text as string)
    .join('');
  return { text };
}
