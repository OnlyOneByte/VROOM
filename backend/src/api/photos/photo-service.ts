import type { Photo, PhotoRef } from '../../db/schema';
import { AppError, NotFoundError, ValidationError } from '../../errors';
import { logger } from '../../utils/logger';
import type { PaginatedResult } from '../../utils/pagination';
import { storageProviderRegistry } from '../providers/domains/storage/registry';
import { ENTITY_TO_CATEGORY } from '../providers/domains/storage/storage-provider';
import { validateEntityOwnership } from './helpers';
import { photoRefRepository } from './photo-ref-repository';
import { photoRepository } from './photo-repository';

/** Accepted MIME types for photo/document uploads */
export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

/** Maximum file size in bytes (10 MB) */
export const MAX_FILE_SIZE = 10_485_760;

/**
 * Upload a photo for an entity. Validates ownership, file type/size,
 * uploads to the user's default storage provider, creates a DB record
 * and photo_ref, and auto-sets cover if this is the first photo.
 */
export async function uploadPhotoForEntity(
  entityType: string,
  entityId: string,
  userId: string,
  file: File
): Promise<Photo> {
  await validateEntityOwnership(entityType, entityId, userId);

  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    throw new AppError('Only JPEG, PNG, WebP images and PDF files are allowed', 400);
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new AppError('Photo must be under 10MB', 413);
  }

  const category = ENTITY_TO_CATEGORY[entityType];
  if (!category) {
    throw new AppError(`No photo category mapping for entity type: ${entityType}`, 400);
  }

  const { provider, providerId, folderPath } = await storageProviderRegistry.getDefaultProvider(
    userId,
    category
  );

  const buffer = Buffer.from(await file.arrayBuffer());
  const storageRef = await provider.upload({
    fileName: file.name,
    buffer,
    mimeType: file.type,
    entityType,
    entityId,
    pathHint: folderPath,
  });

  // Insert logical photo record (metadata only — no provider fields)
  const photo = await photoRepository.create({
    userId,
    entityType,
    entityId,
    fileName: file.name,
    mimeType: file.type,
    fileSize: file.size,
    isCover: false,
    sortOrder: 0,
  });

  // Insert photo_ref for the default provider (active immediately)
  await photoRefRepository.create({
    photoId: photo.id,
    providerId,
    storageRef: storageRef.externalId,
    externalUrl: storageRef.externalUrl ?? null,
    status: 'active',
    syncedAt: new Date(),
  });

  // Create pending refs for backup providers (sync worker picks these up)
  const backups = await storageProviderRegistry.getBackupProviders(userId, category);
  for (const backup of backups) {
    await photoRefRepository.create({
      photoId: photo.id,
      providerId: backup.providerId,
      storageRef: '',
      status: 'pending',
    });
  }

  // Auto-set cover if this is the first photo for the entity
  const existingPhotos = await photoRepository.findByEntity(entityType, entityId);
  if (existingPhotos.length === 1) {
    return await photoRepository.setCoverPhoto(entityType, entityId, photo.id);
  }

  return photo;
}

/**
 * List photos for an entity with pagination, ordered by sortOrder then createdAt.
 */
export async function listPhotosForEntity(
  entityType: string,
  entityId: string,
  userId: string,
  pagination: { limit: number; offset: number }
): Promise<PaginatedResult<Photo>> {
  await validateEntityOwnership(entityType, entityId, userId);
  return photoRepository.findByEntityPaginated(
    entityType,
    entityId,
    pagination.limit,
    pagination.offset
  );
}

/**
 * Download a photo via the provider abstraction and return the raw buffer + MIME type.
 * Uses a fallback chain: try the user's default provider first, then any active ref.
 */
export async function getPhotoThumbnailForEntity(
  entityType: string,
  entityId: string,
  photoId: string,
  userId: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  await validateEntityOwnership(entityType, entityId, userId);

  const photo = await photoRepository.findById(photoId);
  if (!photo || photo.entityType !== entityType || photo.entityId !== entityId) {
    throw new NotFoundError('Photo');
  }

  const category = ENTITY_TO_CATEGORY[entityType];

  // Try the default provider first, fall back to any active ref
  let ref = null;
  if (category) {
    try {
      const { providerId: defaultProviderId } = await storageProviderRegistry.getDefaultProvider(
        userId,
        category
      );
      ref = await photoRefRepository.findActiveByPhotoAndProvider(photoId, defaultProviderId);
    } catch (error) {
      // Only swallow "no provider configured" errors — rethrow unexpected failures
      if (!(error instanceof ValidationError) && !(error instanceof NotFoundError)) {
        throw error;
      }
    }
  }

  if (!ref) {
    ref = await photoRefRepository.findActiveByPhoto(photoId);
  }

  if (!ref) {
    throw new AppError(
      'Photo exists but no storage provider is configured to serve it. Please configure a storage provider in Settings.',
      422
    );
  }

  const provider = await storageProviderRegistry.getProvider(ref.providerId, userId);
  const buffer = await provider.download({
    providerType: provider.type,
    externalId: ref.storageRef,
  });

  return { buffer, mimeType: photo.mimeType };
}

