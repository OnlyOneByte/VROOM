// Adapters are transport only; callers must run parseExtraction on the output.

export interface ReceiptImage {
  data: Buffer;
  mimeType: string;
}

export type RawExtraction = string | Record<string, unknown>;

export interface VlmProvider {
  extractReceipt(image: ReceiptImage): Promise<RawExtraction>;
}
