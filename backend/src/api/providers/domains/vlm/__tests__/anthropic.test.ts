/**
 * AnthropicVlmProvider adapter (vlm-receipt-parsing T3b). Drives the REAL adapter against a stubbed
 * global fetch (no live key/endpoint) and pins the request SHAPE + failure-honesty rules:
 *  - POSTs to {baseUrl}/v1/messages with the FIXED prompt + a base64 `image` source block;
 *  - auth via the `x-api-key` header (NOT Bearer) + the required `anthropic-version` header;
 *  - the model's first text-block content is returned verbatim (parseExtraction validates it);
 *  - a non-2xx / network failure THROWS (route → 502, never a faked success);
 *  - missing/non-string content → '' (empty draft downstream, no throw).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AnthropicVlmProvider } from '../anthropic';
import { RECEIPT_EXTRACTION_PROMPT } from '../prompt';
import type { ReceiptImage } from '../vlm-provider';

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

/** An Anthropic Messages API success body: content[] with a text block. */
function okResponse(text: unknown): Response {
  return new Response(JSON.stringify({ content: [{ type: 'text', text }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const IMAGE: ReceiptImage = { data: Buffer.from('fake-jpeg-bytes'), mimeType: 'image/jpeg' };

beforeEach(() => {
  captured = null;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('AnthropicVlmProvider — request shaping', () => {
  test('POSTs to the messages endpoint with the fixed prompt + a base64 image source block', async () => {
    stubFetch(() => okResponse('{"amount": 12.5}'));
    const provider = new AnthropicVlmProvider({ apiKey: 'sk-ant', model: 'claude-3-5-sonnet' });

    const raw = await provider.extractReceipt(IMAGE);
    expect(raw).toBe('{"amount": 12.5}');

    expect(captured?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(captured?.body.model).toBe('claude-3-5-sonnet');
    expect(captured?.body.temperature).toBe(0);
    expect(captured?.body.max_tokens).toBeGreaterThan(0);

    const messages = captured?.body.messages as { content: Record<string, unknown>[] }[];
    const parts = messages[0].content;
    const textPart = parts.find((p) => p.type === 'text');
    const imagePart = parts.find((p) => p.type === 'image') as
      | { source: { type: string; media_type: string; data: string } }
      | undefined;
    expect(textPart?.text).toBe(RECEIPT_EXTRACTION_PROMPT);
    expect(imagePart?.source.type).toBe('base64');
    expect(imagePart?.source.media_type).toBe('image/jpeg');
    expect(imagePart?.source.data).toBe(Buffer.from('fake-jpeg-bytes').toString('base64'));
  });

  test('authenticates via x-api-key + anthropic-version headers (NOT Bearer)', async () => {
    stubFetch(() => okResponse('{}'));
    const provider = new AnthropicVlmProvider({ apiKey: 'sk-secret', model: 'claude-3-5-sonnet' });
    await provider.extractReceipt(IMAGE);
    expect(captured?.headers['x-api-key']).toBe('sk-secret');
    expect(captured?.headers['anthropic-version']).toBeTruthy();
    expect(captured?.headers.Authorization).toBeUndefined();
  });

  test('a custom baseUrl overrides the default endpoint (trailing slash stripped)', async () => {
    stubFetch(() => okResponse('{}'));
    const provider = new AnthropicVlmProvider({
      apiKey: 'k',
      model: 'm',
      baseUrl: 'https://proxy.example.com/',
    });
    await provider.extractReceipt(IMAGE);
    expect(captured?.url).toBe('https://proxy.example.com/v1/messages');
  });
});

describe('AnthropicVlmProvider — failure honesty (anti-fail-open)', () => {
  test('THROWS on a non-2xx response', async () => {
    stubFetch(() => new Response('overloaded', { status: 529 }));
    const provider = new AnthropicVlmProvider({ apiKey: 'k', model: 'm' });
    await expect(provider.extractReceipt(IMAGE)).rejects.toThrow(/HTTP 529/);
  });

  test('THROWS on a network/transport failure', async () => {
    stubFetch(() => {
      throw new Error('ECONNREFUSED');
    });
    const provider = new AnthropicVlmProvider({ apiKey: 'k', model: 'm' });
    await expect(provider.extractReceipt(IMAGE)).rejects.toThrow(/VLM request failed/);
  });

  test('returns an empty string when there is no text block (→ empty draft, no throw)', async () => {
    stubFetch(
      () => new Response(JSON.stringify({ content: [{ type: 'tool_use' }] }), { status: 200 })
    );
    const provider = new AnthropicVlmProvider({ apiKey: 'k', model: 'm' });
    expect(await provider.extractReceipt(IMAGE)).toBe('');
  });

  test('returns an empty string when the JSON body is malformed (no throw)', async () => {
    stubFetch(() => new Response('not json', { status: 200 }));
    const provider = new AnthropicVlmProvider({ apiKey: 'k', model: 'm' });
    expect(await provider.extractReceipt(IMAGE)).toBe('');
  });
});

describe('AnthropicVlmProvider — construction', () => {
  test('throws without an api key (defense-in-depth)', () => {
    expect(() => new AnthropicVlmProvider({ model: 'm' })).toThrow(/API key/);
  });
});