/**
 * Set a photo as the cover photo for an entity.
 */
export async function setCoverPhotoForEntity(
  entityType: string,
  entityId: string,
  photoId: string,
  userId: string
): Promise<Photo> {
  await validateEntityOwnership(entityType, entityId, userId);

  const photo = await photoRepository.findById(photoId);
  if (!photo || photo.entityType !== entityType || photo.entityId !== entityId) {
    throw new NotFoundError('Photo');
  }

  return photoRepository.setCoverPhoto(entityType, entityId, photoId);
}

/**
 * Delete a single photo: remove from all providers (best-effort), delete photo_refs,
 * delete DB record, and promote the next cover if the deleted photo was the cover.
 */
export async function deletePhotoForEntity(
  entityType: string,
  entityId: string,
  photoId: string,
  userId: string
): Promise<void> {
  await validateEntityOwnership(entityType, entityId, userId);

  const photo = await photoRepository.findById(photoId);
  if (!photo || photo.entityType !== entityType || photo.entityId !== entityId) {
    throw new NotFoundError('Photo');
  }

  const wasCover = photo.isCover;

  // Find all refs and attempt provider-side deletes (best-effort)
  const refs = await photoRefRepository.findAllByPhoto(photoId);
  for (const ref of refs) {
    if (ref.status !== 'active') continue;
    try {
      const provider = await storageProviderRegistry.getProvider(ref.providerId, userId);
      await provider.delete({
        providerType: provider.type,
        externalId: ref.storageRef,
      });
    } catch (error) {
      logger.warn('Failed to delete photo from storage provider', {
        photoId,
        providerId: ref.providerId,
        storageRef: ref.storageRef,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Delete all photo_refs, then the photo record
  await photoRefRepository.deleteByPhoto(photoId);
  await photoRepository.delete(photoId);

  if (wasCover) {
    const remaining = await photoRepository.findByEntity(entityType, entityId);
    if (remaining.length > 0) {
      await photoRepository.setCoverPhoto(entityType, entityId, remaining[0].id);
    }
  }
}

/**
 * Best-effort delete files from providers for a set of photo refs, grouped by provider.
 */
async function deleteRefsFromProviders(
  refsByProvider: Map<string, PhotoRef[]>,
  userId: string
): Promise<void> {
  for (const [providerId, refs] of refsByProvider) {
    try {
      const provider = await storageProviderRegistry.getProvider(providerId, userId);
      for (const ref of refs) {
        try {
          await provider.delete({ providerType: provider.type, externalId: ref.storageRef });
        } catch (error) {
          logger.warn('Failed to delete photo from provider during cascade', {
            photoId: ref.photoId,
            providerId: ref.providerId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch (error) {
      logger.warn('Failed to get provider for cascade delete', {
        providerId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Delete all photos for an entity (cascade). Validates ownership, removes
 * provider files best-effort, then deletes all photo_refs and photo DB records.
 */
export async function deleteAllPhotosForEntity(
  entityType: string,
  entityId: string,
  userId: string
): Promise<void> {
  await validateEntityOwnership(entityType, entityId, userId);

  const entityPhotos = await photoRepository.findByEntity(entityType, entityId);
  if (entityPhotos.length === 0) return;

  const photoIds = entityPhotos.map((p) => p.id);
  const allRefs = await photoRefRepository.findAllByPhotos(photoIds);

  // Group active refs by provider to reuse provider instances
  const refsByProvider = new Map<string, PhotoRef[]>();
  for (const ref of allRefs) {
    if (ref.status !== 'active') continue;
    const existing = refsByProvider.get(ref.providerId) ?? [];
    existing.push(ref);
    refsByProvider.set(ref.providerId, existing);
  }

  await deleteRefsFromProviders(refsByProvider, userId);

  // Batch delete all refs, then all photo records
  await photoRefRepository.deleteByPhotos(photoIds);
  await photoRepository.deleteByEntity(entityType, entityId);
}
