/**
 * OpenAI Chat Completions vision adapter, also used for Ollama and other compatible endpoints.
 * Dumb transport: parseExtraction validates the output.
 */

import type { ModelProviderSettings } from '../model/model-registry';
import { postModelJson, trimBaseUrl } from '../model/model-transport';
import { RECEIPT_EXTRACTION_PROMPT } from './prompt';
import type { RawExtraction, ReceiptImage, VlmProvider } from './vlm-provider';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_TOKENS = 1024;

interface OpenAiResponse {
  choices?: { message?: { content?: unknown } }[];
}

export class OpenAiCompatibleVlmProvider implements VlmProvider {
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(settings: ModelProviderSettings) {
    if (!settings.baseUrl) {
      throw new Error('OpenAI-compatible VLM requires a base URL');
    }
    this.apiKey = settings.apiKey;
    this.model = settings.model;
    this.baseUrl = trimBaseUrl(settings.baseUrl);
  }

  async extractReceipt(image: ReceiptImage): Promise<RawExtraction> {
    const dataUrl = `data:${image.mimeType};base64,${image.data.toString('base64')}`;

    const json = await postModelJson<OpenAiResponse>({
      domain: 'VLM',
      providerType: 'openai-compatible',
      model: this.model,
      url: `${this.baseUrl}/chat/completions`,
      headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
      timeoutMs: REQUEST_TIMEOUT_MS,
      body: {
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
      },
    });

    // Missing or non-string content becomes an empty draft.
    const content = json?.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content : '';
  }
}
