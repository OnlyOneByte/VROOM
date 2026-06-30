/**
 * Anthropic + Gemini LLM (assistant) chat+tools adapters (llm-assistant T3b). Drives the REAL adapters
 * against a stubbed global fetch (no live key/endpoint) and pins the request SHAPE + the dumb-transport
 * normalization + the failure-honesty rules, mirroring the T3a openai-compatible adapter test:
 *  - Anthropic: POST {baseUrl}/v1/messages with x-api-key + anthropic-version (NOT Bearer); a system-role
 *    message lifts to the top-level `system`; tools[] are {name, description, input_schema}; a tool_use
 *    response block → ChatResult.toolCalls; a text block → ChatResult.text.
 *  - Gemini: POST {baseUrl}/v1beta/models/{model}:generateContent?key=... (key in the QUERY, not a header);
 *    a system-role message → systemInstruction; tools → [{ functionDeclarations }]; a functionCall part →
 *    ChatResult.toolCalls; a text part → ChatResult.text.
 *  - both: a non-2xx / network failure THROWS (the chat route maps it to 502 — never a faked answer).
 *
 * Adapters = dumb transport: they map the wire format both ways but NEVER execute a tool or trust args —
 * the orchestrator (T4) validates. These assert transport + headers + the wire mapping + error-honesty.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AnthropicLlmProvider } from '../anthropic';
import { GeminiLlmProvider } from '../gemini';
import type { ChatMessage, ToolDefinition } from '../llm-provider';
import type { LlmProviderSettings } from '../registry';

const realFetch = globalThis.fetch;

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}
let captured: CapturedRequest | null;

function stubFetch(responder: () => Response | Promise<Response>): void {
  captured = null;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    captured = {
      url: String(input),
      headers: (init?.headers as Record<string, string>) ?? {},
      body: init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {},
    };
    return responder();
    // biome-ignore lint/suspicious/noExplicitAny: test fetch stub.
  }) as any;
}

const SETTINGS: LlmProviderSettings = { apiKey: 'sk-assistant-key', model: 'claude-3-5-sonnet' };
const GEMINI_SETTINGS: LlmProviderSettings = { apiKey: 'gm-key-123', model: 'gemini-1.5-pro' };

const MESSAGES: ChatMessage[] = [
  { role: 'system', content: 'You are a car-data assistant.' },
  { role: 'user', content: 'How much did I spend on fuel?' },
];
const TOOLS: ToolDefinition[] = [
  {
    name: 'getExpenseSummary',
    description: 'Total spend over a range.',
    parameters: { type: 'object', properties: { range: { type: 'string' } }, required: ['range'] },
  },
];

beforeEach(() => {
  captured = null;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('AnthropicLlmProvider.chat (T3b)', () => {
  function anthropicText(text: string): Response {
    return new Response(JSON.stringify({ content: [{ type: 'text', text }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  function anthropicToolUse(id: string, name: string, input: unknown): Response {
    return new Response(JSON.stringify({ content: [{ type: 'tool_use', id, name, input }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  test('POSTs to /v1/messages with x-api-key + anthropic-version (NOT Bearer) + system lifted', async () => {
    stubFetch(() => anthropicText('hi'));
    await new AnthropicLlmProvider(SETTINGS).chat({ messages: MESSAGES, tools: TOOLS });

    expect(captured?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(captured?.headers['x-api-key']).toBe('sk-assistant-key');
    expect(captured?.headers['anthropic-version']).toBe('2023-06-01');
    expect(captured?.headers.Authorization).toBeUndefined();
    // The system message is the top-level `system` field, not a message.
    expect(captured?.body.system).toBe('You are a car-data assistant.');
    const msgs = captured?.body.messages as Array<{ role: string }>;
    expect(msgs).toHaveLength(1); // only the user message remains
    expect(msgs[0].role).toBe('user');
    // tools[] use input_schema.
    const tools = captured?.body.tools as Array<{ name: string; input_schema: unknown }>;
    expect(tools[0].name).toBe('getExpenseSummary');
    expect(tools[0].input_schema).toEqual(TOOLS[0].parameters);
  });

  test('a text response normalizes to ChatResult.text', async () => {
    stubFetch(() => anthropicText('You spent $50.'));
    const r = await new AnthropicLlmProvider(SETTINGS).chat({ messages: MESSAGES, tools: TOOLS });
    expect(r.text).toBe('You spent $50.');
    expect(r.toolCalls).toBeUndefined();
  });

  test('a tool_use response normalizes to ChatResult.toolCalls (name + RAW args JSON)', async () => {
    stubFetch(() => anthropicToolUse('tu_1', 'getExpenseSummary', { range: 'ytd' }));
    const r = await new AnthropicLlmProvider(SETTINGS).chat({ messages: MESSAGES, tools: TOOLS });
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls?.[0]).toEqual({
      id: 'tu_1',
      name: 'getExpenseSummary',
      argumentsJson: '{"range":"ytd"}',
    });
  });

  test('a tool RESULT message maps to a user tool_result block keyed by tool_use_id', async () => {
    stubFetch(() => anthropicText('done'));
    const withTool: ChatMessage[] = [
      ...MESSAGES,
      {
        role: 'tool',
        content: '{"totalAmount":5000}',
        toolName: 'getExpenseSummary',
        toolCallId: 'tu_1',
      },
    ];
    await new AnthropicLlmProvider(SETTINGS).chat({ messages: withTool, tools: TOOLS });
    const msgs = captured?.body.messages as Array<{ role: string; content: unknown }>;
    const last = msgs[msgs.length - 1];
    expect(last.role).toBe('user');
    const block = (last.content as Record<string, unknown>[])[0];
    expect(block.type).toBe('tool_result');
    expect(block.tool_use_id).toBe('tu_1');
  });

  test('a non-2xx response THROWS (anti-fail-open)', async () => {
    stubFetch(() => new Response('overloaded', { status: 529 }));
    await expect(
      new AnthropicLlmProvider(SETTINGS).chat({ messages: MESSAGES, tools: TOOLS })
    ).rejects.toThrow(/HTTP 529/);
  });

  test('the constructor requires an API key', () => {
    expect(() => new AnthropicLlmProvider({ model: 'claude-3-5-sonnet' })).toThrow(/API key/);
  });
});

describe('GeminiLlmProvider.chat (T3b)', () => {
  function geminiText(text: string): Response {
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  function geminiFunctionCall(name: string, args: unknown): Response {
    return new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name, args } }] } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  test('POSTs to generateContent with the key in the QUERY param + systemInstruction + functionDeclarations', async () => {
    stubFetch(() => geminiText('hi'));
    await new GeminiLlmProvider(GEMINI_SETTINGS).chat({ messages: MESSAGES, tools: TOOLS });

    expect(captured?.url).toContain('/v1beta/models/gemini-1.5-pro:generateContent?key=gm-key-123');
    // The key is NOT a header (it is the query param) — never logged via headers.
    expect(JSON.stringify(captured?.headers)).not.toContain('gm-key-123');
    const sys = captured?.body.systemInstruction as { parts: Array<{ text: string }> };
    expect(sys.parts[0].text).toBe('You are a car-data assistant.');
    const tools = captured?.body.tools as Array<{ functionDeclarations: Array<{ name: string }> }>;
    expect(tools[0].functionDeclarations[0].name).toBe('getExpenseSummary');
    // assistant/user contents only (system was lifted).
    const contents = captured?.body.contents as Array<{ role: string }>;
    expect(contents).toHaveLength(1);
    expect(contents[0].role).toBe('user');
  });

  test('a text part normalizes to ChatResult.text', async () => {
    stubFetch(() => geminiText('You spent $50.'));
    const r = await new GeminiLlmProvider(GEMINI_SETTINGS).chat({
      messages: MESSAGES,
      tools: TOOLS,
    });
    expect(r.text).toBe('You spent $50.');
  });

  test('a functionCall part normalizes to ChatResult.toolCalls (name + RAW args JSON)', async () => {
    stubFetch(() => geminiFunctionCall('getFuelStats', { range: '30d' }));
    const r = await new GeminiLlmProvider(GEMINI_SETTINGS).chat({
      messages: MESSAGES,
      tools: TOOLS,
    });
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls?.[0].name).toBe('getFuelStats');
    expect(r.toolCalls?.[0].argumentsJson).toBe('{"range":"30d"}');
  });

  test('a tool RESULT message maps to a function-role functionResponse part', async () => {
    stubFetch(() => geminiText('done'));
    const withTool: ChatMessage[] = [
      ...MESSAGES,
      { role: 'tool', content: '{"x":1}', toolName: 'getFuelStats', toolCallId: 'c1' },
    ];
    await new GeminiLlmProvider(GEMINI_SETTINGS).chat({ messages: withTool, tools: TOOLS });
    const contents = captured?.body.contents as Array<{ role: string; parts: unknown }>;
    const last = contents[contents.length - 1];
    expect(last.role).toBe('function');
    const part = (last.parts as Record<string, { name?: string }>[])[0];
    expect(part.functionResponse?.name).toBe('getFuelStats');
  });

  test('a non-2xx response THROWS (anti-fail-open)', async () => {
    stubFetch(() => new Response('quota', { status: 429 }));
    await expect(
      new GeminiLlmProvider(GEMINI_SETTINGS).chat({ messages: MESSAGES, tools: TOOLS })
    ).rejects.toThrow(/HTTP 429/);
  });

  test('the constructor requires an API key', () => {
    expect(() => new GeminiLlmProvider({ model: 'gemini-1.5-pro' })).toThrow(/API key/);
  });
});
