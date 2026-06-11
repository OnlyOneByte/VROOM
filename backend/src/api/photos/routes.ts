import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { NotFoundError } from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import { buildPaginatedResponse } from '../../utils/pagination';
import { commonSchemas } from '../../utils/validation';
import { parseUploadedPhoto } from './helpers';
import {
  deletePhotoForEntity,
  getPhotoThumbnailForEntity,
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
// next auto-backup (#74): photos + photo_refs ARE in the backup payload (backup.ts), and the
// orchestrator skips when !hasChangesSinceLastSync — without this, a photo-only change between
// backups was silently excluded until some OTHER tracked mutation bumped the timestamp (the #42
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
      // The stored mimeType is the CLIENT-asserted upload type (never sniffed), so a file whose bytes
      // are HTML/script but declared image/png would otherwise be MIME-sniffed + executed by the
      // browser. nosniff forces the declared Content-Type (C133/#35; ARCC Secure-HTTP-Headers makes
      // this a MANDATORY header + Secure-File-Uploads "do not trust Content-Type / mitigate MIME sniff").
      'X-Content-Type-Options': 'nosniff',
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
