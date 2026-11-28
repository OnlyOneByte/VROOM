import { isSyncError, SyncErrorCode } from '../../errors';
import type { ReceiptDraft } from '../providers/domains/vlm/prompt';
import type { PhotosMediaItem } from '../providers/services/google-photos-service';

export interface ReceiptDraftItem {
  photoId: string;
  draft: ReceiptDraft;
  thumbnailUrl: string | null;
  failed?: boolean;
}

export interface StageDeps {
  listReceiptPhotos: (maxItems: number) => Promise<PhotosMediaItem[]>;
  downloadPhoto: (photoId: string) => Promise<Buffer>;
  freshUrl: (photoId: string) => Promise<string | null>;
  parseImage: (bytes: Buffer, mimeType: string) => Promise<ReceiptDraft>;
  isAlreadyImported: (photoId: string) => Promise<boolean>;
}

export const MAX_RECEIPT_PHOTOS_PER_RUN = 25;
export const MAX_RECEIPT_PHOTOS_LOOKED_AT = 4 * MAX_RECEIPT_PHOTOS_PER_RUN;
export const MAX_SCAN_BYTES = 8 * 1024 * 1024;
const SCANNABLE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type ScanStopReason = 'ai_key' | 'ai_rate_limit' | 'photos_access';

export class ReceiptScanStopped extends Error {
  constructor(readonly reason: ScanStopReason) {
    super(`Receipt scans stopped: ${reason}`);
  }
}

function stopReasonOf(error: unknown): ScanStopReason | null {
  if (
    isSyncError(error) &&
    (error.code === SyncErrorCode.AUTH_INVALID || error.code === SyncErrorCode.PERMISSION_DENIED)
  ) {
    return 'photos_access';
  }
  const message = error instanceof Error ? error.message : '';
  if (/HTTP 429\b/.test(message)) return 'ai_rate_limit';
  if (/HTTP 40[13]\b/.test(message)) return 'ai_key';
  return null;
}

export async function stageReceiptDrafts(
  deps: StageDeps,
  maxItems = MAX_RECEIPT_PHOTOS_PER_RUN
): Promise<ReceiptDraftItem[]> {
  const photos = await deps.listReceiptPhotos(Math.max(maxItems, MAX_RECEIPT_PHOTOS_LOOKED_AT));
  const drafts: ReceiptDraftItem[] = [];

  for (const photo of photos) {
    if (drafts.length >= maxItems) break;
    if (await deps.isAlreadyImported(photo.id)) continue;
    drafts.push(await stageOne(deps, photo));
  }

  return drafts;
}

async function stageOne(deps: StageDeps, photo: PhotosMediaItem): Promise<ReceiptDraftItem> {
  const thumbnailUrl = await safeFreshUrl(deps, photo);
  const unread = { photoId: photo.id, draft: {}, thumbnailUrl, failed: true };
  const mimeType = photo.mimeType ?? 'image/jpeg';
  if (!SCANNABLE_TYPES.has(mimeType)) return unread;

  try {
    const bytes = await deps.downloadPhoto(photo.id);
    if (bytes.byteLength > MAX_SCAN_BYTES) return unread;
    const draft = await deps.parseImage(bytes, mimeType);
    return Object.keys(draft).length === 0 ? unread : { photoId: photo.id, draft, thumbnailUrl };
  } catch (error) {
    const stop = stopReasonOf(error);
    if (stop) throw new ReceiptScanStopped(stop);
    return unread;
  }
}

async function safeFreshUrl(deps: StageDeps, photo: PhotosMediaItem): Promise<string | null> {
  try {
    return await deps.freshUrl(photo.id);
  } catch {
    return null;
  }
}
