import { and, eq, ne } from 'drizzle-orm';
import { Hono } from 'hono';
import { appContext, repos } from '../../app-context';
import { CONFIG } from '../../config';
import type { AsyncAppDatabase } from '../../db/async-sqlite';
import type { UserProvider } from '../../db/schema';
import { userProviders } from '../../db/schema';
import { AppError, ValidationError } from '../../errors';
import { concurrencyLimiter, rateLimiter, requireAuth } from '../../middleware';
import { authorize, ownAccount } from '../../permissions/authorize';
import { logger } from '../../utils/logger';
import { withoutIdleTimeout } from '../../utils/timeout';
import { decryptRefreshToken } from '../providers/domains/storage/registry';
import { parseExtraction } from '../providers/domains/vlm/prompt';
import { getVlmProvider } from '../providers/domains/vlm/registry';
import { resolveProvider } from '../providers/resolve';
import { GooglePhotosService } from '../providers/services/google-photos-service';
import {
  ReceiptScanStopped,
  type ScanStopReason,
  type StageDeps,
  stageReceiptDrafts,
} from './receipt-drafts-service';

const STOPPED_MESSAGES: Record<ScanStopReason, [string, number]> = {
  ai_key: ["The AI provider didn't accept its key. Check it in Settings, then try again.", 502],
  ai_rate_limit: [
    'The AI provider is limiting requests right now. Try again in a few minutes.',
    503,
  ],
  photos_access: [
    'Google Photos needs reconnecting. Reconnect it in Settings, then try again.',
    502,
  ],
};

const routes = new Hono();

routes.use('*', requireAuth);

async function findPhotosProvider(
  db: AsyncAppDatabase,
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

const receiptDraftsLimiter = rateLimiter({
  ...CONFIG.rateLimit.receiptDrafts,
  keyGenerator: (c) => `receiptDrafts:${c.get('user').id}`,
});
const draftsAtOnce = concurrencyLimiter({
  limit: 1,
  keyGenerator: (c) => `receipt-drafts:${c.get('user').id}`,
  message: 'Your receipts are already being read from Google Photos',
  status: 429,
});

routes.get(
  '/receipt-drafts',
  receiptDraftsLimiter,
  draftsAtOnce,
  authorize(ownAccount),
  async (c) => {
    const user = c.get('user');
    const db = appContext().asyncDb;

    const photosRow = await findPhotosProvider(db, user.id);
    if (!photosRow) {
      throw new ValidationError(
        'Connect Google Photos in Settings to import receipts from your VROOM photo album.'
      );
    }
    const vlmRow = await resolveProvider(user.id, 'ai.vision');

    const photosService = photosServiceBuilder(photosRow);
    const vlmProvider = await getVlmProvider(vlmRow);
    const deps: StageDeps = {
      listReceiptPhotos: (max) => photosService.listReceiptPhotos(max),
      downloadPhoto: (id) => photosService.download(id),
      freshUrl: (id) => photosService.getFreshUrl(id),
      parseImage: async (bytes, mimeType) =>
        parseExtraction(await vlmProvider.extractReceipt({ data: bytes, mimeType })),
      isAlreadyImported: async (photoId) =>
        (await repos().expenses.findByClientId(`photos:${photoId}`, user.id)) !== null,
    };

    try {
      const drafts = await withoutIdleTimeout(c, () => stageReceiptDrafts(deps));
      return c.json({ success: true, data: { drafts } });
    } catch (err) {
      if (err instanceof ReceiptScanStopped) {
        logger.warn('Photos receipt-draft stage stopped', { reason: err.reason });
        const [message, status] = STOPPED_MESSAGES[err.reason];
        throw new AppError(message, status);
      }
      const message = err instanceof Error ? err.message : 'Google Photos error';
      logger.warn('Photos receipt-draft stage failed', { error: message });
      throw new AppError(
        'Could not read your Google Photos receipts right now. Check the connection and try again.',
        502
      );
    }
  }
);

export { routes };
