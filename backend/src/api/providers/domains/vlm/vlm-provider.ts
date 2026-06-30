/**
 * VlmProvider — the strategy interface every VLM (vision-LLM) adapter implements
 * (vlm-receipt-parsing T2). Mirrors the storage domain's `StorageProvider` seam: the registry
 * decrypts a `user_providers` row's credentials and instantiates the correct adapter, and the
 * parse route calls `extractReceipt`. The adapters' live HTTP lands in T3; this file + the
 * shared `prompt.ts` own the contract so behavior is identical across providers.
 */

/** A receipt image to extract from. `mimeType` is the uploaded file's content type. */
export interface ReceiptImage {
  /** Raw image bytes (already downscaled/size-capped by the parse route — T4). */
  data: Buffer;
  /** e.g. 'image/jpeg' | 'image/png' | 'image/webp'. */
  mimeType: string;
}

/**
 * The RAW model output, BEFORE validation. An adapter returns whatever the model produced (a JSON
 * string or an already-parsed object); the shared `parseExtraction` (prompt.ts) is the SOLE place
 * that validates + bounds it into a trusted `ReceiptDraft`. Keeping adapters dumb (just transport)
 * means the untrusted-output discipline (design §7.3) lives in exactly one audited spot.
 */
export type RawExtraction = string | Record<string, unknown>;

export interface VlmProvider {
  /**
   * Send the image + the fixed extraction prompt to the model and return its RAW response.
   * MUST NOT validate or trust the content — the registry's caller runs `parseExtraction` on the
   * result. Throws on a transport/auth failure (the parse route maps that to a 502, never a fake
   * success — the #43/#44/#144 anti-fail-open lesson).
   */
  extractReceipt(image: ReceiptImage): Promise<RawExtraction>;
}
