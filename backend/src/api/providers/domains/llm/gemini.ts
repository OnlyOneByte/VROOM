/**
 * Google Gemini LLM (assistant) adapter (llm-assistant T3b). Implements `LlmProvider.chat` against the
 * Gemini generateContent API (`POST {baseUrl}/v1beta/models/{model}:generateContent?key=...`) with
 * function calling. Mirrors the VLM Gemini adapter's transport (api key as a `?key=` QUERY param, kept
 * OUT of logs) and the dumb-transport contract.
 *
 * DUMB TRANSPORT (design §3/§4): maps VROOM's ChatMessage[] + ToolDefinition[] into Gemini's wire format
 * and normalizes the response into `{ text?, toolCalls? }`; it NEVER executes a tool or trusts the args —
 * the orchestrator (T4) validates. A non-2xx / network / timeout failure THROWS (the chat route maps it
 * to 502; never a faked success — the #43/#44/#144 anti-fail-open lesson).
 *
 * Wire mapping notes:
 *  - Gemini roles are `user` / `model` (assistant→model). A `system` ChatMessage → top-level
 *    `systemInstruction`. Tools → a single `{ functionDeclarations: [...] }` entry.
 *  - A `tool` RESULT goes back as a `function`-role part `{ functionResponse: { name, response } }`.
 *  - A response part may be `text` OR `functionCall { name, args }`; a functionCall → ChatResult.toolCalls
 *    (name + JSON.stringify(args)); otherwise the joined text → ChatResult.text.
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

/** The Gemini response parts we read (only the fields we use). */
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

    // The api key is a query param, not a header — keep it out of every log line.
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

/** Map a VROOM ChatMessage to a Gemini `contents[]` entry. A `tool` result → a functionResponse part. */
function toGeminiContent(m: ChatMessage): Record<string, unknown> {
  if (m.role === 'tool') {
    return {
      role: 'function',
      parts: [
        {
          functionResponse: {
            name: m.toolName ?? '',
            // Gemini wants a structured response object; wrap the JSON string under `content`.
            response: { content: m.content },
          },
        },
      ],
    };
  }
  // assistant → 'model'; user → 'user'.
  return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] };
}

/** Map a VROOM ToolDefinition to a Gemini functionDeclaration `{ name, description, parameters }`. */
function toGeminiFunctionDecl(t: ToolDefinition): Record<string, unknown> {
  return { name: t.name, description: t.description, parameters: t.parameters };
}

/**
 * Normalize the Gemini response into ChatResult. `functionCall` parts → toolCalls (name + RAW args JSON —
 * the orchestrator validates); otherwise the joined `text` parts → text. Neither → { text: '' } (no throw).
 */
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
