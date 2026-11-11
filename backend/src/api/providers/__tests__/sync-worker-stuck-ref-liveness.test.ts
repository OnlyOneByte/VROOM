/**
 * Guard: a photo_ref the worker cannot sync must be ADVANCED, never silently re-polled.
 *
 * A photo with no `active` copy to download from is reachable today: deleting a storage provider
 * drops that provider's refs, including the only `active` one, while the pending backup refs on
 * other providers survive. If `processSingleRef` returns without writing anything for such a ref,
 * `findPendingOrFailed` — `ORDER BY created_at ASC LIMIT batchSize` — hands back the identical row
 * every 30s forever. Those rows are by construction the oldest, so once batchSize of them exist
 * they own the whole batch and photo fan-out stops for every newer photo, with nothing above debug
 * in the logs.
 *
 * The tests below drive the REAL `processBatch` against an in-memory store that reproduces the
 * query's ordering, limit and `retryCount < MAX_RETRY_COUNT` bound, so they fail on the liveness
 * property itself rather than on a specific write.
 *
 * Collaborators are INJECTED (never `mock.module`'d) — see TestingExternalAPIs.md.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { CONFIG } from '../../../config';
import type { Photo, PhotoRef } from '../../../db/schema';
import type { UpdateStatusOptions } from '../../photos/photo-ref-repository';
import { MAX_RETRY_COUNT, processBatch, type SyncWorkerDeps } from '../sync-worker';

const BATCH_SIZE = CONFIG.syncWorker.batchSize;

function makeRef(overrides: Partial<PhotoRef>): PhotoRef {
  return {
    id: 'ref-1',
    photoId: 'photo-1',
    providerId: 'provider-target',
    storageRef: '',
    externalUrl: null,
    status: 'pending',
    errorMessage: null,
    retryCount: 0,
    syncedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makePhoto(id: string): Photo {
  return {
    id,
    userId: 'user-1',
    entityType: 'vehicle',
    entityId: 'vehicle-1',
    fileName: `${id}.jpg`,
    mimeType: 'image/jpeg',
    fileSize: 1024,
    isCover: false,
    sortOrder: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
}

/**
 * The photo_refs table as the worker sees it: `findPendingOrFailed` mirrors the real query
 * (pending/failed, under the retry ceiling, oldest first, capped at batchSize) and `updateStatus`
 * writes through, so a cycle that writes nothing really does hand back the same rows next time.
 */
class FakeRefStore {
  rows: PhotoRef[] = [];
  uploadedRefIds: string[] = [];

  findPendingOrFailed = (limit: number): Promise<PhotoRef[]> =>
    Promise.resolve(
      this.rows
        .filter(
          (r) => (r.status === 'pending' || r.status === 'failed') && r.retryCount < MAX_RETRY_COUNT
        )
        .sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0))
        .slice(0, limit)
        .map((r) => ({ ...r }))
    );

  findActiveByPhoto = (photoId: string): Promise<PhotoRef | null> =>
    Promise.resolve(this.rows.find((r) => r.photoId === photoId && r.status === 'active') ?? null);

  updateStatus = (id: string, options: UpdateStatusOptions): Promise<void> => {
    const row = this.rows.find((r) => r.id === id);
    if (!row) throw new Error(`updateStatus on unknown ref ${id}`);
    Object.assign(row, {
      status: options.status,
      ...(options.storageRef !== undefined ? { storageRef: options.storageRef } : {}),
      ...(options.externalUrl !== undefined ? { externalUrl: options.externalUrl } : {}),
      ...(options.errorMessage !== undefined ? { errorMessage: options.errorMessage } : {}),
      ...(options.retryCount !== undefined ? { retryCount: options.retryCount } : {}),
      ...(options.syncedAt !== undefined ? { syncedAt: options.syncedAt } : {}),
    });
    if (options.status === 'active') this.uploadedRefIds.push(id);
    return Promise.resolve();
  };

  row(id: string): PhotoRef {
    const row = this.rows.find((r) => r.id === id);
    if (!row) throw new Error(`no such ref ${id}`);
    return row;
  }

  /**
   * Pretend the exponential backoff window has elapsed for every failed row. A failed ref is
   * skipped (but still occupies a batch slot) until `30 * 2^retryCount` seconds pass, so without
   * this the suite would have to wait minutes of real time to observe the retry ceiling.
   */
  ageFailedRows(): void {
    for (const row of this.rows) {
      if (row.status === 'failed') row.syncedAt = new Date(Date.now() - 60 * 60 * 1000);
    }
  }
}

