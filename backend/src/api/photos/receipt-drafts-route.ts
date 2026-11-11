/**
 * GET /api/v1/photos/receipt-drafts. Stages receipt photos from the app's Google Photos album as
 * expense drafts. Persists nothing: the client confirms each draft through POST /expenses with
 * clientId `photos:<mediaId>`, which makes re-runs idempotent.
 */

import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb } from '../../db/connection';
import type { UserProvider } from '../../db/schema';
import { userProviders } from '../../db/schema';
import { AppError, ValidationError } from '../../errors';
import { requireAuth } from '../../middleware';
import { decrypt } from '../../utils/encryption';
import { logger } from '../../utils/logger';
import { expenseRepository } from '../expenses/repository';
import { parseExtraction } from '../providers/domains/vlm/prompt';
import { getVlmProvider } from '../providers/domains/vlm/registry';
import { GooglePhotosService } from '../providers/services/google-photos-service';
import { type StageDeps, stageReceiptDrafts } from './receipt-drafts-service';

const routes = new Hono();

routes.use('*', requireAuth);

async function findEnabledProvider(
  db: ReturnType<typeof getDb>,
  userId: string,
  domain: string
): Promise<UserProvider | null> {
  const rows = await db
    .select()
    .from(userProviders)
    .where(
      and(
        eq(userProviders.userId, userId),
        eq(userProviders.domain, domain),
        eq(userProviders.status, 'active')
      )
    );
  return rows[0] ?? null;
}

function buildRealPhotosService(row: UserProvider): GooglePhotosService {
  const credentials = JSON.parse(decrypt(row.credentials)) as Record<string, unknown>;
  const refreshToken = credentials.refreshToken;
  if (typeof refreshToken !== 'string') {
    throw new ValidationError('Google Photos provider is missing its credentials');
  }
  const config = (row.config ?? {}) as Record<string, unknown>;
  const albumId = typeof config.albumId === 'string' ? config.albumId : undefined;
  return new GooglePhotosService(refreshToken, undefined, albumId);
}

type PhotosServiceBuilder = (row: UserProvider) => GooglePhotosService;
let photosServiceBuilder: PhotosServiceBuilder = buildRealPhotosService;

/** Test seam: pass null to restore the real builder. */
export function setPhotosServiceBuilderForTest(builder: PhotosServiceBuilder | null): void {
  photosServiceBuilder = builder ?? buildRealPhotosService;
}

routes.get('/receipt-drafts', async (c) => {
  const user = c.get('user');
  const db = getDb();

  const photosRow = await findEnabledProvider(db, user.id, 'storage');
  if (photosRow?.providerType !== 'google-photos') {
    throw new ValidationError(
      'Connect Google Photos in Settings to import receipts from your VROOM photo album.'
    );
  }
  const vlmRow = await findEnabledProvider(db, user.id, 'vlm');
  if (!vlmRow) {
    throw new ValidationError(
      'No receipt-parsing (VLM) provider is configured. Add one in Settings to import receipts.'
    );
  }

  const photosService = photosServiceBuilder(photosRow);
  const vlmProvider = getVlmProvider(vlmRow);
  const deps: StageDeps = {
    listReceiptPhotos: (max) => photosService.listReceiptPhotos(max),
    downloadPhoto: (id) => photosService.download(id),
    freshUrl: (id) => photosService.getFreshUrl(id),
    parseImage: async (bytes, mimeType) =>
      parseExtraction(await vlmProvider.extractReceipt({ data: bytes, mimeType })),
    isAlreadyImported: async (photoId) =>
      (await expenseRepository.findByClientId(`photos:${photoId}`, user.id)) !== null,
  };

  // A Photos read failure is reported as 502 rather than an empty list.
  try {
    const drafts = await stageReceiptDrafts(deps);
    return c.json({ success: true, data: { drafts } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Google Photos error';
    logger.warn('Photos receipt-draft stage failed', { error: message });
    throw new AppError(
      'Could not read your Google Photos receipts right now. Check the connection and try again.',
      502
    );
  }
});

export { routes };
