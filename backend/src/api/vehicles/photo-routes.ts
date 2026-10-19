import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { NotFoundError } from '../../errors';
import { buildPaginatedResponse } from '../../utils/pagination';
import { commonSchemas } from '../../utils/validation';
import { parseUploadedPhoto, photoThumbnailResponse } from '../photos/helpers';
import {
  deletePhotoForEntity,
  getPhotoServeMetadataForEntity,
  getPhotoThumbnailForEntity,
  ifNoneMatchSatisfies,
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

// GET /:photoId/thumbnail — Serve a vehicle photo's bytes.
//
// "thumbnail" is historical: this serves the FULL-RESOLUTION original, because nothing in the stack
// resizes. This is the route the vehicle header avatar, the dashboard carousel and the photo
// carousel all use, so a conditional GET is what bounds the repeat cost: answer one BEFORE the
// provider round-trip, since the validator comes from the photo row. Mirrors the generic
// /photos/:entityType/... handler — keep the two in step.
photoRoutes.get('/:photoId/thumbnail', async (c) => {
  const vehicleId = c.req.param('vehicleId');
  const photoId = c.req.param('photoId');
  if (!vehicleId || !photoId) throw new NotFoundError('Photo');

  const user = c.get('user');
  const { etag, mimeType: storedMimeType } = await getPhotoServeMetadataForEntity(
    'vehicle',
    vehicleId,
    photoId,
    user.id
  );

  if (ifNoneMatchSatisfies(c.req.header('if-none-match'), etag)) {
    // Reuse the 200's headers so the 304 carries the same validator + caching policy (RFC 9110
    // §15.4.5 requires both, or the next request can no longer revalidate).
    const headers = photoThumbnailResponse(Buffer.alloc(0), storedMimeType).headers;
    headers.set('ETag', etag);
    return new Response(null, { status: 304, headers });
  }

  const { buffer, mimeType } = await getPhotoThumbnailForEntity(
    'vehicle',
    vehicleId,
    photoId,
    user.id
  );

  const response = photoThumbnailResponse(buffer, mimeType);
  response.headers.set('ETag', etag);
  return response;
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
