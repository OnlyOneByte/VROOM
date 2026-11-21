import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { UserProvider } from '../../../../../db/schema';
import { encrypt } from '../../../../../utils/encryption';
import { type ModelProviderSettings, resolveModelSettings } from '../../model/model-registry';
import type { ChatMessage, ToolDefinition } from '../llm-provider';
import { OpenAiCompatibleLlmProvider } from '../openai-compatible';
import { getLlmProvider } from '../registry';

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

const KEYED: ModelProviderSettings = {
  apiKey: 'sk-assistant-key',
  model: 'gpt-4o',
  baseUrl: 'https://api.openai.com/v1',
};
const KEYLESS: ModelProviderSettings = { model: 'llama3.1', baseUrl: 'http://localhost:11434/v1' };

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

describe('OpenAiCompatibleLlmProvider.chat — tool round-trip wire protocol', () => {
  test('tool results follow an assistant turn whose tool_calls carry the matching ids', async () => {
    stubFetch(() => textResponse('done'));
    const transcript: ChatMessage[] = [
      ...MESSAGES,
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'call_a', name: 'getExpenseSummary', argumentsJson: '{"range":"ytd"}' },
          { id: 'call_b', name: 'listVehicles', argumentsJson: '{}' },
        ],
      },
      {
        role: 'tool',
        content: '{"totalAmount":50}',
        toolName: 'getExpenseSummary',
        toolCallId: 'call_a',
      },
      { role: 'tool', content: '[]', toolName: 'listVehicles', toolCallId: 'call_b' },
    ];
    await new OpenAiCompatibleLlmProvider(KEYED).chat({ messages: transcript, tools: TOOLS });

    expect(captured?.body).toEqual({
      model: 'gpt-4o',
      max_tokens: 1024,
      temperature: 0,
      messages: [
        { role: 'system', content: 'You are a car-data assistant.' },
        { role: 'user', content: 'How much did I spend on fuel?' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_a',
              type: 'function',
              function: { name: 'getExpenseSummary', arguments: '{"range":"ytd"}' },
            },
            { id: 'call_b', type: 'function', function: { name: 'listVehicles', arguments: '{}' } },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'call_a',
          name: 'getExpenseSummary',
          content: '{"totalAmount":50}',
        },
        { role: 'tool', tool_call_id: 'call_b', name: 'listVehicles', content: '[]' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'getExpenseSummary',
            description: 'Total spend over a range.',
            parameters: TOOLS[0].parameters,
          },
        },
      ],
    });
  });

  test('assistant text that accompanies tool calls is kept on the assistant turn', async () => {
    stubFetch(() => textResponse('done'));
    await new OpenAiCompatibleLlmProvider(KEYED).chat({
      messages: [
        ...MESSAGES,
        {
          role: 'assistant',
          content: 'Let me check.',
          toolCalls: [{ id: 'c1', name: 'listVehicles', argumentsJson: '{}' }],
        },
        { role: 'tool', content: '[]', toolName: 'listVehicles', toolCallId: 'c1' },
      ],
      tools: [],
    });
    const msgs = captured?.body.messages as Record<string, unknown>[];
    expect(msgs[2]?.content).toBe('Let me check.');
    expect(captured?.body.tools).toBeUndefined();
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

describe('OpenAiCompatibleLlmProvider.chat failures', () => {
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

describe('getLlmProvider / resolveModelSettings dispatch by provider type', () => {
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

  test('resolveModelSettings decrypts the api key + reads model/baseUrl', () => {
    const s = resolveModelSettings(llmRow(), 'LLM');
    expect(s.apiKey).toBe('sk-x');
    expect(s.model).toBe('gpt-4o');
    expect(s.baseUrl).toBe('https://api.openai.com/v1');
  });

  test('resolveModelSettings throws when the model is missing (defense-in-depth vs a restored bad row)', () => {
    expect(() => resolveModelSettings(llmRow({ config: { baseUrl: 'https://x' } }), 'LLM')).toThrow(
      /LLM provider config is missing a model name/
    );
  });

  test('getLlmProvider returns a live adapter for openai-compatible and ollama', () => {
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

  test('getLlmProvider returns a live adapter for anthropic and gemini', () => {
    expect(
      getLlmProvider(llmRow({ providerType: 'anthropic', config: { model: 'claude-3-5-sonnet' } }))
    ).toBeDefined();
    expect(
      getLlmProvider(llmRow({ providerType: 'gemini', config: { model: 'gemini-1.5-pro' } }))
    ).toBeDefined();
  });

  test('getLlmProvider names the LLM domain when a required field is missing', () => {
    expect(() =>
      getLlmProvider(llmRow({ providerType: 'ollama', config: { model: 'llama3.1' } }))
    ).toThrow(/Ollama LLM requires a base URL/);
    expect(() =>
      getLlmProvider(
        llmRow({ providerType: 'anthropic', credentials: {}, config: { model: 'claude' } })
      )
    ).toThrow(/Anthropic LLM requires an API key/);
  });

  test('getLlmProvider throws on an unknown/non-LLM provider type', () => {
    expect(() => getLlmProvider(llmRow({ providerType: 's3' }))).toThrow(/Unsupported LLM/);
  });
});
