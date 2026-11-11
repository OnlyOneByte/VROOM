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

/**
 * Generic photo routes for non-vehicle entity types (e.g., insurance_policy).
 * Mounted at /api/v1/photos/:entityType/:entityId
 */
const routes = new Hono();

routes.use('*', requireAuth);
// Stamp lastDataChangeDate on a 2xx photo mutation (upload/delete) so the change re-triggers the
// next auto-backup: photos + photo_refs ARE in the backup payload (backup.ts), and the
// orchestrator skips when !hasChangesSinceLastSync — without this, a photo-only change between
// backups was silently excluded until some OTHER tracked mutation bumped the timestamp (the
// silent-backup-gap class). This was the lone mutating route module missing changeTracker.
routes.use('*', changeTracker);

// GET /photos?entityType=vehicle — Batch-list the user's photos of one entity
// type, grouped by entityId. Lets the dashboard fetch all vehicle photos in a
// single request instead of one request per vehicle (N+1).
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

// GET /photos/:entityType/:entityId — List photos for an entity
routes.get('/:entityType/:entityId', zValidator('query', commonSchemas.pagination), async (c) => {
  const entityType = c.req.param('entityType');
  const entityId = c.req.param('entityId');
  if (!entityType || !entityId) throw new NotFoundError('Entity');

  const { limit, offset } = c.req.valid('query');
  const user = c.get('user');
  const result = await listPhotosForEntity(entityType, entityId, user.id, { limit, offset });
  return c.json(buildPaginatedResponse(result.data, result.totalCount, limit, offset));
});

// POST /photos/:entityType/:entityId — Upload photo for an entity
routes.post('/:entityType/:entityId', async (c) => {
  const entityType = c.req.param('entityType');
  const entityId = c.req.param('entityId');
  if (!entityType || !entityId) throw new NotFoundError('Entity');

  const user = c.get('user');
  const file = await parseUploadedPhoto(c);

  const photo = await uploadPhotoForEntity(entityType, entityId, user.id, file);
  return c.json({ success: true, data: photo }, 201);
});

// GET /photos/:entityType/:entityId/:photoId/thumbnail — Serve a photo's bytes.
//
// "thumbnail" is historical: this serves the FULL-RESOLUTION original, because nothing in the stack
// resizes (see getPhotoThumbnailForEntity). A conditional GET is therefore the only thing bounding
// the repeat cost of a gallery of multi-megabyte receipts, so answer one BEFORE the provider
// round-trip: the validator comes from the photo row, so a revalidation costs two indexed SQLite
// reads instead of re-downloading the original twice over — once from the provider onto this box
// (the same home uplink a self-hoster's client is on), once out to the client. Resolving the row a
// second time on a cache MISS is the deliberate price.
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
    // Reuse the 200's headers so the 304 carries the same validator + caching policy (RFC 9110
    // §15.4.5 requires both, or the next request can no longer revalidate) and the two can't drift.
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
