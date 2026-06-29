/**
 * OpenAiCompatibleVlmProvider adapter (vlm-receipt-parsing T3a, C511). Drives the REAL adapter against
 * a stubbed global fetch (no live key/endpoint) and pins the request SHAPE + the failure-honesty rules:
 *  - the request POSTs to {baseUrl}/chat/completions with the FIXED prompt + an image_url data-URL part;
 *  - a Bearer Authorization header is present with a key, ABSENT for keyless self-hosted (Ollama);
 *  - the model's raw content string is returned verbatim (the caller's parseExtraction validates it);
 *  - a non-2xx / network failure THROWS (the parse route maps it to 502 — never a faked success);
 *  - a missing/non-string content returns '' (→ an empty draft downstream, no throw).
 *
 * Adapter = dumb transport: it does NOT validate/bound the content (that is prompt.ts), so these tests
 * assert transport + headers + error-honesty, not extraction semantics (those are the T2 schema tests).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { OpenAiCompatibleVlmProvider } from '../openai-compatible';
import { RECEIPT_EXTRACTION_PROMPT } from '../prompt';
import type { ReceiptImage } from '../vlm-provider';

const realFetch = globalThis.fetch;

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

let captured: CapturedRequest | null;

/** Install a fetch stub that records the request and returns `responder()`. */
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

function okResponse(content: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
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

describe('OpenAiCompatibleVlmProvider — request shaping', () => {
  test('POSTs to {baseUrl}/chat/completions with the fixed prompt + an image data-URL part', async () => {
    stubFetch(() => okResponse('{"amount": 12.5}'));
    const provider = new OpenAiCompatibleVlmProvider({
      apiKey: 'sk-key',
      model: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
    });

    const raw = await provider.extractReceipt(IMAGE);
    expect(raw).toBe('{"amount": 12.5}');

    expect(captured?.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(captured?.body.model).toBe('gpt-4o-mini');
    // temperature 0 (deterministic) + a token cap.
    expect(captured?.body.temperature).toBe(0);
    expect(captured?.body.max_tokens).toBeGreaterThan(0);

    const messages = captured?.body.messages as { content: Record<string, unknown>[] }[];
    const parts = messages[0].content;
    const textPart = parts.find((p) => p.type === 'text');
    const imagePart = parts.find((p) => p.type === 'image_url') as
      | { image_url: { url: string } }
      | undefined;
    expect(textPart?.text).toBe(RECEIPT_EXTRACTION_PROMPT);
    expect(imagePart?.image_url.url).toBe(
      `data:image/jpeg;base64,${Buffer.from('fake-jpeg-bytes').toString('base64')}`
    );
  });

  test('sends a Bearer Authorization header when an api key is set', async () => {
    stubFetch(() => okResponse('{}'));
    const provider = new OpenAiCompatibleVlmProvider({
      apiKey: 'sk-secret',
      model: 'gpt-4o',
      baseUrl: 'https://api.openai.com/v1',
    });
    await provider.extractReceipt(IMAGE);
    expect(captured?.headers.Authorization).toBe('Bearer sk-secret');
  });

  test('OMITS the Authorization header for keyless self-hosted (Ollama)', async () => {
    stubFetch(() => okResponse('{}'));
    const provider = new OpenAiCompatibleVlmProvider({
      model: 'llava',
      baseUrl: 'http://localhost:11434/v1',
    });
    await provider.extractReceipt(IMAGE);
    expect(captured?.headers.Authorization).toBeUndefined();
    expect(captured?.url).toBe('http://localhost:11434/v1/chat/completions');
  });

  test('strips a trailing slash from the base URL', async () => {
    stubFetch(() => okResponse('{}'));
    const provider = new OpenAiCompatibleVlmProvider({
      apiKey: 'k',
      model: 'm',
      baseUrl: 'https://gateway.example.com/v1/',
    });
    await provider.extractReceipt(IMAGE);
    expect(captured?.url).toBe('https://gateway.example.com/v1/chat/completions');
  });
});

describe('OpenAiCompatibleVlmProvider — failure honesty (anti-fail-open)', () => {
  test('THROWS on a non-2xx response (route maps to 502, never a faked success)', async () => {
    stubFetch(() => new Response('rate limited', { status: 429 }));
    const provider = new OpenAiCompatibleVlmProvider({
      apiKey: 'k',
      model: 'm',
      baseUrl: 'https://api.openai.com/v1',
    });
    await expect(provider.extractReceipt(IMAGE)).rejects.toThrow(/HTTP 429/);
  });

  test('THROWS on a network/transport failure', async () => {
    stubFetch(() => {
      throw new Error('ECONNREFUSED');
    });
    const provider = new OpenAiCompatibleVlmProvider({
      apiKey: 'k',
      model: 'm',
      baseUrl: 'https://api.openai.com/v1',
    });
    await expect(provider.extractReceipt(IMAGE)).rejects.toThrow(/VLM request failed/);
  });

  test('returns an empty string when the response has no usable content (→ empty draft, no throw)', async () => {
    stubFetch(() => okResponse(null));
    const provider = new OpenAiCompatibleVlmProvider({
      apiKey: 'k',
      model: 'm',
      baseUrl: 'https://api.openai.com/v1',
    });
    expect(await provider.extractReceipt(IMAGE)).toBe('');
  });

  test('returns an empty string when the JSON body is malformed (no throw)', async () => {
    stubFetch(() => new Response('not json', { status: 200 }));
    const provider = new OpenAiCompatibleVlmProvider({
      apiKey: 'k',
      model: 'm',
      baseUrl: 'https://api.openai.com/v1',
    });
    expect(await provider.extractReceipt(IMAGE)).toBe('');
  });
});

describe('OpenAiCompatibleVlmProvider — construction', () => {
  test('throws without a base URL (defense-in-depth)', () => {
    expect(() => new OpenAiCompatibleVlmProvider({ apiKey: 'k', model: 'm' })).toThrow(/base URL/);
  });
});
