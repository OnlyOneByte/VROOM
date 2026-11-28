import { Hono } from 'hono';
import { z } from 'zod';
import { CONFIG } from '../../config';
import { NotFoundError } from '../../errors';
import { changeTracker, rateLimiter, requireAuth } from '../../middleware';
import { authorize, ownAccount } from '../../permissions/authorize';
import { buildPaginatedResponse } from '../../utils/pagination';
import { commonSchemas, zValidator } from '../../utils/validation';
import { withoutOwnerIds } from '../drivers/attribution';
import {
  fromPhotoEntity,
  parseUploadedPhoto,
  photoThumbnailResponse,
  withPhotoAuthor,
} from './helpers';
import {
  countOrphanedPhotos,
  deletePhotoForEntity,
  getPhotoServeMetadataForEntity,
  getPhotoThumbnailForEntity,
  ifNoneMatchSatisfies,
  listPhotosByEntityType,
  listPhotosForEntity,
  removeOrphanedPhotos,
  uploadPhotoForEntity,
} from './photo-service';

const routes = new Hono();

routes.use('*', requireAuth);
routes.use('*', changeTracker);

routes.get(
  '/',
  zValidator('query', z.object({ entityType: z.string().min(1).max(64) })),
  authorize(ownAccount),
  async (c) => {
    const { entityType } = c.req.valid('query');
    const user = c.get('user');
    const grouped = await listPhotosByEntityType(entityType, user.id);
    return c.json({ success: true, data: grouped });
  }
);

routes.get('/orphans', authorize(ownAccount), async (c) => {
  const user = c.get('user');
  const count = await countOrphanedPhotos(user.id);
  return c.json({ success: true, data: { count } });
});

routes.delete('/orphans', authorize(ownAccount), async (c) => {
  const user = c.get('user');
  const result = await removeOrphanedPhotos(user.id);
  return c.json({ success: true, data: result });
});

routes.get(
  '/:entityType/:entityId',
  zValidator('query', commonSchemas.pagination),
  authorize(fromPhotoEntity),
  async (c) => {
    const entityType = c.req.param('entityType');
    const entityId = c.req.param('entityId');
    if (!entityType || !entityId) throw new NotFoundError('Entity');

    const { limit, offset } = c.req.valid('query');
    const user = c.get('user');
    const result = await listPhotosForEntity(entityType, entityId, user.id, { limit, offset });
    const rows = result.data.map((photo) => withoutOwnerIds(c, photo));
    return c.json(buildPaginatedResponse(rows, result.totalCount, limit, offset));
  }
);

const photoUploadLimiter = rateLimiter({
  ...CONFIG.rateLimit.photoUpload,
  keyGenerator: (c) => `photoUpload:${c.get('user').id}`,
});

routes.post('/:entityType/:entityId', photoUploadLimiter, authorize(fromPhotoEntity), async (c) => {
  const entityType = c.req.param('entityType');
  const entityId = c.req.param('entityId');
  if (!entityType || !entityId) throw new NotFoundError('Entity');

  const user = c.get('user');
  const file = await parseUploadedPhoto(c);

  const photo = await uploadPhotoForEntity(entityType, entityId, user.id, file);
  return c.json({ success: true, data: withoutOwnerIds(c, photo) }, 201);
});

routes.get('/:entityType/:entityId/:photoId/thumbnail', authorize(fromPhotoEntity), async (c) => {
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

routes.delete(
  '/:entityType/:entityId/:photoId',
  authorize(withPhotoAuthor(fromPhotoEntity)),
  async (c) => {
    const entityType = c.req.param('entityType');
    const entityId = c.req.param('entityId');
    const photoId = c.req.param('photoId');
    if (!entityType || !entityId || !photoId) throw new NotFoundError('Photo');

    const user = c.get('user');
    await deletePhotoForEntity(entityType, entityId, photoId, user.id);
    return c.body(null, 204);
  }
);

export { routes };
