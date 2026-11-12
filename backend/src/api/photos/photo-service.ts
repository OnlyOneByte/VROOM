import type { Photo, PhotoRef } from '../../db/schema';
import { AppError, NotFoundError, ValidationError } from '../../errors';
import { logger } from '../../utils/logger';
import type { PaginatedResult } from '../../utils/pagination';
import { storageProviderRegistry } from '../providers/domains/storage/registry';
import {
  capabilitiesOf,
  ENTITY_TO_CATEGORY,
  isImageMimeType,
  type StorageProvider,
  type StorageRef,
} from '../providers/domains/storage/storage-provider';
import { validateEntityOwnership } from './helpers';
import { photoRefRepository } from './photo-ref-repository';
import { photoRepository } from './photo-repository';

export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

export const MAX_FILE_SIZE = 10_485_760;

async function removeFailedUpload(
  provider: StorageProvider,
  providerId: string,
  storageRef: StorageRef,
  photoId: string | undefined
): Promise<void> {
  if (photoId) {
    try {
      await photoRepository.delete(photoId);
    } catch (cleanupError) {
      logger.warn('Failed to remove photo row after a DB write error', {
        photoId,
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      });
    }
  }
  try {
    await provider.delete({ providerType: provider.type, externalId: storageRef.externalId });
  } catch (cleanupError) {
    logger.warn('Failed to clean up orphaned upload after a DB write error', {
      providerId,
      storageRef: storageRef.externalId,
      error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
    });
  }
}

async function persistUploadedPhotoOrCleanup(
  provider: StorageProvider,
  providerId: string,
  storageRef: StorageRef,
  meta: {
    userId: string;
    entityType: string;
    entityId: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
  }
): Promise<Photo> {
  let photoId: string | undefined;
  try {
    const photo = await photoRepository.create({
      ...meta,
      isCover: false,
      sortOrder: 0,
    });
    photoId = photo.id;

    await photoRefRepository.create({
      photoId: photo.id,
      providerId,
      storageRef: storageRef.externalId,
      externalUrl: storageRef.externalUrl ?? null,
      status: 'active',
      syncedAt: new Date(),
    });

    return photo;
  } catch (error) {
    await removeFailedUpload(provider, providerId, storageRef, photoId);
    throw error;
  }
}

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

  // Google Photos stores images only; fail here rather than with a vendor error mid-upload.
  if (!capabilitiesOf(provider).arbitraryFiles && !isImageMimeType(file.type)) {
    throw new AppError(
      `${provider.type} stores images only — choose a Google Drive or S3 provider for PDF documents.`,
      400
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const storageRef = await provider.upload({
    fileName: file.name,
    buffer,
    mimeType: file.type,
    entityType,
    entityId,
    pathHint: folderPath,
  });

  const photo = await persistUploadedPhotoOrCleanup(provider, providerId, storageRef, {
    userId,
    entityType,
    entityId,
    fileName: file.name,
    mimeType: file.type,
    fileSize: file.size,
  });

  const backups = await storageProviderRegistry.getBackupProviders(userId, category);
  for (const backup of backups) {
    if (!capabilitiesOf(backup.provider).arbitraryFiles && !isImageMimeType(file.type)) {
      continue;
    }
    await photoRefRepository.create({
      photoId: photo.id,
      providerId: backup.providerId,
      storageRef: '',
      status: 'pending',
    });
  }

  const existingPhotos = await photoRepository.findByEntity(entityType, entityId);
  if (existingPhotos.length === 1) {
    return await photoRepository.setCoverPhoto(entityType, entityId, photo.id);
  }

  return photo;
}

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
    userId,
    pagination.limit,
    pagination.offset
  );
}

export async function listPhotosByEntityType(
  entityType: string,
  userId: string
): Promise<Record<string, Photo[]>> {
  const all = await photoRepository.findByUser(userId, entityType);
  const grouped: Record<string, Photo[]> = {};
  for (const photo of all) {
    const bucket = grouped[photo.entityId];
    if (bucket) {
      bucket.push(photo);
    } else {
      grouped[photo.entityId] = [photo];
    }
  }
  return grouped;
}

async function requireEntityPhoto(
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
  return photo;
}

export function photoETag(photo: Pick<Photo, 'id' | 'fileSize'>): string {
  return `"${photo.id}-${photo.fileSize}"`;
}

export function ifNoneMatchSatisfies(header: string | undefined | null, etag: string): boolean {
  if (!header) return false;

  const strip = (tag: string): string => (tag.startsWith('W/') ? tag.slice(2) : tag);
  const target = strip(etag);

  return header
    .split(',')
    .map((candidate) => candidate.trim())
    .some((candidate) => candidate === '*' || strip(candidate) === target);
}

