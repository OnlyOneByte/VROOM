import { CONFIG } from '../../config';
import type { PhotoRef } from '../../db/schema';
import { isSyncError, SyncErrorCode } from '../../errors';
import { extractErrorMessage } from '../../utils/error-handling';
import { logger } from '../../utils/logger';
import { OPERATION_TIMEOUTS, withTimeout } from '../../utils/timeout';
import { photoRefRepository } from '../photos/photo-ref-repository';
import { photoRepository } from '../photos/photo-repository';
import { storageProviderRegistry } from './domains/storage/registry';
import type { PhotoCategory, StorageProvider } from './domains/storage/storage-provider';
import { ENTITY_TO_CATEGORY } from './domains/storage/storage-provider';

// bun mock.module leaks across test files, so tests inject fakes through deps instead.
export interface SyncWorkerDeps {
  photoRefRepository: Pick<
    typeof photoRefRepository,
    'findPendingOrFailed' | 'findActiveByPhoto' | 'updateStatus'
  >;
  photoRepository: Pick<typeof photoRepository, 'findById'>;
  registry: Pick<
    typeof storageProviderRegistry,
    'getProviderInternal' | 'resolveProviderFolderPath'
  >;
}

const defaultDeps: SyncWorkerDeps = {
  photoRefRepository,
  photoRepository,
  registry: storageProviderRegistry,
};

let intervalId: ReturnType<typeof setInterval> | null = null;
let processingSince: number | null = null;

const BATCH_WATCHDOG_MS = 3 * OPERATION_TIMEOUTS.DOWNLOAD;

const IN_FLIGHT_TTL_MS = 2 * BATCH_WATCHDOG_MS;

const inFlightRefs = new Map<string, number>();

const MAX_IN_FLIGHT_ENTRIES = 500;

const BASE_BACKOFF_SECONDS = 30;

// Must match the retry bound in photoRefRepository.findPendingOrFailed.
export const MAX_RETRY_COUNT = 3;

function priorRetries(ref: PhotoRef): number {
  return ref.retryCount >= MAX_RETRY_COUNT ? 0 : ref.retryCount;
}

export function shouldSkipDueToBackoff(ref: PhotoRef, now: Date): boolean {
  if (ref.status !== 'failed') return false;

  const lastAttempt = ref.syncedAt ?? ref.createdAt;
  if (!lastAttempt) return false;

  const backoffMs = BASE_BACKOFF_SECONDS * 2 ** priorRetries(ref) * 1000;
  const elapsed = now.getTime() - lastAttempt.getTime();

  return elapsed < backoffMs;
}

function evictStaleInFlightRefs(nowMs: number): void {
  if (inFlightRefs.size > MAX_IN_FLIGHT_ENTRIES) {
    inFlightRefs.clear();
    return;
  }
  for (const [refId, since] of inFlightRefs) {
    if (nowMs - since >= IN_FLIGHT_TTL_MS) {
      inFlightRefs.delete(refId);
    }
  }
}

function shouldProcessRef(ref: PhotoRef, now: Date): boolean {
  if (inFlightRefs.has(ref.id)) {
    return false;
  }

  if (shouldSkipDueToBackoff(ref, now)) {
    logger.debug('Sync worker: skipping ref due to backoff', {
      refId: ref.id,
      retryCount: ref.retryCount,
    });
    return false;
  }

  return true;
}

function previousBatchBlocks(now: number): boolean {
  if (processingSince === null) return false;
  if (now - processingSince < BATCH_WATCHDOG_MS) return true;
  logger.warn('Sync worker: previous batch is still running past the watchdog, starting anyway', {
    runningForMs: now - processingSince,
  });
  return false;
}

function endBatch(startedAt: number): void {
  if (processingSince === startedAt) processingSince = null;
}

