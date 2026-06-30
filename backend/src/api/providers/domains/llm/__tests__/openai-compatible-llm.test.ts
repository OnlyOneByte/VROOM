/**
 * OpenAiCompatibleLlmProvider adapter (llm-assistant T3a). Drives the REAL adapter against a stubbed
 * global fetch (no live key/endpoint) and pins the request SHAPE + the dumb-transport normalization +
 * the failure-honesty rules:
 *  - POSTs to {baseUrl}/chat/completions with the transcript messages + a `tools` array (function shape);
 *  - a Bearer Authorization header is present with a key, ABSENT for keyless self-hosted (Ollama);
 *  - a model response with `tool_calls` normalizes to ChatResult.toolCalls (name + RAW args string), and
 *    a plain content response normalizes to ChatResult.text — the orchestrator (T4) validates either;
 *  - a non-2xx / network failure THROWS (the chat route maps it to 502 — never a faked success);
 *  - a missing/non-string content with no tool calls returns { text: '' } (no throw).
 *
 * Adapter = dumb transport: it does NOT execute tools or validate args (that is the orchestrator), so
 * these tests assert transport + headers + the wire mapping + error-honesty, not tool semantics.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { UserProvider } from '../../../../../db/schema';
import { encrypt } from '../../../../../utils/encryption';
import type { ChatMessage, ToolDefinition } from '../llm-provider';
import { OpenAiCompatibleLlmProvider } from '../openai-compatible';
import { getLlmProvider, type LlmProviderSettings, resolveLlmSettings } from '../registry';

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

function textResponse(content: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
function toolCallResponse(name: string, args: string): Response {
  return new Response(
    JSON.stringify({
      choices: [
        { message: { tool_calls: [{ id: 'call_1', function: { name, arguments: args } }] } },
      ],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

const KEYED: LlmProviderSettings = {
  apiKey: 'sk-assistant-key',
  model: 'gpt-4o',
  baseUrl: 'https://api.openai.com/v1',
};
const KEYLESS: LlmProviderSettings = { model: 'llama3.1', baseUrl: 'http://localhost:11434/v1' };

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

describe('OpenAiCompatibleLlmProvider.chat — request shape', () => {
  test('POSTs to {baseUrl}/chat/completions with the messages + a tools array', async () => {
    stubFetch(() => textResponse('hi'));
    await new OpenAiCompatibleLlmProvider(KEYED).chat({ messages: MESSAGES, tools: TOOLS });

    expect(captured?.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(captured?.body.model).toBe('gpt-4o');
    const msgs = captured?.body.messages as Array<{ role: string; content: string }>;
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toEqual({ role: 'system', content: 'You are a car-data assistant.' });
    const tools = captured?.body.tools as Array<{ type: string; function: { name: string } }>;
    expect(tools).toHaveLength(1);
    expect(tools[0].type).toBe('function');
    expect(tools[0].function.name).toBe('getExpenseSummary');
  });

  test('sends a Bearer Authorization header when a key is present', async () => {
    stubFetch(() => textResponse('hi'));
    await new OpenAiCompatibleLlmProvider(KEYED).chat({ messages: MESSAGES, tools: [] });
    expect(captured?.headers.Authorization).toBe('Bearer sk-assistant-key');
  });

  test('OMITS the Authorization header for a keyless self-hosted (Ollama) provider', async () => {
    stubFetch(() => textResponse('hi'));
    await new OpenAiCompatibleLlmProvider(KEYLESS).chat({ messages: MESSAGES, tools: [] });
    expect(captured?.headers.Authorization).toBeUndefined();
    expect(captured?.url).toBe('http://localhost:11434/v1/chat/completions');
  });

  test('a tool RESULT message carries its tool name + call id in the wire shape', async () => {
    stubFetch(() => textResponse('done'));
    const withTool: ChatMessage[] = [
      ...MESSAGES,
      {
        role: 'tool',
        content: '{"totalAmount":5000}',
        toolName: 'getExpenseSummary',
        toolCallId: 'call_1',
      },
    ];
    await new OpenAiCompatibleLlmProvider(KEYED).chat({ messages: withTool, tools: TOOLS });
    const msgs = captured?.body.messages as Record<string, unknown>[];
    const toolMsg = msgs[msgs.length - 1];
    expect(toolMsg.role).toBe('tool');
    expect(toolMsg.name).toBe('getExpenseSummary');
    expect(toolMsg.tool_call_id).toBe('call_1');
  });
});

describe('OpenAiCompatibleLlmProvider.chat — response normalization (dumb transport)', () => {
  test('a content response normalizes to ChatResult.text', async () => {
    stubFetch(() => textResponse('You spent $50 on fuel.'));
    const result = await new OpenAiCompatibleLlmProvider(KEYED).chat({
      messages: MESSAGES,
      tools: TOOLS,
    });
    expect(result.text).toBe('You spent $50 on fuel.');
    expect(result.toolCalls).toBeUndefined();
  });

  test('a tool_calls response normalizes to ChatResult.toolCalls (name + RAW args)', async () => {
    stubFetch(() => toolCallResponse('getExpenseSummary', '{"range":"ytd"}'));
    const result = await new OpenAiCompatibleLlmProvider(KEYED).chat({
      messages: MESSAGES,
      tools: TOOLS,
    });
    expect(result.text).toBeUndefined();
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls?.[0]).toEqual({
      id: 'call_1',
      name: 'getExpenseSummary',
      argumentsJson: '{"range":"ytd"}',
    });
  });

  test('a missing/non-string content with no tool calls returns { text: "" } (no throw)', async () => {
    stubFetch(() => textResponse(null));
    const result = await new OpenAiCompatibleLlmProvider(KEYED).chat({
      messages: MESSAGES,
      tools: TOOLS,
    });
    expect(result.text).toBe('');
  });
});

describe('OpenAiCompatibleLlmProvider.chat — failure honesty (anti-fail-open)', () => {
  test('a non-2xx response THROWS (the route maps it to 502, never a fake answer)', async () => {
    stubFetch(() => new Response('rate limited', { status: 429 }));
    await expect(
      new OpenAiCompatibleLlmProvider(KEYED).chat({ messages: MESSAGES, tools: TOOLS })
    ).rejects.toThrow(/HTTP 429/);
  });

  test('a network failure THROWS', async () => {
    globalThis.fetch = (async () => {
      throw new Error('ECONNREFUSED');
      // biome-ignore lint/suspicious/noExplicitAny: test fetch stub.
    }) as any;
    await expect(
      new OpenAiCompatibleLlmProvider(KEYED).chat({ messages: MESSAGES, tools: TOOLS })
    ).rejects.toThrow(/LLM request failed/);
  });

  test('the constructor requires a base URL', () => {
    expect(() => new OpenAiCompatibleLlmProvider({ model: 'gpt-4o' })).toThrow(/base URL/);
  });
});

describe('getLlmProvider / resolveLlmSettings — registry dispatch (T3a)', () => {
  function llmRow(
    over: Partial<{ providerType: string; config: unknown; credentials: unknown }> = {}
  ): UserProvider {
    return {
      providerType: over.providerType ?? 'openai-compatible',
      domain: 'llm',
      config: over.config ?? { model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1' },
      credentials: encrypt(JSON.stringify(over.credentials ?? { apiKey: 'sk-x' })),
      // biome-ignore lint/suspicious/noExplicitAny: a minimal row — the registry only reads these fields.
    } as any;
  }

  test('resolveLlmSettings decrypts the api key + reads model/baseUrl', () => {
    const s = resolveLlmSettings(llmRow());
    expect(s.apiKey).toBe('sk-x');
    expect(s.model).toBe('gpt-4o');
    expect(s.baseUrl).toBe('https://api.openai.com/v1');
  });

  test('resolveLlmSettings throws when the model is missing (defense-in-depth vs a restored bad row)', () => {
    expect(() => resolveLlmSettings(llmRow({ config: { baseUrl: 'https://x' } }))).toThrow();
  });

  test('getLlmProvider returns a live adapter for openai-compatible + ollama (T3a)', () => {
    expect(getLlmProvider(llmRow({ providerType: 'openai-compatible' }))).toBeInstanceOf(
      OpenAiCompatibleLlmProvider
    );
    expect(
      getLlmProvider(
        llmRow({
          providerType: 'ollama',
          credentials: {},
          config: { model: 'llama3.1', baseUrl: 'http://localhost:11434/v1' },
        })
      )
    ).toBeInstanceOf(OpenAiCompatibleLlmProvider);
  });

  test('getLlmProvider throws a clear T3b-not-yet placeholder for anthropic + gemini', () => {
    expect(() =>
      getLlmProvider(llmRow({ providerType: 'anthropic', config: { model: 'claude-3-5-sonnet' } }))
    ).toThrow(/not yet available/);
    expect(() =>
      getLlmProvider(llmRow({ providerType: 'gemini', config: { model: 'gemini-1.5-pro' } }))
    ).toThrow(/not yet available/);
  });

  test('getLlmProvider throws on an unknown/non-LLM provider type', () => {
    expect(() => getLlmProvider(llmRow({ providerType: 's3' }))).toThrow(/Unsupported LLM/);
  });
});
