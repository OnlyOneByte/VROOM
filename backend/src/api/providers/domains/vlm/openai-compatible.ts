/**
 * OpenAI Chat Completions vision adapter, also used for Ollama and other compatible endpoints.
 * Dumb transport: parseExtraction validates the output. Failures throw so the parse route can answer 502.
 */

import { logger } from '../../../../utils/logger';
import { RECEIPT_EXTRACTION_PROMPT } from './prompt';
import type { VlmProviderSettings } from './registry';
import type { RawExtraction, ReceiptImage, VlmProvider } from './vlm-provider';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_TOKENS = 1024;

export class OpenAiCompatibleVlmProvider implements VlmProvider {
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(settings: VlmProviderSettings) {
    if (!settings.baseUrl) {
      throw new Error('OpenAI-compatible VLM requires a base URL');
    }
    this.apiKey = settings.apiKey;
    this.model = settings.model;
    this.baseUrl = settings.baseUrl.replace(/\/+$/, '');
  }

  async extractReceipt(image: ReceiptImage): Promise<RawExtraction> {
    const dataUrl = `data:${image.mimeType};base64,${image.data.toString('base64')}`;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const body = {
      model: this.model,
      max_tokens: MAX_TOKENS,
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
      // Never log the api key.
      const message = err instanceof Error ? err.message : 'network error';
      logger.warn('VLM openai-compatible request failed', { model: this.model, error: message });
      throw new Error(`VLM request failed: ${message}`);
    }

    if (!res.ok) {
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
    // Missing or non-string content becomes an empty draft.
    return typeof content === 'string' ? content : '';
  }
}