async function processRefs(
  pendingRefs: PhotoRef[],
  startedAt: number,
  now: Date,
  deps: SyncWorkerDeps
): Promise<void> {
  const providerCache = new Map<string, StorageProvider>();
  for (const ref of pendingRefs) {
    if (processingSince !== startedAt) break;
    if (!shouldProcessRef(ref, now)) continue;

    inFlightRefs.set(ref.id, Date.now());
    try {
      await processSingleRef(ref, providerCache, deps);
    } catch (error) {
      logger.warn('Sync worker: failed to process ref', {
        refId: ref.id,
        photoId: ref.photoId,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      inFlightRefs.delete(ref.id);
    }
  }
}

export async function processBatch(deps: SyncWorkerDeps = defaultDeps): Promise<void> {
  const startedAt = Date.now();
  if (previousBatchBlocks(startedAt)) return;
  processingSince = startedAt;

  try {
    const pendingRefs = await deps.photoRefRepository.findPendingOrFailed(
      CONFIG.syncWorker.batchSize
    );
    if (pendingRefs.length === 0) return;

    logger.debug(`Sync worker: processing ${pendingRefs.length} pending refs`);
    const nowMs = Date.now();
    const now = new Date(nowMs);
    evictStaleInFlightRefs(nowMs);

    await processRefs(pendingRefs, startedAt, now, deps);
  } catch (error) {
    logger.error('Sync worker: batch processing error', {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    endBatch(startedAt);
  }
}

async function getCachedProvider(
  providerId: string,
  cache: Map<string, StorageProvider>,
  registry: SyncWorkerDeps['registry']
): Promise<StorageProvider> {
  const cached = cache.get(providerId);
  if (cached) return cached;

  const provider = await registry.getProviderInternal(providerId);
  cache.set(providerId, provider);
  return provider;
}

// Every skipped ref must record a failure: findPendingOrFailed is ordered by created_at, so untouched rows starve newer ones.
async function recordUnsyncableRef(
  ref: PhotoRef,
  reason: string,
  deps: SyncWorkerDeps
): Promise<void> {
  const retryCount = priorRetries(ref) + 1;

  await deps.photoRefRepository.updateStatus(ref.id, {
    status: 'failed',
    errorMessage: reason,
    retryCount,
    syncedAt: new Date(),
  });

  logger.warn('Sync worker: nothing to sync this ref from, recorded a failure', {
    refId: ref.id,
    photoId: ref.photoId,
    retryCount,
    reason,
  });
}

async function processSingleRef(
  ref: PhotoRef,
  providerCache: Map<string, StorageProvider>,
  deps: SyncWorkerDeps
): Promise<void> {
  const sourceRef = await deps.photoRefRepository.findActiveByPhoto(ref.photoId);
  if (!sourceRef) {
    await recordUnsyncableRef(ref, 'No active source copy available for this photo', deps);
    return;
  }

  const photo = await deps.photoRepository.findById(ref.photoId);
  if (!photo) {
    await recordUnsyncableRef(ref, 'Photo record no longer exists', deps);
    return;
  }

  try {
    const sourceProvider = await getCachedProvider(
      sourceRef.providerId,
      providerCache,
      deps.registry
    );
    const buffer = await withTimeout(
      sourceProvider.download({
        providerType: sourceProvider.type,
        externalId: sourceRef.storageRef,
      }),
      OPERATION_TIMEOUTS.DOWNLOAD,
      'Photo sync download'
    );

    const category = ENTITY_TO_CATEGORY[photo.entityType] as PhotoCategory | undefined;
    let pathHint = '';

    if (category) {
      try {
        pathHint = await deps.registry.resolveProviderFolderPath(ref.providerId, category);
      } catch (error) {
        logger.warn('Sync worker: folder path lookup failed, uploading without a path hint', {
          refId: ref.id,
          photoId: ref.photoId,
          providerId: ref.providerId,
          category,
          error: extractErrorMessage(error),
        });
      }
    }

    const targetProvider = await getCachedProvider(ref.providerId, providerCache, deps.registry);
    const uploadResult = await withTimeout(
      targetProvider.upload({
        fileName: photo.fileName,
        buffer,
        mimeType: photo.mimeType,
        entityType: photo.entityType,
        entityId: photo.entityId,
        pathHint,
      }),
      OPERATION_TIMEOUTS.DOWNLOAD,
      'Photo sync upload'
    );

    try {
      await deps.photoRefRepository.updateStatus(ref.id, {
        status: 'active',
        storageRef: uploadResult.externalId,
        externalUrl: uploadResult.externalUrl,
        syncedAt: new Date(),
      });
    } catch (error) {
      await targetProvider.delete(uploadResult).catch((cleanupError) => {
        logger.warn('Sync worker: failed to clean up orphaned upload after a status save error', {
          refId: ref.id,
          providerId: ref.providerId,
          storageRef: uploadResult.externalId,
          error: extractErrorMessage(cleanupError),
        });
      });
      throw error;
    }

    logger.debug('Sync worker: ref synced successfully', {
      refId: ref.id,
      photoId: ref.photoId,
      targetProviderId: ref.providerId,
    });
  } catch (error) {
    const errorMessage = extractErrorMessage(error);

    // AUTH_INVALID is reserved for VROOM session expiry; provider auth errors must not reuse it.
    const isTerminalAuth =
      isSyncError(error) &&
      (error.code === SyncErrorCode.AUTH_INVALID || error.code === SyncErrorCode.PERMISSION_DENIED);
    const retryCount = isTerminalAuth ? MAX_RETRY_COUNT : priorRetries(ref) + 1;

    await deps.photoRefRepository.updateStatus(ref.id, {
      status: 'failed',
      errorMessage: isTerminalAuth ? `Reconnect required: ${errorMessage}` : errorMessage,
      retryCount,
      syncedAt: new Date(),
    });

    logger.warn(
      isTerminalAuth
        ? 'Sync worker: ref sync failed with a terminal auth error, will NOT retry'
        : 'Sync worker: ref sync failed, will retry',
      {
        refId: ref.id,
        photoId: ref.photoId,
        retryCount,
        error: errorMessage,
      }
    );
  }
}

export function startSyncWorker(): void {
  if (!CONFIG.syncWorker.enabled) {
    logger.info('Sync worker disabled (test environment)');
    return;
  }

  if (intervalId) {
    logger.warn('Sync worker already running');
    return;
  }

  intervalId = setInterval(() => {
    processBatch().catch((error) => {
      logger.error('Sync worker: unhandled error in poll cycle', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, CONFIG.syncWorker.pollIntervalMs);

  logger.info(`Sync worker started (poll every ${CONFIG.syncWorker.pollIntervalMs}ms)`);
}

export function stopSyncWorker(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('Sync worker stopped');
  }
}
