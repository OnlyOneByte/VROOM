/**
 * Google Gemini VLM adapter (vlm-receipt-parsing T3b). Implements `VlmProvider.extractReceipt` against
 * the Gemini generateContent API (`POST {baseUrl}/v1beta/models/{model}:generateContent?key=...` with
 * an `inline_data` base64 image part + a `text` part carrying the FIXED prompt).
 *
 * Same DUMB-TRANSPORT contract as the other adapters: send the fixed prompt + image, return the model's
 * RAW text; the shared `parseExtraction` (prompt.ts) is the SOLE validator. A non-2xx / network /
 * timeout failure THROWS (the parse route maps it to 502; never a faked success — the #43/#44/#144
 * anti-fail-open lesson). Gemini authenticates with the api key as a `?key=` QUERY param (not a header),
 * so the key is kept OUT of logs (only the model + status are logged, never the URL).
 */

import { logger } from '../../../../utils/logger';
import { RECEIPT_EXTRACTION_PROMPT } from './prompt';
import type { VlmProviderSettings } from './registry';
import type { RawExtraction, ReceiptImage, VlmProvider } from './vlm-provider';

/** Hard ceiling on a single parse call (cost + a hung-endpoint guard). */
const REQUEST_TIMEOUT_MS = 30_000;
/** Cap the completion size — a receipt extraction is a small JSON object. */
const MAX_OUTPUT_TOKENS = 1024;
/** Default endpoint; `baseUrl` can override for a compatible proxy. */
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';

export class GeminiVlmProvider implements VlmProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(settings: VlmProviderSettings) {
    if (!settings.apiKey) {
      // Defense-in-depth: the create/PUT gate already requires a key for non-ollama types.
      throw new Error('Gemini VLM requires an API key');
    }
    this.apiKey = settings.apiKey;
    this.model = settings.model;
    this.baseUrl = (settings.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  async extractReceipt(image: ReceiptImage): Promise<RawExtraction> {
    const body = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: RECEIPT_EXTRACTION_PROMPT },
            { inline_data: { mime_type: image.mimeType, data: image.data.toString('base64') } },
          ],
        },
      ],
      // Deterministic extraction — no creativity wanted.
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
      logger.warn('VLM gemini request failed', { model: this.model, error: message });
      throw new Error(`VLM request failed: ${message}`);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      logger.warn('VLM gemini non-2xx', {
        model: this.model,
        status: res.status,
        detail: detail.slice(0, 200),
      });
      throw new Error(`VLM provider returned HTTP ${res.status}`);
    }

    const json = (await res.json().catch(() => null)) as {
      candidates?: { content?: { parts?: { text?: unknown }[] } }[];
    } | null;

    // Gemini returns candidates[].content.parts[].text. RAW output — parseExtraction (the caller)
    // validates it. Missing/non-string → '' (empty draft, no throw).
    const text = json?.candidates?.[0]?.content?.parts?.find(
      (p) => typeof p.text === 'string'
    )?.text;
    return typeof text === 'string' ? text : '';
  }
}
