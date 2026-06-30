/**
 * Anthropic (Claude) VLM adapter (vlm-receipt-parsing T3b). Implements `VlmProvider.extractReceipt`
 * against the Anthropic Messages API (`POST https://api.anthropic.com/v1/messages` with a base64
 * `image` content block + a `text` block carrying the FIXED prompt).
 *
 * Same DUMB-TRANSPORT contract as the OpenAI-compatible adapter (T3a): send the fixed prompt + image,
 * return the model's RAW text; the shared `parseExtraction` (prompt.ts) is the SOLE validator. A
 * non-2xx / network / timeout failure THROWS (the parse route maps it to 502; never a faked success —
 * the #43/#44/#144 anti-fail-open lesson). The api key goes in the `x-api-key` header (Anthropic's
 * scheme, NOT Bearer), and the required `anthropic-version` header pins the wire format.
 */

import { logger } from '../../../../utils/logger';
import { RECEIPT_EXTRACTION_PROMPT } from './prompt';
import type { VlmProviderSettings } from './registry';
import type { RawExtraction, ReceiptImage, VlmProvider } from './vlm-provider';

/** Hard ceiling on a single parse call (cost + a hung-endpoint guard). */
const REQUEST_TIMEOUT_MS = 30_000;
/** Cap the completion size — a receipt extraction is a small JSON object. */
const MAX_TOKENS = 1024;
/** Anthropic requires this header; pin a stable version so the wire format cannot drift under us. */
const ANTHROPIC_VERSION = '2023-06-01';
/** Default endpoint; `baseUrl` can override for a compatible proxy. */
const DEFAULT_BASE_URL = 'https://api.anthropic.com';

export class AnthropicVlmProvider implements VlmProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(settings: VlmProviderSettings) {
    if (!settings.apiKey) {
      // Defense-in-depth: the create/PUT gate already requires a key for non-ollama types.
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
      // Deterministic extraction — no creativity wanted.
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
      // Network failure / timeout — surface honestly (route → 502). Do NOT log the api key.
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

    // Anthropic returns content[] blocks; the model's text is the first text block. RAW output —
    // parseExtraction (the caller) validates it. Missing/non-string → '' (empty draft, no throw).
    const textBlock = json?.content?.find((b) => b.type === 'text');
    return typeof textBlock?.text === 'string' ? textBlock.text : '';
  }
}
