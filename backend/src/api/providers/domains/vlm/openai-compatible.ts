/**
 * OpenAI-compatible VLM adapter (vlm-receipt-parsing T3a). Implements `VlmProvider.extractReceipt`
 * against the OpenAI Chat Completions vision API (`POST {baseUrl}/chat/completions` with an
 * `image_url` data-URL part). This ONE adapter covers OpenAI itself, the many OpenAI-API-compatible
 * gateways, AND self-hosted Ollama (which exposes the same `/v1/chat/completions` shape) — so it is
 * the common denominator of every D1 option and the D2 self-hosted path (design §3). The
 * fork-variable first-party adapters (Anthropic, Gemini) land in T3b once D1 is ruled.
 *
 * The adapter is DUMB TRANSPORT: it sends the FIXED prompt + the image and returns the model's RAW
 * text. The shared `parseExtraction` (prompt.ts) is the SOLE validator — this file never trusts or
 * bounds the content. A non-2xx / network / timeout failure THROWS (the parse route maps it to a 502;
 * never a faked success — the #43/#44/#144 anti-fail-open lesson). The api key (when present) goes in
 * the Authorization header; a keyless config (self-hosted Ollama) omits it.
 */

import { logger } from '../../../../utils/logger';
import { RECEIPT_EXTRACTION_PROMPT } from './prompt';
import type { VlmProviderSettings } from './registry';
import type { RawExtraction, ReceiptImage, VlmProvider } from './vlm-provider';

/** Hard ceiling on a single parse call (cost + a hung-endpoint guard). */
const REQUEST_TIMEOUT_MS = 30_000;
/** Cap the completion size — a receipt extraction is a small JSON object. */
const MAX_TOKENS = 1024;

export class OpenAiCompatibleVlmProvider implements VlmProvider {
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(settings: VlmProviderSettings) {
    if (!settings.baseUrl) {
      // Defense-in-depth: the create/PUT gate + resolveVlmSettings already require this.
      throw new Error('OpenAI-compatible VLM requires a base URL');
    }
    this.apiKey = settings.apiKey;
    this.model = settings.model;
    // Normalize: callers give e.g. https://api.openai.com/v1 (or an Ollama http://host:11434/v1).
    this.baseUrl = settings.baseUrl.replace(/\/+$/, '');
  }

  async extractReceipt(image: ReceiptImage): Promise<RawExtraction> {
    const dataUrl = `data:${image.mimeType};base64,${image.data.toString('base64')}`;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    // Keyless self-hosted (Ollama) sends no Authorization header; everything else uses Bearer.
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const body = {
      model: this.model,
      max_tokens: MAX_TOKENS,
      // Deterministic extraction — no creativity wanted.
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: RECEIPT_EXTRACTION_PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    };

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // Network failure / timeout — surface honestly (route → 502). Do NOT log the api key.
      const message = err instanceof Error ? err.message : 'network error';
      logger.warn('VLM openai-compatible request failed', { model: this.model, error: message });
      throw new Error(`VLM request failed: ${message}`);
    }

    if (!res.ok) {
      // Read a short error body for the log, but never echo it to the client verbatim.
      const detail = await res.text().catch(() => '');
      logger.warn('VLM openai-compatible non-2xx', {
        model: this.model,
        status: res.status,
        detail: detail.slice(0, 200),
      });
      throw new Error(`VLM provider returned HTTP ${res.status}`);
    }

    const json = (await res.json().catch(() => null)) as {
      choices?: { message?: { content?: unknown } }[];
    } | null;

    const content = json?.choices?.[0]?.message?.content;
    // The content is the RAW model output — parseExtraction (the caller) validates it. A missing/non-
    // string content returns '' → an empty draft (the user fills the form by hand), never a throw.
    return typeof content === 'string' ? content : '';
  }
}
