/**
 * Gemini generateContent adapter. Dumb transport: it never executes tools or trusts tool args.
 */

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
const MAX_OUTPUT_TOKENS = 1024;
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';

interface GeminiPart {
  text?: unknown;
  functionCall?: { name?: string; args?: unknown };
}
interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] } }[];
}
interface GeminiContent {
  role: 'user' | 'model' | 'function';
  parts: Record<string, unknown>[];
}

export class GeminiLlmProvider implements LlmProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(settings: ModelProviderSettings) {
    if (!settings.apiKey) {
      throw new Error('Gemini LLM requires an API key');
    }
    this.apiKey = settings.apiKey;
    this.model = settings.model;
    this.baseUrl = trimBaseUrl(settings.baseUrl ?? DEFAULT_BASE_URL);
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    const system = request.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');

    const json = await postModelJson<GeminiResponse>({
      domain: 'LLM',
      providerType: 'gemini',
      model: this.model,
      url: `${this.baseUrl}/v1beta/models/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`,
      timeoutMs: REQUEST_TIMEOUT_MS,
      body: {
        contents: toGeminiContents(request.messages),
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        ...(request.tools.length > 0
          ? { tools: [{ functionDeclarations: request.tools.map(toGeminiFunctionDecl) }] }
          : {}),
        generationConfig: { temperature: 0, maxOutputTokens: MAX_OUTPUT_TOKENS },
      },
    });
    return normalizeResponse(json);
  }
}

/**
 * Tool calls become functionCall parts on the model turn, and every result for that turn goes in ONE
 * following function-role content, one functionResponse part per call in the same order.
 */
function toGeminiContents(messages: ChatMessage[]): GeminiContent[] {
  const out: GeminiContent[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      const part = { functionResponse: { name: m.toolName, response: { content: m.content } } };
      const prev = out[out.length - 1];
      if (prev?.role === 'function') {
        prev.parts.push(part);
      } else {
        out.push({ role: 'function', parts: [part] });
      }
      continue;
    }
    if (m.role === 'assistant') {
      const calls = m.toolCalls ?? [];
      out.push({
        role: 'model',
        parts: [
          ...(m.content.length > 0 || calls.length === 0 ? [{ text: m.content }] : []),
          ...calls.map((c) => ({
            functionCall: { name: c.name, args: parseToolArguments(c.argumentsJson) },
          })),
        ],
      });
      continue;
    }
    out.push({ role: 'user', parts: [{ text: m.content }] });
  }
  return out;
}

function toGeminiFunctionDecl(t: ToolDefinition): Record<string, unknown> {
  return { name: t.name, description: t.description, parameters: t.parameters };
}

/** A malformed 2xx body yields empty text rather than throwing. */
function normalizeResponse(json: GeminiResponse | null): ChatResult {
  const parts = json?.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .filter((p) => typeof p.text === 'string')
    .map((p) => p.text as string)
    .join('');
  const calls = parts.filter((p) => p.functionCall && typeof p.functionCall.name === 'string');
  if (calls.length > 0) {
    const toolCalls: ToolCall[] = calls.map((p, i) => ({
      id: `call_${i}`,
      name: p.functionCall?.name ?? '',
      argumentsJson: JSON.stringify(p.functionCall?.args ?? {}),
    }));
    return text ? { text, toolCalls } : { toolCalls };
  }
  return { text };
}
