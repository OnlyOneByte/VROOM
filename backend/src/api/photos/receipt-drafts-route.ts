import { and, eq, ne } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb } from '../../db/connection';
import type { UserProvider } from '../../db/schema';
import { userProviders } from '../../db/schema';
import { AppError, ValidationError } from '../../errors';
import { requireAuth } from '../../middleware';
import { logger } from '../../utils/logger';
import { expenseRepository } from '../expenses/repository';
import { decryptRefreshToken } from '../providers/domains/storage/registry';
import { parseExtraction } from '../providers/domains/vlm/prompt';
import { getVlmProvider } from '../providers/domains/vlm/registry';
import { resolveProvider } from '../providers/resolve';
import { GooglePhotosService } from '../providers/services/google-photos-service';
import { type StageDeps, stageReceiptDrafts } from './receipt-drafts-service';

const routes = new Hono();

routes.use('*', requireAuth);

async function findPhotosProvider(
  db: ReturnType<typeof getDb>,
  userId: string
): Promise<UserProvider | null> {
  const rows = await db
    .select()
    .from(userProviders)
    .where(
      and(
        eq(userProviders.userId, userId),
        eq(userProviders.domain, 'storage'),
        eq(userProviders.providerType, 'google-photos'),
        ne(userProviders.status, 'disabled')
      )
    );
  return rows[0] ?? null;
}

function buildRealPhotosService(row: UserProvider): GooglePhotosService {
  const refreshToken = decryptRefreshToken(row);
  const config = (row.config ?? {}) as Record<string, unknown>;
  const albumId = typeof config.albumId === 'string' ? config.albumId : undefined;
  return new GooglePhotosService(refreshToken, undefined, albumId);
}

type PhotosServiceBuilder = (row: UserProvider) => GooglePhotosService;
let photosServiceBuilder: PhotosServiceBuilder = buildRealPhotosService;

export function setPhotosServiceBuilderForTest(builder: PhotosServiceBuilder | null): void {
  photosServiceBuilder = builder ?? buildRealPhotosService;
}

routes.get('/receipt-drafts', async (c) => {
  const user = c.get('user');
  const db = getDb();

  const photosRow = await findPhotosProvider(db, user.id);
  if (!photosRow) {
    throw new ValidationError(
      'Connect Google Photos in Settings to import receipts from your VROOM photo album.'
    );
  }
  const vlmRow = await resolveProvider(user.id, 'ai.vision');

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
