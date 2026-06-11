import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { NotFoundError } from '../../errors';
import { buildPaginatedResponse } from '../../utils/pagination';
import { commonSchemas } from '../../utils/validation';
import { parseUploadedPhoto, photoThumbnailResponse } from '../photos/helpers';
import {
  deletePhotoForEntity,
  getPhotoThumbnailForEntity,
  listPhotosForEntity,
  setCoverPhotoForEntity,
  uploadPhotoForEntity,
} from '../photos/photo-service';

/**
 * Vehicle photo routes — thin Hono sub-router.
 * NOTE: This router does NOT apply requireAuth itself. It relies on the parent
 * vehicle routes (`vehicles/routes.ts`) applying `requireAuth` before mounting.
 */
const photoRoutes = new Hono();

// POST / — Upload photo
photoRoutes.post('/', async (c) => {
  const vehicleId = c.req.param('vehicleId');
  if (!vehicleId) throw new NotFoundError('Vehicle');

  const user = c.get('user');
  const file = await parseUploadedPhoto(c);

  const photo = await uploadPhotoForEntity('vehicle', vehicleId, user.id, file);
  return c.json({ success: true, data: photo }, 201);
});

// GET / — List photos
photoRoutes.get('/', zValidator('query', commonSchemas.pagination), async (c) => {
  const vehicleId = c.req.param('vehicleId');
  if (!vehicleId) throw new NotFoundError('Vehicle');

  const { limit, offset } = c.req.valid('query');
  const user = c.get('user');
  const result = await listPhotosForEntity('vehicle', vehicleId, user.id, { limit, offset });
  return c.json(buildPaginatedResponse(result.data, result.totalCount, limit, offset));
});

// GET /:photoId/thumbnail — Proxy thumbnail
photoRoutes.get('/:photoId/thumbnail', async (c) => {
  const vehicleId = c.req.param('vehicleId');
  const photoId = c.req.param('photoId');
  if (!vehicleId || !photoId) throw new NotFoundError('Photo');

  const user = c.get('user');
  const { buffer, mimeType } = await getPhotoThumbnailForEntity(
    'vehicle',
    vehicleId,
    photoId,
    user.id
  );

  return photoThumbnailResponse(buffer, mimeType);
});

// PUT /:photoId/cover — Set cover photo
photoRoutes.put('/:photoId/cover', async (c) => {
  const vehicleId = c.req.param('vehicleId');
  const photoId = c.req.param('photoId');
  if (!vehicleId || !photoId) throw new NotFoundError('Photo');

  const user = c.get('user');
  const photo = await setCoverPhotoForEntity('vehicle', vehicleId, photoId, user.id);
  return c.json({ success: true, data: photo });
});

// DELETE /:photoId — Delete photo
photoRoutes.delete('/:photoId', async (c) => {
  const vehicleId = c.req.param('vehicleId');
  const photoId = c.req.param('photoId');
  if (!vehicleId || !photoId) throw new NotFoundError('Photo');

  const user = c.get('user');
  await deletePhotoForEntity('vehicle', vehicleId, photoId, user.id);
  return c.body(null, 204);
});

export { photoRoutes };
