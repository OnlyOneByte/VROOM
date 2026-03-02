import type { Photo } from '../../db/schema';
import { AppError, NotFoundError } from '../../errors';
import { logger } from '../../utils/logger';
import { getDriveServiceForUser } from '../sync/google-drive';
import { resolveEntityDriveFolder, validateEntityOwnership } from './helpers';
import { photoRepository } from './photo-repository';

/** Accepted MIME types for photo/document uploads */
export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

/** Maximum file size in bytes (10 MB) */
export const MAX_FILE_SIZE = 10_485_760;

/**
 * Upload a photo for an entity. Validates ownership, file type/size,
 * uploads to Google Drive, creates a DB record, and auto-sets cover
 * if this is the first photo for the entity.
 */
export async function uploadPhotoForEntity(
  entityType: string,
  entityId: string,
  userId: string,
  userName: string,
  file: File
): Promise<Photo> {
  await validateEntityOwnership(entityType, entityId, userId);

  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    throw new AppError('Only JPEG, PNG, WebP images and PDF files are allowed', 400);
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new AppError('Photo must be under 10MB', 413);
  }

  const driveService = await getDriveServiceForUser(userId);
  const folderId = await resolveEntityDriveFolder(driveService, entityType, entityId, userName);

  const buffer = Buffer.from(await file.arrayBuffer());
  const driveFile = await driveService.uploadFile(file.name, buffer, file.type, folderId);

  const photo = await photoRepository.create({
    entityType,
    entityId,
    driveFileId: driveFile.id,
    fileName: file.name,
    mimeType: file.type,
    fileSize: file.size,
    webViewLink: driveFile.webViewLink,
    isCover: false,
    sortOrder: 0,
  });

  const existingPhotos = await photoRepository.findByEntity(entityType, entityId);
  if (existingPhotos.length === 1) {
    return await photoRepository.setCoverPhoto(entityType, entityId, photo.id);
  }

  return photo;
}

/**
 * List all photos for an entity, ordered by sortOrder then createdAt.
 */
export async function listPhotosForEntity(
  entityType: string,
  entityId: string,
  userId: string
): Promise<Photo[]> {
  await validateEntityOwnership(entityType, entityId, userId);
  return photoRepository.findByEntity(entityType, entityId);
}

/**
 * Download a photo from Google Drive and return the raw buffer + MIME type.
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

  const driveService = await getDriveServiceForUser(userId);
  const buffer = await driveService.downloadFile(photo.driveFileId);
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
 * Delete a single photo: remove from Drive (best-effort), delete DB record,
 * and promote the next cover if the deleted photo was the cover.
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

  try {
    const driveService = await getDriveServiceForUser(userId);
    await driveService.deleteFile(photo.driveFileId);
  } catch (error) {
    logger.warn('Failed to delete photo from Google Drive', {
      photoId,
      driveFileId: photo.driveFileId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  await photoRepository.delete(photoId);

  if (wasCover) {
    const remaining = await photoRepository.findByEntity(entityType, entityId);
    if (remaining.length > 0) {
      await photoRepository.setCoverPhoto(entityType, entityId, remaining[0].id);
    }
  }
}

/**
 * Delete all photos for an entity (cascade). Removes Drive files best-effort,
 * then deletes all DB records in one shot.
 */
export async function deleteAllPhotosForEntity(
  entityType: string,
  entityId: string,
  userId: string
): Promise<void> {
  const photos = await photoRepository.findByEntity(entityType, entityId);
  if (photos.length === 0) return;

  const driveService = await getDriveServiceForUser(userId);

  for (const photo of photos) {
    try {
      await driveService.deleteFile(photo.driveFileId);
    } catch (error) {
      logger.warn('Failed to delete photo from Drive during cascade', {
        photoId: photo.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await photoRepository.deleteByEntity(entityType, entityId);
}
