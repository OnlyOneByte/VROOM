import { Hono } from 'hono';
import { z } from 'zod';
import { NotFoundError } from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import { buildPaginatedResponse } from '../../utils/pagination';
import { commonSchemas, zValidator } from '../../utils/validation';
import { parseUploadedPhoto, photoThumbnailResponse } from './helpers';
import {
  deletePhotoForEntity,
  getPhotoServeMetadataForEntity,
  getPhotoThumbnailForEntity,
  ifNoneMatchSatisfies,
  listPhotosByEntityType,
  listPhotosForEntity,
  uploadPhotoForEntity,
} from './photo-service';

const routes = new Hono();

routes.use('*', requireAuth);
routes.use('*', changeTracker);

routes.get(
  '/',
  zValidator('query', z.object({ entityType: z.string().min(1).max(64) })),
  async (c) => {
    const { entityType } = c.req.valid('query');
    const user = c.get('user');
    const grouped = await listPhotosByEntityType(entityType, user.id);
    return c.json({ success: true, data: grouped });
  }
);

routes.get('/:entityType/:entityId', zValidator('query', commonSchemas.pagination), async (c) => {
  const entityType = c.req.param('entityType');
  const entityId = c.req.param('entityId');
  if (!entityType || !entityId) throw new NotFoundError('Entity');

  const { limit, offset } = c.req.valid('query');
  const user = c.get('user');
  const result = await listPhotosForEntity(entityType, entityId, user.id, { limit, offset });
  return c.json(buildPaginatedResponse(result.data, result.totalCount, limit, offset));
});

routes.post('/:entityType/:entityId', async (c) => {
  const entityType = c.req.param('entityType');
  const entityId = c.req.param('entityId');
  if (!entityType || !entityId) throw new NotFoundError('Entity');

  const user = c.get('user');
  const file = await parseUploadedPhoto(c);

  const photo = await uploadPhotoForEntity(entityType, entityId, user.id, file);
  return c.json({ success: true, data: photo }, 201);
});

routes.get('/:entityType/:entityId/:photoId/thumbnail', async (c) => {
  const entityType = c.req.param('entityType');
  const entityId = c.req.param('entityId');
  const photoId = c.req.param('photoId');
  if (!entityType || !entityId || !photoId) throw new NotFoundError('Photo');

  const user = c.get('user');
  const { etag, mimeType: storedMimeType } = await getPhotoServeMetadataForEntity(
    entityType,
    entityId,
    photoId,
    user.id
  );

  if (ifNoneMatchSatisfies(c.req.header('if-none-match'), etag)) {
    // A 304 must repeat the validator and caching headers (RFC 9110 section 15.4.5).
    const headers = photoThumbnailResponse(Buffer.alloc(0), storedMimeType).headers;
    headers.set('ETag', etag);
    return new Response(null, { status: 304, headers });
  }

  const { buffer, mimeType } = await getPhotoThumbnailForEntity(
    entityType,
    entityId,
    photoId,
    user.id
  );

  const response = photoThumbnailResponse(buffer, mimeType);
  response.headers.set('ETag', etag);
  return response;
});

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
