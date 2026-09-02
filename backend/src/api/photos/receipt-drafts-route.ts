/**
 * Photos → auto-expense STAGE endpoint (photos-auto-expense T2) — `GET /api/v1/photos/receipt-drafts`.
 *
 * Resolves the user's enabled google-photos + vlm providers, walks the receipts VROOM uploaded to its
 * own Photos album, parses each through the user's VLM (the shipped fail-closed seam), filters out
 * already-imported photos, and returns a LIST of drafts — PERSISTING NOTHING. The FE reviews + confirms
 * each via the UNCHANGED POST /expenses (clientId = photos:<mediaId>), so a re-run is idempotent.
 *
 * The orchestration itself is the pure {@link stageReceiptDrafts} (DI-tested with fakes). This route is
 * the thin wiring: resolve rows → build the real seams → map failures honestly (no provider → 400; a
 * Photos transport / read-not-enabled failure → 502, never a faked empty result — #43/#44/#144).
 *
 * The live `mediaItems:search` read (T1) + its `photoslibrary.readonly.appcreateddata` OAuth scope (T5)
 * are ARCC-cleared (design §7) and now LIVE: the real PhotosClient implements searchMediaItems and the
 * connect flow requests the read scope. A Photos transport failure surfaces as a 502 (honest, never a
 * faked empty); the HTTP guard exercises this path against the in-memory fake (zero-network).
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

/** Fetch the user's single enabled provider in a domain, or null. */
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

/** Build a GooglePhotosService from a google-photos provider row (decrypt refreshToken + cached album). */
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

/**
 * How the route builds the Photos service from a provider row. Defaults to the real OAuth2-authed
 * service; the HTTP-harness test overrides it with a fake-PhotosClient-backed service so the live read
 * path is exercised ZERO-network (the live `mediaItems:search` itself needs a real Google token, which
 * the in-process suite cannot mint). This is a USED DI seam — NOT the dead-setter anti-pattern (C464).
 */
type PhotosServiceBuilder = (row: UserProvider) => GooglePhotosService;
let photosServiceBuilder: PhotosServiceBuilder = buildRealPhotosService;

/** Test seam: override the Photos-service builder (pass null to restore the real one). */
export function setPhotosServiceBuilderForTest(builder: PhotosServiceBuilder | null): void {
  photosServiceBuilder = builder ?? buildRealPhotosService;
}

/**
 * GET /api/v1/photos/receipt-drafts — stage the un-imported receipt photos into expense drafts.
 * PERSISTS NOTHING. 400 if either provider is missing; 502 on a Photos transport / read-not-enabled
 * failure (honest, never a faked empty result).
 */
routes.get('/receipt-drafts', async (c) => {
  const user = c.get('user');
  const db = getDb();

  // 1) Resolve both providers — either missing → an actionable 400 (link to Settings).
  const photosRow = await findEnabledProvider(db, user.id, 'storage');
  if (!photosRow || photosRow.providerType !== 'google-photos') {
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

  // 2) Wire the real seams into the pure orchestration (the builder is overridable in tests).
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

  // 3) Run the sweep. A Photos LIST/transport failure (incl. the read-not-enabled signal) → 502.
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
