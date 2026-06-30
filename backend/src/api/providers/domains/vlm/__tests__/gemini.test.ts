/**
 * GeminiVlmProvider adapter (vlm-receipt-parsing T3b). Drives the REAL adapter against a stubbed global
 * fetch (no live key/endpoint) and pins the request SHAPE + failure-honesty rules:
 *  - POSTs to {baseUrl}/v1beta/models/{model}:generateContent?key=... with the FIXED prompt + an
 *    inline_data base64 image part;
 *  - the api key rides the ?key= QUERY param (not a header);
 *  - the model's first text part is returned verbatim (parseExtraction validates it);
 *  - a non-2xx / network failure THROWS (route → 502, never a faked success);
 *  - missing/non-string content → '' (empty draft downstream, no throw).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { GeminiVlmProvider } from '../gemini';
import { RECEIPT_EXTRACTION_PROMPT } from '../prompt';
import type { ReceiptImage } from '../vlm-provider';

const realFetch = globalThis.fetch;

interface CapturedRequest {
  url: string;
  body: Record<string, unknown>;
}

let captured: CapturedRequest | null;

function stubFetch(responder: () => Response | Promise<Response>): void {
  captured = null;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    captured = {
      url: String(input),
      body: init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {},
    };
    return responder();
    // biome-ignore lint/suspicious/noExplicitAny: test fetch stub.
  }) as any;
}

/** A Gemini generateContent success body: candidates[].content.parts[].text. */
function okResponse(text: unknown): Response {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
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

describe('GeminiVlmProvider — request shaping', () => {
  test('POSTs to generateContent with the fixed prompt + an inline_data image part', async () => {
    stubFetch(() => okResponse('{"amount": 12.5}'));
    const provider = new GeminiVlmProvider({ apiKey: 'g-key', model: 'gemini-1.5-flash' });

    const raw = await provider.extractReceipt(IMAGE);
    expect(raw).toBe('{"amount": 12.5}');

    // URL targets the model's generateContent method and carries the key as a query param.
    expect(captured?.url).toContain(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent'
    );
    expect(captured?.url).toContain('key=g-key');

    const contents = captured?.body.contents as { parts: Record<string, unknown>[] }[];
    const parts = contents[0].parts;
    const textPart = parts.find((p) => typeof p.text === 'string');
    const imagePart = parts.find((p) => p.inline_data) as
      | { inline_data: { mime_type: string; data: string } }
      | undefined;
    expect(textPart?.text).toBe(RECEIPT_EXTRACTION_PROMPT);
    expect(imagePart?.inline_data.mime_type).toBe('image/jpeg');
    expect(imagePart?.inline_data.data).toBe(Buffer.from('fake-jpeg-bytes').toString('base64'));

    const genConfig = captured?.body.generationConfig as Record<string, unknown>;
    expect(genConfig.temperature).toBe(0);
    expect(genConfig.maxOutputTokens).toBeGreaterThan(0);
  });

  test('url-encodes the api key in the query param', async () => {
    stubFetch(() => okResponse('{}'));
    const provider = new GeminiVlmProvider({ apiKey: 'a/b+c', model: 'gemini-1.5-flash' });
    await provider.extractReceipt(IMAGE);
    expect(captured?.url).toContain('key=a%2Fb%2Bc');
  });

  test('a custom baseUrl overrides the default endpoint (trailing slash stripped)', async () => {
    stubFetch(() => okResponse('{}'));
    const provider = new GeminiVlmProvider({
      apiKey: 'k',
      model: 'gemini-1.5-flash',
      baseUrl: 'https://proxy.example.com/',
    });
    await provider.extractReceipt(IMAGE);
    expect(captured?.url).toContain('https://proxy.example.com/v1beta/models/');
  });
});

describe('GeminiVlmProvider — failure honesty (anti-fail-open)', () => {
  test('THROWS on a non-2xx response', async () => {
    stubFetch(() => new Response('quota', { status: 429 }));
    const provider = new GeminiVlmProvider({ apiKey: 'k', model: 'm' });
    await expect(provider.extractReceipt(IMAGE)).rejects.toThrow(/HTTP 429/);
  });

  test('THROWS on a network/transport failure', async () => {
    stubFetch(() => {
      throw new Error('ECONNREFUSED');
    });
    const provider = new GeminiVlmProvider({ apiKey: 'k', model: 'm' });
    await expect(provider.extractReceipt(IMAGE)).rejects.toThrow(/VLM request failed/);
  });

  test('returns an empty string when there is no candidate text (→ empty draft, no throw)', async () => {
    stubFetch(() => new Response(JSON.stringify({ candidates: [] }), { status: 200 }));
    const provider = new GeminiVlmProvider({ apiKey: 'k', model: 'm' });
    expect(await provider.extractReceipt(IMAGE)).toBe('');
  });

  test('returns an empty string when the JSON body is malformed (no throw)', async () => {
    stubFetch(() => new Response('not json', { status: 200 }));
    const provider = new GeminiVlmProvider({ apiKey: 'k', model: 'm' });
    expect(await provider.extractReceipt(IMAGE)).toBe('');
  });
});

describe('GeminiVlmProvider — construction', () => {
  test('throws without an api key (defense-in-depth)', () => {
    expect(() => new GeminiVlmProvider({ model: 'm' })).toThrow(/API key/);
  });
});
