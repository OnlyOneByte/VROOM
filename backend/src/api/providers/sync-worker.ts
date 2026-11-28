import { type AppContext, repos } from '../../app-context';
import { CONFIG } from '../../config';
import type { PhotoRef } from '../../db/schema';
import { isSyncError, SyncErrorCode } from '../../errors';
import { extractErrorMessage } from '../../utils/error-handling';
import { logger } from '../../utils/logger';
import { OPERATION_TIMEOUTS, withTimeout } from '../../utils/timeout';
import { storageProviderRegistry } from './domains/storage/registry';
import type { PhotoCategory, StorageProvider } from './domains/storage/storage-provider';
import { ENTITY_TO_CATEGORY } from './domains/storage/storage-provider';
import {
  type HealthResult,
  healthCodeOf,
  healthFailure,
  recordProviderHealth,
} from './provider-status';

// bun mock.module leaks across test files, so tests inject fakes through deps instead.
export interface SyncWorkerDeps {
  photoRefRepository: Pick<
    AppContext['repos']['photoRefs'],
    'findPendingOrFailed' | 'findActiveByPhoto' | 'updateStatus'
  >;
  photoRepository: Pick<AppContext['repos']['photos'], 'findById'>;
  registry: Pick<typeof storageProviderRegistry, 'getProvider' | 'resolveProviderFolderPath'>;
}

function defaultDeps(): SyncWorkerDeps {
  return {
    photoRefRepository: repos().photoRefs,
    photoRepository: repos().photos,
    registry: storageProviderRegistry,
  };
}

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
  const lanes = new Map<string, PhotoRef[]>();
  for (const ref of pendingRefs) {
    lanes.set(ref.providerId, [...(lanes.get(ref.providerId) ?? []), ref]);
  }
  await Promise.all(
    [...lanes.values()].map((lane) => processLane(lane, startedAt, now, providerCache, deps))
  );
}

async function processLane(
  lane: PhotoRef[],
  startedAt: number,
  now: Date,
  providerCache: Map<string, StorageProvider>,
  deps: SyncWorkerDeps
): Promise<void> {
  for (const ref of lane) {
    if (processingSince !== startedAt) break;
    if (!shouldProcessRef(ref, now)) continue;

    inFlightRefs.set(ref.id, Date.now());
    try {
      const outcome = await processSingleRef(ref, providerCache, deps);
      if (outcome === 'unreachable') break;
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

export async function processBatch(deps: SyncWorkerDeps = defaultDeps()): Promise<void> {
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
  ownerId: string,
  cache: Map<string, StorageProvider>,
  registry: SyncWorkerDeps['registry']
): Promise<StorageProvider> {
  const key = `${ownerId}:${providerId}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const provider = await registry.getProvider(providerId, ownerId);
  cache.set(key, provider);
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

function noteHealth(providerId: string, result: HealthResult, synced = false): Promise<void> {
  return recordProviderHealth(providerId, result, { synced }).catch((saveError) => {
    logger.warn('Sync worker: could not record provider health', {
      providerId,
      error: extractErrorMessage(saveError),
    });
  });
}

async function withHealth<T>(providerId: string, work: Promise<T>, synced = false): Promise<T> {
  try {
    const result = await work;
    await noteHealth(providerId, { ok: true, message: 'Connected' }, synced);
    return result;
  } catch (error) {
    await noteHealth(providerId, healthFailure(healthCodeOf(error)));
    throw error;
  }
}

async function processSingleRef(
  ref: PhotoRef,
  providerCache: Map<string, StorageProvider>,
  deps: SyncWorkerDeps
): Promise<'unreachable' | undefined> {
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
      photo.userId,
      providerCache,
      deps.registry
    );
    const buffer = await withHealth(
      sourceRef.providerId,
      withTimeout(
        sourceProvider.download({
          providerType: sourceProvider.type,
          externalId: sourceRef.storageRef,
        }),
        OPERATION_TIMEOUTS.DOWNLOAD,
        'Photo sync download'
      )
    );

    const category = ENTITY_TO_CATEGORY[photo.entityType] as PhotoCategory | undefined;
    let pathHint = '';

    if (category) {
      try {
        pathHint = await deps.registry.resolveProviderFolderPath(
          ref.providerId,
          photo.userId,
          category
        );
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

    const targetProvider = await getCachedProvider(
      ref.providerId,
      photo.userId,
      providerCache,
      deps.registry
    );
    const uploadResult = await withHealth(
      ref.providerId,
      withTimeout(
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
      ),
      true
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
    return recordSyncFailure(ref, error, deps);
  }
}

async function recordSyncFailure(
  ref: PhotoRef,
  error: unknown,
  deps: SyncWorkerDeps
): Promise<'unreachable' | undefined> {
  const errorMessage = extractErrorMessage(error);

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
  return healthCodeOf(error) === 'unreachable' ? 'unreachable' : undefined;
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
