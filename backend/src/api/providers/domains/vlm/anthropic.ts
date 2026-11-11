/**
 * Anthropic Messages API adapter for receipt extraction. Dumb transport: parseExtraction validates the
 * output. Failures throw so the parse route can answer 502.
 */

import { logger } from '../../../../utils/logger';
import { RECEIPT_EXTRACTION_PROMPT } from './prompt';
import type { VlmProviderSettings } from './registry';
import type { RawExtraction, ReceiptImage, VlmProvider } from './vlm-provider';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_TOKENS = 1024;
/** Pinned so the wire format cannot drift. */
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_BASE_URL = 'https://api.anthropic.com';

export class AnthropicVlmProvider implements VlmProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(settings: VlmProviderSettings) {
    if (!settings.apiKey) {
      throw new Error('Anthropic VLM requires an API key');
    }
    this.apiKey = settings.apiKey;
    this.model = settings.model;
    this.baseUrl = (settings.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  async extractReceipt(image: ReceiptImage): Promise<RawExtraction> {
    const body = {
      model: this.model,
      max_tokens: MAX_TOKENS,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: image.mimeType,
                data: image.data.toString('base64'),
              },
            },
            { type: 'text', text: RECEIPT_EXTRACTION_PROMPT },
          ],
        },
      ],
    };

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // Never log the api key.
      const message = err instanceof Error ? err.message : 'network error';
      logger.warn('VLM anthropic request failed', { model: this.model, error: message });
      throw new Error(`VLM request failed: ${message}`);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      logger.warn('VLM anthropic non-2xx', {
        model: this.model,
        status: res.status,
        detail: detail.slice(0, 200),
      });
      throw new Error(`VLM provider returned HTTP ${res.status}`);
    }

    const json = (await res.json().catch(() => null)) as {
      content?: { type?: string; text?: unknown }[];
    } | null;

    // Missing or non-string text becomes an empty draft.
    const textBlock = json?.content?.find((b) => b.type === 'text');
    return typeof textBlock?.text === 'string' ? textBlock.text : '';
  }
}
