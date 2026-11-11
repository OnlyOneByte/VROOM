/**
 * Gemini generateContent adapter for receipt extraction. Dumb transport: parseExtraction validates the
 * output. Failures throw so the parse route can answer 502.
 */

import { logger } from '../../../../utils/logger';
import { RECEIPT_EXTRACTION_PROMPT } from './prompt';
import type { VlmProviderSettings } from './registry';
import type { RawExtraction, ReceiptImage, VlmProvider } from './vlm-provider';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_TOKENS = 1024;
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';

export class GeminiVlmProvider implements VlmProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(settings: VlmProviderSettings) {
    if (!settings.apiKey) {
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
      generationConfig: { temperature: 0, maxOutputTokens: MAX_OUTPUT_TOKENS },
    };

    // The key travels in the query string, so the URL must never be logged.
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

    // Missing or non-string text becomes an empty draft.
    const text = json?.candidates?.[0]?.content?.parts?.find(
      (p) => typeof p.text === 'string'
    )?.text;
    return typeof text === 'string' ? text : '';
  }
}
