import { Hono } from 'hono';
import { AppError, NotFoundError } from '../../errors';
import { requireAuth } from '../../middleware';
import { settingsRepository } from '../settings/repository';
import { resolveVroomFolderName } from '../sync/folder-name';
import {
  deletePhotoForEntity,
  getPhotoThumbnailForEntity,
  listPhotosForEntity,
  uploadPhotoForEntity,
} from './photo-service';

/**
 * Generic photo routes for non-vehicle entity types (e.g., insurance_policy).
 * Mounted at /api/v1/photos/:entityType/:entityId
 */
const routes = new Hono();

routes.use('*', requireAuth);

// GET /photos/:entityType/:entityId — List photos for an entity
routes.get('/:entityType/:entityId', async (c) => {
  const entityType = c.req.param('entityType');
  const entityId = c.req.param('entityId');
  if (!entityType || !entityId) throw new NotFoundError('Entity');

  const user = c.get('user');
  const photos = await listPhotosForEntity(entityType, entityId, user.id);
  return c.json({ success: true, data: photos });
});

// POST /photos/:entityType/:entityId — Upload photo for an entity
routes.post('/:entityType/:entityId', async (c) => {
  const entityType = c.req.param('entityType');
  const entityId = c.req.param('entityId');
  if (!entityType || !entityId) throw new NotFoundError('Entity');

  const user = c.get('user');
  const body = await c.req.parseBody();
  const file = body.photo;

  if (!file || !(file instanceof File)) {
    throw new AppError('No photo file provided', 400);
  }

  const settings = await settingsRepository.getOrCreate(user.id);
  const folderName = resolveVroomFolderName(settings.googleDriveCustomFolderName, user.displayName);
  const photo = await uploadPhotoForEntity(entityType, entityId, user.id, folderName, file);
  return c.json({ success: true, data: photo }, 201);
});

// GET /photos/:entityType/:entityId/:photoId/thumbnail — Get photo thumbnail
routes.get('/:entityType/:entityId/:photoId/thumbnail', async (c) => {
  const entityType = c.req.param('entityType');
  const entityId = c.req.param('entityId');
  const photoId = c.req.param('photoId');
  if (!entityType || !entityId || !photoId) throw new NotFoundError('Photo');

  const user = c.get('user');
  const { buffer, mimeType } = await getPhotoThumbnailForEntity(
    entityType,
    entityId,
    photoId,
    user.id
  );

  return new Response(buffer, {
    headers: {
      'Content-Type': mimeType,
      'Cache-Control': 'private, max-age=3600',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  });
});

// DELETE /photos/:entityType/:entityId/:photoId — Delete a photo
routes.delete('/:entityType/:entityId/:photoId', async (c) => {
  const entityType = c.req.param('entityType');
  const entityId = c.req.param('entityId');
  const photoId = c.req.param('photoId');
  if (!entityType || !entityId || !photoId) throw new NotFoundError('Photo');

  const user = c.get('user');
  await deletePhotoForEntity(entityType, entityId, photoId, user.id);
  return c.body(null, 204);
});

export { routes };