export interface PhotoServeMetadata {
  etag: string;
  mimeType: string;
}

export async function getPhotoServeMetadataForEntity(
  entityType: string,
  entityId: string,
  photoId: string,
  userId: string
): Promise<PhotoServeMetadata> {
  const photo = await requireEntityPhoto(entityType, entityId, photoId, userId);
  return { etag: photoETag(photo), mimeType: photo.mimeType };
}

export async function getPhotoThumbnailForEntity(
  entityType: string,
  entityId: string,
  photoId: string,
  userId: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  const photo = await requireEntityPhoto(entityType, entityId, photoId, userId);

  const category = ENTITY_TO_CATEGORY[entityType];

  let ref = null;
  if (category) {
    try {
      const { providerId: defaultProviderId } = await storageProviderRegistry.getDefaultProvider(
        userId,
        category
      );
      ref = await photoRefRepository.findActiveByPhotoAndProvider(photoId, defaultProviderId);
    } catch (error) {
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

export async function setCoverPhotoForEntity(
  entityType: string,
  entityId: string,
  photoId: string,
  userId: string
): Promise<Photo> {
  await requireEntityPhoto(entityType, entityId, photoId, userId);

  return photoRepository.setCoverPhoto(entityType, entityId, photoId);
}

export async function deletePhotoForEntity(
  entityType: string,
  entityId: string,
  photoId: string,
  userId: string
): Promise<void> {
  const photo = await requireEntityPhoto(entityType, entityId, photoId, userId);

  const wasCover = photo.isCover;

  await deletePhotoRowsAndObjects([photoId], userId);
  await photoRepository.delete(photoId);

  if (wasCover) {
    const remaining = await photoRepository.findByEntity(entityType, entityId);
    if (remaining.length > 0) {
      await photoRepository.setCoverPhoto(entityType, entityId, remaining[0].id);
    }
  }
}

async function deletePhotoRowsAndObjects(photoIds: string[], userId: string): Promise<void> {
  if (photoIds.length === 0) return;

  const refs = await photoRefRepository.findAllByPhotos(photoIds);
  for (const [providerId, providerRefs] of groupActiveRefsByProvider(refs)) {
    await deleteObjectsFromProvider(providerId, providerRefs, userId);
  }

  await photoRefRepository.deleteByPhotos(photoIds);
}

function groupActiveRefsByProvider(refs: PhotoRef[]): Map<string, PhotoRef[]> {
  const byProvider = new Map<string, PhotoRef[]>();
  for (const ref of refs) {
    if (ref.status !== 'active') continue;
    const bucket = byProvider.get(ref.providerId) ?? [];
    bucket.push(ref);
    byProvider.set(ref.providerId, bucket);
  }
  return byProvider;
}

async function deleteObjectsFromProvider(
  providerId: string,
  refs: PhotoRef[],
  userId: string
): Promise<void> {
  let provider: StorageProvider;
  try {
    provider = await storageProviderRegistry.getProvider(providerId, userId);
  } catch (error) {
    logger.warn('Failed to get provider for photo delete', {
      providerId,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  for (const ref of refs) {
    try {
      await provider.delete({ providerType: provider.type, externalId: ref.storageRef });
    } catch (error) {
      logger.warn('Failed to delete photo from storage provider', {
        photoId: ref.photoId,
        providerId,
        storageRef: ref.storageRef,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export async function deleteAllPhotosForEntity(
  entityType: string,
  entityId: string,
  userId: string
): Promise<void> {
  await validateEntityOwnership(entityType, entityId, userId);

  const entityPhotos = await photoRepository.findByEntity(entityType, entityId);
  if (entityPhotos.length === 0) return;

  await deletePhotoRowsAndObjects(
    entityPhotos.map((p) => p.id),
    userId
  );
  await photoRepository.deleteByEntity(entityType, entityId);
}

// Photos have no FK to their entity, so children must be deleted explicitly here.
export async function deletePhotosForEntities(
  entityType: string,
  entityIds: string[],
  userId: string
): Promise<void> {
  if (entityIds.length === 0) return;

  const entityPhotos = await photoRepository.findByEntities(entityType, entityIds);
  if (entityPhotos.length === 0) return;

  await deletePhotoRowsAndObjects(
    entityPhotos.map((p) => p.id),
    userId
  );
  await photoRepository.deleteByEntities(entityType, entityIds);
}