let store: FakeRefStore;
let deps: SyncWorkerDeps;

beforeEach(() => {
  store = new FakeRefStore();
  deps = {
    photoRefRepository: {
      findPendingOrFailed: store.findPendingOrFailed,
      findActiveByPhoto: store.findActiveByPhoto,
      updateStatus: store.updateStatus,
    },
    photoRepository: {
      findById: (id: string) => Promise.resolve(makePhoto(id)),
    },
    registry: {
      getProviderInternal: () =>
        Promise.resolve({
          type: 'google-drive',
          download: () => Promise.resolve(Buffer.from('bytes')),
          upload: () =>
            Promise.resolve({
              providerType: 'google-drive',
              externalId: 'uploaded-id',
              externalUrl: 'https://example.com/uploaded',
            }),
        }),
      resolveProviderFolderPath: () => Promise.resolve(''),
    },
  } as unknown as SyncWorkerDeps;
});

describe('a ref with no active source copy', () => {
  test('is recorded as failed on the first cycle instead of being left untouched', async () => {
    store.rows = [makeRef({ id: 'stuck', photoId: 'photo-gone' })];

    await processBatch(deps);

    const parked = store.row('stuck');
    expect(parked.status).toBe('failed');
    expect(parked.retryCount).toBe(1);
    expect(parked.errorMessage).toBe('No active source copy available for this photo');
    // syncedAt is the backoff clock — without it the next attempt is immediate.
    expect(parked.syncedAt).toBeInstanceOf(Date);
  });

  test('leaves the work set, so a newer ref behind it is eventually synced', async () => {
    // batchSize source-less refs, all older than the healthy one → they fill every slot.
    store.rows = Array.from({ length: BATCH_SIZE }, (_, i) =>
      makeRef({
        id: `stuck-${i}`,
        photoId: `photo-gone-${i}`,
        createdAt: new Date(`2026-01-01T00:00:0${i % 10}Z`),
      })
    );
    store.rows.push(
      makeRef({
        id: 'newest',
        photoId: 'photo-live',
        createdAt: new Date('2026-06-01T00:00:00Z'),
      }),
      makeRef({
        id: 'newest-source',
        photoId: 'photo-live',
        providerId: 'provider-source',
        storageRef: 'live-file-id',
        status: 'active',
        createdAt: new Date('2026-06-01T00:00:00Z'),
      })
    );

    // Generous cycle budget: the ceiling is reached in MAX_RETRY_COUNT cycles, and the ref behind
    // the wall syncs on the next one. Pre-fix NO number of cycles is enough.
    const maxCycles = MAX_RETRY_COUNT + 3;
    let cycles = 0;
    while (store.row('newest').status !== 'active' && cycles < maxCycles) {
      await processBatch(deps);
      store.ageFailedRows();
      cycles++;
    }

    expect(store.row('newest').status).toBe('active');
    expect(store.row('newest').storageRef).toBe('uploaded-id');
    expect(cycles).toBeLessThanOrEqual(maxCycles);
    // Every stuck ref ended at the ceiling, which is what took them out of the query's reach.
    for (let i = 0; i < BATCH_SIZE; i++) {
      expect(store.row(`stuck-${i}`).retryCount).toBe(MAX_RETRY_COUNT);
    }
  });
});

describe('a ref whose photo row is gone', () => {
  test('is recorded as failed with the orphan reason', async () => {
    store.rows = [makeRef({ id: 'orphan', photoId: 'photo-deleted' })];
    store.rows.push(
      makeRef({
        id: 'orphan-source',
        photoId: 'photo-deleted',
        providerId: 'provider-source',
        storageRef: 'file-id',
        status: 'active',
      })
    );
    deps.photoRepository = { findById: () => Promise.resolve(null) };

    await processBatch(deps);

    const parked = store.row('orphan');
    expect(parked.status).toBe('failed');
    expect(parked.retryCount).toBe(1);
    expect(parked.errorMessage).toBe('Photo record no longer exists');
  });
});
