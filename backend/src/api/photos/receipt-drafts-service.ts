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
  listReceiptPhotos: (
    maxItems: number,
    skip: (photoId: string) => Promise<boolean>
  ) => Promise<PhotosMediaItem[]>;
  downloadPhoto: (photoId: string) => Promise<Buffer>;
  freshUrl: (photoId: string) => Promise<string | null>;
  parseImage: (bytes: Buffer, mimeType: string) => Promise<ReceiptDraft>;
  isAlreadyImported: (photoId: string) => Promise<boolean>;
  cachedDraft: (photoId: string) => ReceiptDraft | undefined;
  rememberDraft: (photoId: string, draft: ReceiptDraft) => void;
}

export const MAX_RECEIPT_PHOTOS_PER_RUN = 25;
export const MAX_SCAN_BYTES = 8 * 1024 * 1024;
const SCANNABLE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type ScanStopReason = 'ai_key' | 'ai_rate_limit' | 'photos_access' | 'photos_quota';

export class ReceiptScanStopped extends Error {
  constructor(readonly reason: ScanStopReason) {
    super(`Receipt scans stopped: ${reason}`);
  }
}

function photosStopOf(error: unknown): ScanStopReason | null {
  if (!isSyncError(error)) return null;
  if (error.code === SyncErrorCode.QUOTA_EXCEEDED) return 'photos_quota';
  if (error.code === SyncErrorCode.AUTH_INVALID || error.code === SyncErrorCode.PERMISSION_DENIED) {
    return 'photos_access';
  }
  return null;
}

function stopReasonOf(error: unknown): ScanStopReason | null {
  const photosStop = photosStopOf(error);
  if (photosStop) return photosStop;
  const message = error instanceof Error ? error.message : '';
  if (/HTTP 429\b/.test(message)) return 'ai_rate_limit';
  if (/HTTP 40[13]\b/.test(message)) return 'ai_key';
  return null;
}

export async function stageReceiptDrafts(
  deps: StageDeps,
  maxItems = MAX_RECEIPT_PHOTOS_PER_RUN
): Promise<ReceiptDraftItem[]> {
  const photos = await listNotImported(deps, maxItems);
  const drafts: ReceiptDraftItem[] = [];

  for (const photo of photos.slice(0, maxItems)) {
    drafts.push(await stageOne(deps, photo));
  }

  return drafts;
}

async function listNotImported(deps: StageDeps, maxItems: number): Promise<PhotosMediaItem[]> {
  try {
    return await deps.listReceiptPhotos(maxItems, deps.isAlreadyImported);
  } catch (error) {
    const stop = photosStopOf(error);
    if (stop) throw new ReceiptScanStopped(stop);
    throw error;
  }
}

async function stageOne(deps: StageDeps, photo: PhotosMediaItem): Promise<ReceiptDraftItem> {
  const thumbnailUrl = await safeFreshUrl(deps, photo);
  const unread = { photoId: photo.id, draft: {}, thumbnailUrl, failed: true };
  const mimeType = photo.mimeType ?? 'image/jpeg';
  if (!SCANNABLE_TYPES.has(mimeType)) return unread;
  const cached = deps.cachedDraft(photo.id);
  if (cached) return { photoId: photo.id, draft: cached, thumbnailUrl };

  try {
    const bytes = await deps.downloadPhoto(photo.id);
    if (bytes.byteLength > MAX_SCAN_BYTES) return unread;
    const draft = await deps.parseImage(bytes, mimeType);
    if (Object.keys(draft).length === 0) return unread;
    deps.rememberDraft(photo.id, draft);
    return { photoId: photo.id, draft, thumbnailUrl };
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
