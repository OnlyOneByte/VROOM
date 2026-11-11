/**
 * Anthropic Messages API adapter for receipt extraction. Dumb transport: parseExtraction validates the
 * output.
 */

import type { ModelProviderSettings } from '../model/model-registry';
import { postModelJson, trimBaseUrl } from '../model/model-transport';
import { RECEIPT_EXTRACTION_PROMPT } from './prompt';
import type { RawExtraction, ReceiptImage, VlmProvider } from './vlm-provider';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_TOKENS = 1024;
/** Pinned so the wire format cannot drift. */
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_BASE_URL = 'https://api.anthropic.com';

interface AnthropicResponse {
  content?: { type?: string; text?: unknown }[];
}

export class AnthropicVlmProvider implements VlmProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(settings: ModelProviderSettings) {
    if (!settings.apiKey) {
      throw new Error('Anthropic VLM requires an API key');
    }
    this.apiKey = settings.apiKey;
    this.model = settings.model;
    this.baseUrl = trimBaseUrl(settings.baseUrl ?? DEFAULT_BASE_URL);
  }

  async extractReceipt(image: ReceiptImage): Promise<RawExtraction> {
    const json = await postModelJson<AnthropicResponse>({
      domain: 'VLM',
      providerType: 'anthropic',
      model: this.model,
      url: `${this.baseUrl}/v1/messages`,
      headers: { 'x-api-key': this.apiKey, 'anthropic-version': ANTHROPIC_VERSION },
      timeoutMs: REQUEST_TIMEOUT_MS,
      body: {
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
      },
    });

    // Missing or non-string text becomes an empty draft.
    const textBlock = json?.content?.find((b) => b.type === 'text');
    return typeof textBlock?.text === 'string' ? textBlock.text : '';
  }
}
