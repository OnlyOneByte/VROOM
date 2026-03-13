/**
 * Background sync worker — polls photo_refs with pending/failed status
 * and syncs them to their target providers by downloading from any active ref.
 *
 * Runs in-process via setInterval. No external job queue needed.
 *
 * Features:
 * - Exponential backoff: failed refs wait 30 * 2^retryCount seconds before retry
 * - Retry count increment on failure (max 3 attempts via findPendingOrFailed query)
 * - Proper photo metadata lookup for uploads (fileName, mimeType, entityType, entityId)
 * - Folder path resolution from storage_config via the registry
 */

import { CONFIG } from '../../config';
import type { PhotoRef } from '../../db/schema';
import { logger } from '../../utils/logger';
import { photoRefRepository } from '../photos/photo-ref-repository';
import { photoRepository } from '../photos/photo-repository';
import { storageProviderRegistry } from './domains/storage/registry';
import type { PhotoCategory, StorageProvider } from './domains/storage/storage-provider';
import { ENTITY_TO_CATEGORY } from './domains/storage/storage-provider';

let intervalId: ReturnType<typeof setInterval> | null = null;
let isProcessing = false;

/** Track ref IDs currently being processed to prevent duplicate work across overlapping batches. */
const inFlightRefs = new Map<string, number>();

/** Max time (ms) a ref can stay in-flight before being considered stale and evicted. */
const IN_FLIGHT_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Safety cap — if the map somehow grows beyond this, clear it entirely. */
const MAX_IN_FLIGHT_ENTRIES = 500;

/** Base backoff interval in seconds. Actual delay = BASE_BACKOFF_SECONDS * 2^retryCount */
const BASE_BACKOFF_SECONDS = 30;

/**
 * Check whether a failed ref should be skipped due to exponential backoff.
 * Returns true if not enough time has passed since the last attempt.
 */
export function shouldSkipDueToBackoff(ref: PhotoRef, now: Date): boolean {
  if (ref.status !== 'failed') return false;

  // Use syncedAt as last attempt time (updated on every attempt).
  // Fall back to createdAt for refs that have never been attempted.
  const lastAttempt = ref.syncedAt ?? ref.createdAt;
  if (!lastAttempt) return false;

  const backoffMs = BASE_BACKOFF_SECONDS * 2 ** ref.retryCount * 1000;
  const elapsed = now.getTime() - lastAttempt.getTime();

  return elapsed < backoffMs;
}

/**
 * Evict all stale entries from the in-flight tracking map.
 * Called at the start of each batch to prevent unbounded growth.
 */
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

/**
 * Determine whether a ref should be processed in this batch.
 * Returns false if the ref is already in-flight or still in backoff.
 */
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

/**
 * Process a single batch of pending/failed photo refs.
 * Downloads from any active ref for the same photo, uploads to the target provider.
 * Caches provider instances within the batch to avoid repeated DB lookups + decryption.
 */
export async function processBatch(): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const pendingRefs = await photoRefRepository.findPendingOrFailed(CONFIG.syncWorker.batchSize);
    if (pendingRefs.length === 0) return;

    logger.debug(`Sync worker: processing ${pendingRefs.length} pending refs`);
    const now = new Date();
    const nowMs = now.getTime();
    const providerCache = new Map<string, StorageProvider>();

    evictStaleInFlightRefs(nowMs);

    for (const ref of pendingRefs) {
      if (!shouldProcessRef(ref, now)) continue;

      inFlightRefs.set(ref.id, nowMs);
      try {
        await processSingleRef(ref, providerCache);
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
  } catch (error) {
    logger.error('Sync worker: batch processing error', {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    isProcessing = false;
  }
}

/**
 * Resolve a provider from cache or fetch via getProviderInternal (no auth check).
 */
async function getCachedProvider(
  providerId: string,
  cache: Map<string, StorageProvider>
): Promise<StorageProvider> {
  const cached = cache.get(providerId);
  if (cached) return cached;

  const provider = await storageProviderRegistry.getProviderInternal(providerId);
  cache.set(providerId, provider);
  return provider;
}

/**
 * Process a single pending/failed photo ref.
 * Looks up photo metadata, downloads from an active source, and uploads to the target.
 */
async function processSingleRef(
  ref: PhotoRef,
  providerCache: Map<string, StorageProvider>
): Promise<void> {
  // Find an active ref for the same photo to download from
  const sourceRef = await photoRefRepository.findActiveByPhoto(ref.photoId);
  if (!sourceRef) {
    logger.debug('Sync worker: no active source ref for photo, skipping', {
      refId: ref.id,
      photoId: ref.photoId,
    });
    return;
  }

  // Look up photo metadata for proper upload params
  const photo = await photoRepository.findById(ref.photoId);
  if (!photo) {
    logger.debug('Sync worker: photo record not found, skipping', {
      refId: ref.id,
      photoId: ref.photoId,
    });
    return;
  }

  try {
    // Download from source provider
    const sourceProvider = await getCachedProvider(sourceRef.providerId, providerCache);
    const buffer = await sourceProvider.download({
      providerType: sourceProvider.type,
      externalId: sourceRef.storageRef,
    });

    // Resolve target provider and folder path from storage_config
    const category = ENTITY_TO_CATEGORY[photo.entityType] as PhotoCategory | undefined;
    let pathHint = '';

    if (category) {
      try {
        pathHint = await storageProviderRegistry.resolveProviderFolderPath(
          ref.providerId,
          category
        );
      } catch {
        // If path resolution fails, continue with empty pathHint
      }
    }

    // Upload to target provider with proper metadata
    const targetProvider = await getCachedProvider(ref.providerId, providerCache);
    const uploadResult = await targetProvider.upload({
      fileName: photo.fileName,
      buffer,
      mimeType: photo.mimeType,
      entityType: photo.entityType,
      entityId: photo.entityId,
      pathHint,
    });

    // Update ref to active with the new storage ref and sync timestamp
    await photoRefRepository.updateStatus(ref.id, {
      status: 'active',
      storageRef: uploadResult.externalId,
      externalUrl: uploadResult.externalUrl,
      syncedAt: new Date(),
    });

    logger.debug('Sync worker: ref synced successfully', {
      refId: ref.id,
      photoId: ref.photoId,
      targetProviderId: ref.providerId,
    });
  } catch (error) {
    // On failure: increment retry_count, set errorMessage, update syncedAt for backoff tracking
    const errorMessage = error instanceof Error ? error.message : String(error);

    await photoRefRepository.updateStatus(ref.id, {
      status: 'failed',
      errorMessage,
      retryCount: ref.retryCount + 1,
      syncedAt: new Date(),
    });

    logger.warn('Sync worker: ref sync failed, will retry', {
      refId: ref.id,
      photoId: ref.photoId,
      retryCount: ref.retryCount + 1,
      error: errorMessage,
    });
  }
}

/**
 * Start the background sync worker. Polls at the configured interval.
 * Guarded by CONFIG.syncWorker.enabled — no-op in test environment.
 */
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

/**
 * Stop the background sync worker. Safe to call multiple times.
 */
export function stopSyncWorker(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('Sync worker stopped');
  }
}
