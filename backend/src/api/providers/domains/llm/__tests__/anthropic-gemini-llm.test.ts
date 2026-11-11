import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ModelProviderSettings } from '../../model/model-registry';
import { AnthropicLlmProvider } from '../anthropic';
import { GeminiLlmProvider } from '../gemini';
import type { ChatMessage, ToolDefinition } from '../llm-provider';

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

const SETTINGS: ModelProviderSettings = { apiKey: 'sk-assistant-key', model: 'claude-3-5-sonnet' };
const GEMINI_SETTINGS: ModelProviderSettings = { apiKey: 'gm-key-123', model: 'gemini-1.5-pro' };

const MESSAGES: ChatMessage[] = [
  { role: 'system', content: 'You are a car-data assistant.' },
  { role: 'user', content: 'How much did I spend on fuel?' },
];
/** A full tool round-trip: two parallel calls, then both results. */
const TOOL_TRANSCRIPT: ChatMessage[] = [
  ...MESSAGES,
  {
    role: 'assistant',
    content: '',
    toolCalls: [
      { id: 'tu_a', name: 'getExpenseSummary', argumentsJson: '{"range":"ytd"}' },
      { id: 'tu_b', name: 'listVehicles', argumentsJson: 'not json' },
    ],
  },
  {
    role: 'tool',
    content: '{"totalAmount":50}',
    toolName: 'getExpenseSummary',
    toolCallId: 'tu_a',
  },
  { role: 'tool', content: '[]', toolName: 'listVehicles', toolCallId: 'tu_b' },
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

describe('AnthropicLlmProvider.chat', () => {
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
    expect(captured?.body.system).toBe('You are a car-data assistant.');
    const msgs = captured?.body.messages as Array<{ role: string }>;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('user');
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

  test('tool results go in ONE user turn right after an assistant turn holding the matching tool_use blocks', async () => {
    stubFetch(() => anthropicText('done'));
    await new AnthropicLlmProvider(SETTINGS).chat({ messages: TOOL_TRANSCRIPT, tools: TOOLS });

    expect(captured?.body).toEqual({
      model: 'claude-3-5-sonnet',
      max_tokens: 1024,
      temperature: 0,
      system: 'You are a car-data assistant.',
      messages: [
        { role: 'user', content: 'How much did I spend on fuel?' },
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tu_a', name: 'getExpenseSummary', input: { range: 'ytd' } },
            { type: 'tool_use', id: 'tu_b', name: 'listVehicles', input: {} },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tu_a', content: '{"totalAmount":50}' },
            { type: 'tool_result', tool_use_id: 'tu_b', content: '[]' },
          ],
        },
      ],
      tools: [
        {
          name: 'getExpenseSummary',
          description: 'Total spend over a range.',
          input_schema: TOOLS[0].parameters,
        },
      ],
    });
  });

  test('assistant text alongside tool calls becomes a text block before the tool_use blocks', async () => {
    stubFetch(() => anthropicText('done'));
    await new AnthropicLlmProvider(SETTINGS).chat({
      messages: [
        ...MESSAGES,
        {
          role: 'assistant',
          content: 'Checking.',
          toolCalls: [{ id: 'tu_1', name: 'listVehicles', argumentsJson: '{}' }],
        },
        { role: 'tool', content: '[]', toolName: 'listVehicles', toolCallId: 'tu_1' },
      ],
      tools: TOOLS,
    });
    const msgs = captured?.body.messages as Array<{ role: string; content: unknown }>;
    expect(msgs[1]?.content).toEqual([
      { type: 'text', text: 'Checking.' },
      { type: 'tool_use', id: 'tu_1', name: 'listVehicles', input: {} },
    ]);
  });

  test('a non-2xx response throws', async () => {
    stubFetch(() => new Response('overloaded', { status: 529 }));
    await expect(
      new AnthropicLlmProvider(SETTINGS).chat({ messages: MESSAGES, tools: TOOLS })
    ).rejects.toThrow(/HTTP 529/);
  });

  test('the constructor requires an API key', () => {
    expect(() => new AnthropicLlmProvider({ model: 'claude-3-5-sonnet' })).toThrow(/API key/);
  });
});

describe('GeminiLlmProvider.chat', () => {
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
    expect(JSON.stringify(captured?.headers)).not.toContain('gm-key-123');
    const sys = captured?.body.systemInstruction as { parts: Array<{ text: string }> };
    expect(sys.parts[0].text).toBe('You are a car-data assistant.');
    const tools = captured?.body.tools as Array<{ functionDeclarations: Array<{ name: string }> }>;
    expect(tools[0].functionDeclarations[0].name).toBe('getExpenseSummary');
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

  test('function responses go in ONE function turn right after a model turn holding the matching functionCall parts', async () => {
    stubFetch(() => geminiText('done'));
    await new GeminiLlmProvider(GEMINI_SETTINGS).chat({ messages: TOOL_TRANSCRIPT, tools: TOOLS });

    expect(captured?.body).toEqual({
      contents: [
        { role: 'user', parts: [{ text: 'How much did I spend on fuel?' }] },
        {
          role: 'model',
          parts: [
            { functionCall: { name: 'getExpenseSummary', args: { range: 'ytd' } } },
            { functionCall: { name: 'listVehicles', args: {} } },
          ],
        },
        {
          role: 'function',
          parts: [
            {
              functionResponse: {
                name: 'getExpenseSummary',
                response: { content: '{"totalAmount":50}' },
              },
            },
            { functionResponse: { name: 'listVehicles', response: { content: '[]' } } },
          ],
        },
      ],
      systemInstruction: { parts: [{ text: 'You are a car-data assistant.' }] },
      tools: [
        {
          functionDeclarations: [
            {
              name: 'getExpenseSummary',
              description: 'Total spend over a range.',
              parameters: TOOLS[0].parameters,
            },
          ],
        },
      ],
      generationConfig: { temperature: 0, maxOutputTokens: 1024 },
    });
  });

  test('a non-2xx response throws', async () => {
    stubFetch(() => new Response('quota', { status: 429 }));
    await expect(
      new GeminiLlmProvider(GEMINI_SETTINGS).chat({ messages: MESSAGES, tools: TOOLS })
    ).rejects.toThrow(/HTTP 429/);
  });

  test('the constructor requires an API key', () => {
    expect(() => new GeminiLlmProvider({ model: 'gemini-1.5-pro' })).toThrow(/API key/);
  });
});
