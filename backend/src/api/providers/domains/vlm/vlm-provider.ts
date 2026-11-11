/** Adapters are transport only. Callers must run parseExtraction on what they return. */

export interface ReceiptImage {
  data: Buffer;
  mimeType: string;
}

export type RawExtraction = string | Record<string, unknown>;

export interface VlmProvider {
  /** Throws on transport or auth failure so the parse route can answer 502. */
  extractReceipt(image: ReceiptImage): Promise<RawExtraction>;
}
