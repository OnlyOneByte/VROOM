import type { ModelProviderSettings } from '../model/model-registry';
import { postModelJson, trimBaseUrl } from '../model/model-transport';
import { RECEIPT_EXTRACTION_PROMPT } from './prompt';
import type { RawExtraction, ReceiptImage, VlmProvider } from './vlm-provider';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_TOKENS = 1024;
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: unknown }[] } }[];
}

export class GeminiVlmProvider implements VlmProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(settings: ModelProviderSettings) {
    if (!settings.apiKey) {
      throw new Error('Gemini VLM requires an API key');
    }
    this.apiKey = settings.apiKey;
    this.model = settings.model;
    this.baseUrl = trimBaseUrl(settings.baseUrl ?? DEFAULT_BASE_URL);
  }

  async extractReceipt(image: ReceiptImage): Promise<RawExtraction> {
    const json = await postModelJson<GeminiResponse>({
      domain: 'VLM',
      providerType: 'gemini',
      model: this.model,
      url: `${this.baseUrl}/v1beta/models/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`,
      timeoutMs: REQUEST_TIMEOUT_MS,
      body: {
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
      },
    });

    const text = json?.candidates?.[0]?.content?.parts?.find(
      (p) => typeof p.text === 'string'
    )?.text;
    return typeof text === 'string' ? text : '';
  }
}
