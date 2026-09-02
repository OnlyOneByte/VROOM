/**
 * Photos → auto-expense STAGE orchestration (photos-auto-expense T2). Walks the receipt photos VROOM
 * uploaded to its own Google Photos album, parses each through the user's VLM (the shipped fail-closed
 * seam), and returns a LIST of expense DRAFTS — PERSISTING NOTHING. The FE reviews + confirms each draft
 * through the UNCHANGED POST /expenses with `clientId = photos:<mediaId>` (the shipped idempotency), so a
 * re-run never doubles an expense and an already-imported photo is filtered out here (design §2/§3).
 *
 * FORK-FREE + ARCC-SAFE: this is pure orchestration over INJECTED dependencies (the Photos read, the VLM
 * parse, the already-imported check) — the route wires the real seams, a test injects fakes. The live
 * `mediaItems:search` read itself (the OAuth read scope) is ARCC-gated and lands in a LATER slice
 * (T1-live + T5); here `listReceiptPhotos` either works against the fake or throws an honest
 * "not enabled" the route maps to an actionable message. No live-read code is added by this slice.
 *
 * Error honesty (#43/#44/#144): a Photos transport failure THROWS (the route maps it to 502); a VLM
 * failure on ONE item yields that item an EMPTY draft (the user fills it) rather than failing the whole
 * batch — never a fabricated parse.
 */

import type { ReceiptDraft } from '../providers/domains/vlm/prompt';
import type { PhotosMediaItem } from '../providers/services/google-photos-service';

/** One staged receipt: the source photo + the (possibly empty) parsed draft + a fresh thumbnail URL. */
export interface ReceiptDraftItem {
  /** The Google Photos media-item id — also the dedup key (`clientId = photos:<photoId>`). */
  photoId: string;
  /** The fail-closed draft (empty when the VLM could not read this one — the user fills it by hand). */
  draft: ReceiptDraft;
  /** A fresh (short-lived) baseUrl for the review thumbnail, or null if it could not be resolved. */
  thumbnailUrl: string | null;
}

/** The injected seams the orchestration needs — the route supplies real ones, a test supplies fakes. */
export interface StageDeps {
  /** List up to `maxItems` app-created receipt photos (GooglePhotosService.listReceiptPhotos). */
  listReceiptPhotos: (maxItems: number) => Promise<PhotosMediaItem[]>;
  /** Download one media item's bytes (GooglePhotosService.download). */
  downloadPhoto: (photoId: string) => Promise<Buffer>;
  /** A fresh thumbnail baseUrl for a media item, or null (GooglePhotosService.getFreshUrl). */
  freshUrl: (photoId: string) => Promise<string | null>;
  /** Parse image bytes into a fail-closed draft (getVlmProvider().extractReceipt → parseExtraction). */
  parseImage: (bytes: Buffer, mimeType: string) => Promise<ReceiptDraft>;
  /** True when this media item already backs an expense (the `photos:<id>` clientId already exists). */
  isAlreadyImported: (photoId: string) => Promise<boolean>;
}

/** D4 (ruled): cap the per-run photo count — bounds VLM cost + a hung-sweep DoS. */
export const MAX_RECEIPT_PHOTOS_PER_RUN = 25;

/**
 * Stage the un-imported receipt photos into drafts. Returns one {@link ReceiptDraftItem} per NEW photo
 * (already-imported ones are filtered out, design §3/R5). A per-item VLM failure degrades to an empty
 * draft for THAT item; a Photos LIST/transport failure propagates (the route → 502). PERSISTS NOTHING.
 */
export async function stageReceiptDrafts(
  deps: StageDeps,
  maxItems = MAX_RECEIPT_PHOTOS_PER_RUN
): Promise<ReceiptDraftItem[]> {
  const photos = await deps.listReceiptPhotos(maxItems);
  const drafts: ReceiptDraftItem[] = [];

  for (const photo of photos) {
    // Skip a photo whose draft was already confirmed into an expense (the idempotency cross-ref, D3).
    if (await deps.isAlreadyImported(photo.id)) continue;

    const draft = await stageOne(deps, photo);
    drafts.push(draft);
  }

  return drafts;
}

/**
 * Stage ONE photo: download → VLM-parse → fresh thumbnail. A VLM/parse failure on this item is caught
 * and degraded to an empty draft (the user fills it) — never a thrown batch failure. A thumbnail-URL
 * failure degrades to null. (A LIST/download transport failure is NOT caught here — it propagates to
 * the route as a 502, the honest signal that the whole sweep could not run.)
 */
async function stageOne(deps: StageDeps, photo: PhotosMediaItem): Promise<ReceiptDraftItem> {
  const thumbnailUrl = await safeFreshUrl(deps, photo);

  try {
    const bytes = await deps.downloadPhoto(photo.id);
    const draft = await deps.parseImage(bytes, photo.mimeType ?? 'image/jpeg');
    return { photoId: photo.id, draft, thumbnailUrl };
  } catch {
    // Per-item failure (a flaky download or a VLM error on one image) → an EMPTY draft, not a batch fail.
    return { photoId: photo.id, draft: {}, thumbnailUrl };
  }
}

/** Resolve a fresh thumbnail URL, degrading a failure to null (a missing thumbnail is not fatal). */
async function safeFreshUrl(deps: StageDeps, photo: PhotosMediaItem): Promise<string | null> {
  try {
    return await deps.freshUrl(photo.id);
  } catch {
    return null;
  }
}
