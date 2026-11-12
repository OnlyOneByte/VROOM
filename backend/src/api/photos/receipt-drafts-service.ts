import type { ReceiptDraft } from '../providers/domains/vlm/prompt';
import type { PhotosMediaItem } from '../providers/services/google-photos-service';

export interface ReceiptDraftItem {
  photoId: string;
  draft: ReceiptDraft;
  thumbnailUrl: string | null;
}

export interface StageDeps {
  listReceiptPhotos: (maxItems: number) => Promise<PhotosMediaItem[]>;
  downloadPhoto: (photoId: string) => Promise<Buffer>;
  freshUrl: (photoId: string) => Promise<string | null>;
  parseImage: (bytes: Buffer, mimeType: string) => Promise<ReceiptDraft>;
  isAlreadyImported: (photoId: string) => Promise<boolean>;
}

export const MAX_RECEIPT_PHOTOS_PER_RUN = 25;

export async function stageReceiptDrafts(
  deps: StageDeps,
  maxItems = MAX_RECEIPT_PHOTOS_PER_RUN
): Promise<ReceiptDraftItem[]> {
  const photos = await deps.listReceiptPhotos(maxItems);
  const drafts: ReceiptDraftItem[] = [];

  for (const photo of photos) {
    if (await deps.isAlreadyImported(photo.id)) continue;

    const draft = await stageOne(deps, photo);
    drafts.push(draft);
  }

  return drafts;
}

async function stageOne(deps: StageDeps, photo: PhotosMediaItem): Promise<ReceiptDraftItem> {
  const thumbnailUrl = await safeFreshUrl(deps, photo);

  try {
    const bytes = await deps.downloadPhoto(photo.id);
    const draft = await deps.parseImage(bytes, photo.mimeType ?? 'image/jpeg');
    return { photoId: photo.id, draft, thumbnailUrl };
  } catch {
    return { photoId: photo.id, draft: {}, thumbnailUrl };
  }
}

async function safeFreshUrl(deps: StageDeps, photo: PhotosMediaItem): Promise<string | null> {
  try {
    return await deps.freshUrl(photo.id);
  } catch {
    return null;
  }
}
