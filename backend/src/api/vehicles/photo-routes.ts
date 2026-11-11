import { Hono } from 'hono';
import { NotFoundError } from '../../errors';
import { buildPaginatedResponse } from '../../utils/pagination';
import { commonSchemas, zValidator } from '../../utils/validation';
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

// Auth is applied by the parent vehicles router, not here.
const photoRoutes = new Hono();

photoRoutes.post('/', async (c) => {
  const vehicleId = c.req.param('vehicleId');
  if (!vehicleId) throw new NotFoundError('Vehicle');

  const user = c.get('user');
  const file = await parseUploadedPhoto(c);

  const photo = await uploadPhotoForEntity('vehicle', vehicleId, user.id, file);
  return c.json({ success: true, data: photo }, 201);
});

photoRoutes.get('/', zValidator('query', commonSchemas.pagination), async (c) => {
  const vehicleId = c.req.param('vehicleId');
  if (!vehicleId) throw new NotFoundError('Vehicle');

  const { limit, offset } = c.req.valid('query');
  const user = c.get('user');
  const result = await listPhotosForEntity('vehicle', vehicleId, user.id, { limit, offset });
  return c.json(buildPaginatedResponse(result.data, result.totalCount, limit, offset));
});

// Serves the full-resolution original; nothing resizes. Conditional GETs are answered before the
// provider round-trip, since the ETag comes from the photo row. Keep in step with the generic
// /photos/:entityType thumbnail handler.
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
    // A 304 must carry the same validator and caching headers as the 200 (RFC 9110 §15.4.5).
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

photoRoutes.put('/:photoId/cover', async (c) => {
  const vehicleId = c.req.param('vehicleId');
  const photoId = c.req.param('photoId');
  if (!vehicleId || !photoId) throw new NotFoundError('Photo');

  const user = c.get('user');
  const photo = await setCoverPhotoForEntity('vehicle', vehicleId, photoId, user.id);
  return c.json({ success: true, data: photo });
});

photoRoutes.delete('/:photoId', async (c) => {
  const vehicleId = c.req.param('vehicleId');
  const photoId = c.req.param('photoId');
  if (!vehicleId || !photoId) throw new NotFoundError('Photo');

  const user = c.get('user');
  await deletePhotoForEntity('vehicle', vehicleId, photoId, user.id);
  return c.body(null, 204);
});

export { photoRoutes };
