import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { Photo, PhotoRef } from '../../../db/schema';
import type { StorageRef } from '../domains/storage/storage-provider';
import {
  MAX_RETRY_COUNT,
  processBatch,
  type SyncWorkerDeps,
  shouldSkipDueToBackoff,
  startSyncWorker,
  stopSyncWorker,
} from '../sync-worker';

// --- Collaborators are INJECTED, not mock.module'd ---
//
// This suite used to `mock.module('../../photos/photo-repository', ...)` (+ the
// ref-repository and the registry). Bun's mock.module is process-global and
// CANNOT be restored (mock.restore() only undoes mock() spies), so those stubs
// leaked into every later file — a stubbed `photoRepository` missing
// `findByUser` made real photos-route tests 500 in the full suite. The sync
// worker now takes an optional `deps` arg (real default); tests pass fakes.
// See .kiro/steering/TestingExternalAPIs.md (inject-don't-mock.module).

const mockFindPendingOrFailed = mock<() => Promise<PhotoRef[]>>(() => Promise.resolve([]));
const mockFindActiveByPhoto = mock<() => Promise<PhotoRef | null>>(() => Promise.resolve(null));
const mockUpdateStatus = mock(() => Promise.resolve());
const mockFindById = mock<() => Promise<Photo | null>>(() => Promise.resolve(null));

const mockDownload = mock<() => Promise<Buffer>>(() => Promise.resolve(Buffer.from('photo-data')));
const mockUpload = mock<() => Promise<StorageRef>>(() =>
  Promise.resolve({
    providerType: 'google-drive',
    externalId: 'new-file-id',
    externalUrl: 'https://example.com/new',
  })
);

function makeMockProvider(type = 'google-drive') {
  return {
    type,
    download: mockDownload,
    upload: mockUpload,
    delete: mock(() => Promise.resolve()),
    getExternalUrl: mock(() => Promise.resolve(null)),
    healthCheck: mock(() => Promise.resolve(true)),
  };
}

const mockGetProvider = mock(() => Promise.resolve(makeMockProvider()));
const mockResolveFolderPath = mock(() => Promise.resolve(''));

/** Build the injected deps bundle from the per-test mocks above. */
function makeDeps(): SyncWorkerDeps {
  return {
    photoRefRepository: {
      findPendingOrFailed: mockFindPendingOrFailed,
      findActiveByPhoto: mockFindActiveByPhoto,
      updateStatus: mockUpdateStatus,
    },
    photoRepository: {
      findById: mockFindById,
    },
    registry: {
      getProviderInternal: mockGetProvider,
      resolveProviderFolderPath: mockResolveFolderPath,
    },
  } as unknown as SyncWorkerDeps;
}

// --- Test fixtures ---

function makePhotoRef(overrides: Partial<PhotoRef> = {}): PhotoRef {
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
    createdAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeActiveRef(overrides: Partial<PhotoRef> = {}): PhotoRef {
  return makePhotoRef({
    id: 'ref-source',
    providerId: 'provider-source',
    storageRef: 'existing-file-id',
    externalUrl: 'https://example.com/existing',
    status: 'active',
    syncedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  });
}

function makePhoto(overrides: Partial<Photo> = {}): Photo {
  return {
    id: 'photo-1',
    userId: 'user-1',
    entityType: 'vehicle',
    entityId: 'vehicle-1',
    fileName: 'car.jpg',
    mimeType: 'image/jpeg',
    fileSize: 1024,
    isCover: false,
    sortOrder: 0,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

// --- Tests ---

describe('shouldSkipDueToBackoff', () => {
  test('returns false for pending refs (not failed)', () => {
    const ref = makePhotoRef({ status: 'pending' });
    expect(shouldSkipDueToBackoff(ref, new Date())).toBe(false);
  });

  test('returns false for failed ref with no syncedAt or createdAt', () => {
    const ref = makePhotoRef({ status: 'failed', syncedAt: null, createdAt: null });
    expect(shouldSkipDueToBackoff(ref, new Date())).toBe(false);
  });

  test('returns true when not enough time has passed (retryCount=0, need 30s)', () => {
    const lastAttempt = new Date('2025-01-01T00:00:00Z');
    const now = new Date('2025-01-01T00:00:15Z'); // 15s later — need 30s
    const ref = makePhotoRef({ status: 'failed', retryCount: 0, syncedAt: lastAttempt });
    expect(shouldSkipDueToBackoff(ref, now)).toBe(true);
  });

  test('returns false when enough time has passed (retryCount=0, 30s elapsed)', () => {
    const lastAttempt = new Date('2025-01-01T00:00:00Z');
    const now = new Date('2025-01-01T00:00:31Z'); // 31s later — need 30s
    const ref = makePhotoRef({ status: 'failed', retryCount: 0, syncedAt: lastAttempt });
    expect(shouldSkipDueToBackoff(ref, now)).toBe(false);
  });

  test('returns true for retryCount=1 when less than 60s elapsed', () => {
    const lastAttempt = new Date('2025-01-01T00:00:00Z');
    const now = new Date('2025-01-01T00:00:50Z'); // 50s — need 60s (30 * 2^1)
    const ref = makePhotoRef({ status: 'failed', retryCount: 1, syncedAt: lastAttempt });
    expect(shouldSkipDueToBackoff(ref, now)).toBe(true);
  });

  test('returns false for retryCount=1 when 60s+ elapsed', () => {
    const lastAttempt = new Date('2025-01-01T00:00:00Z');
    const now = new Date('2025-01-01T00:01:01Z'); // 61s — need 60s
    const ref = makePhotoRef({ status: 'failed', retryCount: 1, syncedAt: lastAttempt });
    expect(shouldSkipDueToBackoff(ref, now)).toBe(false);
  });

  test('returns true for retryCount=2 when less than 120s elapsed', () => {
    const lastAttempt = new Date('2025-01-01T00:00:00Z');
    const now = new Date('2025-01-01T00:01:50Z'); // 110s — need 120s (30 * 2^2)
    const ref = makePhotoRef({ status: 'failed', retryCount: 2, syncedAt: lastAttempt });
    expect(shouldSkipDueToBackoff(ref, now)).toBe(true);
  });

  test('falls back to createdAt when syncedAt is null', () => {
    const createdAt = new Date('2025-01-01T00:00:00Z');
    const now = new Date('2025-01-01T00:00:15Z'); // 15s — need 30s
    const ref = makePhotoRef({ status: 'failed', retryCount: 0, syncedAt: null, createdAt });
    expect(shouldSkipDueToBackoff(ref, now)).toBe(true);
  });
});

describe('startSyncWorker / stopSyncWorker', () => {
  // CONFIG.syncWorker.enabled is false in NODE_ENV=test, so startSyncWorker is a
  // no-op here — these assert the lifecycle is safe to call regardless.
  afterEach(() => {
    stopSyncWorker();
  });

  test('startSyncWorker is a no-op in the test environment (disabled)', () => {
    startSyncWorker();
    stopSyncWorker(); // safe even with no interval to clear
  });

  test('stopSyncWorker is safe to call multiple times', () => {
    startSyncWorker();
    stopSyncWorker();
    stopSyncWorker(); // second call should not throw
  });
});

describe('processBatch', () => {
  beforeEach(() => {
    mockFindPendingOrFailed.mockReset();
    mockFindActiveByPhoto.mockReset();
    mockFindById.mockReset();
    mockGetProvider.mockReset();
    mockResolveFolderPath.mockReset();
    mockUpdateStatus.mockReset();
    mockDownload.mockReset();
    mockUpload.mockReset();

    // Default: no pending refs
    mockFindPendingOrFailed.mockResolvedValue([]);
    mockResolveFolderPath.mockResolvedValue('');
  });

  test('does nothing when no pending refs exist', async () => {
    mockFindPendingOrFailed.mockResolvedValue([]);
    await processBatch(makeDeps());
    expect(mockFindPendingOrFailed).toHaveBeenCalledTimes(1);
    expect(mockUpdateStatus).not.toHaveBeenCalled();
  });

  test('skips failed refs that are within backoff window', async () => {
    const recentFailure = makePhotoRef({
      status: 'failed',
      retryCount: 0,
      syncedAt: new Date(), // just now — within 30s backoff
    });
    mockFindPendingOrFailed.mockResolvedValue([recentFailure]);

    await processBatch(makeDeps());

    // Should not attempt to process (no updateStatus calls)
    expect(mockUpdateStatus).not.toHaveBeenCalled();
    expect(mockFindActiveByPhoto).not.toHaveBeenCalled();
  });

  test('skips ref when no active source ref exists for the photo', async () => {
    const pendingRef = makePhotoRef({ status: 'pending' });
    mockFindPendingOrFailed.mockResolvedValue([pendingRef]);
    mockFindActiveByPhoto.mockResolvedValue(null);

    await processBatch(makeDeps());

    expect(mockFindActiveByPhoto).toHaveBeenCalledWith('photo-1');
    expect(mockUpdateStatus).not.toHaveBeenCalled();
  });

  test('skips ref when photo record not found', async () => {
    const pendingRef = makePhotoRef({ status: 'pending' });
    const activeRef = makeActiveRef();
    mockFindPendingOrFailed.mockResolvedValue([pendingRef]);
    mockFindActiveByPhoto.mockResolvedValue(activeRef);
    mockFindById.mockResolvedValue(null);

    await processBatch(makeDeps());

    expect(mockFindById).toHaveBeenCalledWith('photo-1');
    expect(mockUpdateStatus).not.toHaveBeenCalled();
  });

  test('successfully syncs a pending ref: downloads from source, uploads to target', async () => {
    const pendingRef = makePhotoRef({ status: 'pending' });
    const activeRef = makeActiveRef();
    const photo = makePhoto();

    mockFindPendingOrFailed.mockResolvedValue([pendingRef]);
    mockFindActiveByPhoto.mockResolvedValue(activeRef);
    mockFindById.mockResolvedValue(photo);
    mockDownload.mockResolvedValue(Buffer.from('photo-data'));
    mockUpload.mockResolvedValue({
      providerType: 'google-drive',
      externalId: 'new-file-id',
      externalUrl: 'https://example.com/new',
    });

    const sourceProvider = makeMockProvider('google-drive');
    const targetProvider = makeMockProvider('s3');
    mockGetProvider
      .mockResolvedValueOnce(sourceProvider) // for download
      .mockResolvedValueOnce(targetProvider) // for path resolution
      .mockResolvedValueOnce(targetProvider); // for upload

    await processBatch(makeDeps());

    // Should have downloaded from source
    expect(mockDownload).toHaveBeenCalledWith({
      providerType: 'google-drive',
      externalId: 'existing-file-id',
    });

    // Should have uploaded to target with photo metadata
    expect(mockUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'car.jpg',
        mimeType: 'image/jpeg',
        entityType: 'vehicle',
        entityId: 'vehicle-1',
      })
    );

    // Should have updated status to active
    expect(mockUpdateStatus).toHaveBeenCalledWith('ref-1', {
      status: 'active',
      storageRef: 'new-file-id',
      externalUrl: 'https://example.com/new',
      syncedAt: expect.any(Date),
    });
  });

  // C261: the folder-path resolution is wrapped in its OWN try/catch (sync-worker.ts:228-234) so a
  // storage_config glitch can't strand a photo in `failed` forever (NORTH_STAR #1 — no silent loss).
  // Every other test resolves the path cleanly, leaving this resilience branch unpinned: a throwing
  // resolveProviderFolderPath must be swallowed and the upload must still proceed with an empty pathHint.
  test('path-resolution failure is swallowed — the sync still completes with an empty pathHint', async () => {
    const pendingRef = makePhotoRef({ status: 'pending' });
    const activeRef = makeActiveRef();
    const photo = makePhoto(); // entityType 'vehicle' → IS in ENTITY_TO_CATEGORY, so resolve IS attempted

    mockFindPendingOrFailed.mockResolvedValue([pendingRef]);
    mockFindActiveByPhoto.mockResolvedValue(activeRef);
    mockFindById.mockResolvedValue(photo);
    mockDownload.mockResolvedValue(Buffer.from('photo-data'));
    mockResolveFolderPath.mockRejectedValue(new Error('storage_config unreadable'));
    mockUpload.mockResolvedValue({
      providerType: 'google-drive',
      externalId: 'new-file-id',
      externalUrl: 'https://example.com/new',
    });
    mockGetProvider.mockResolvedValue(makeMockProvider('s3'));

    await processBatch(makeDeps());

    // The resolve was attempted (vehicle maps to a category) and threw...
    expect(mockResolveFolderPath).toHaveBeenCalled();
    // ...but the upload still happened, with the empty-string pathHint fallback.
    expect(mockUpload).toHaveBeenCalledWith(expect.objectContaining({ pathHint: '' }));
    // ...and the ref ends up ACTIVE, not failed — the photo is not stranded.
    expect(mockUpdateStatus).toHaveBeenCalledWith('ref-1', {
      status: 'active',
      storageRef: 'new-file-id',
      externalUrl: 'https://example.com/new',
      syncedAt: expect.any(Date),
    });
  });

  // C261: an entityType absent from ENTITY_TO_CATEGORY yields an undefined category, so path
  // resolution is SKIPPED entirely (the `if (category)` guard at sync-worker.ts:228) — the sync must
  // still upload with the empty pathHint rather than crash on a missing map entry.
  test('unknown entityType skips path resolution and still uploads (empty pathHint)', async () => {
    const pendingRef = makePhotoRef({ status: 'pending' });
    const activeRef = makeActiveRef();
    const photo = makePhoto({ entityType: 'not_a_known_entity' }); // NOT in ENTITY_TO_CATEGORY

    mockFindPendingOrFailed.mockResolvedValue([pendingRef]);
    mockFindActiveByPhoto.mockResolvedValue(activeRef);
    mockFindById.mockResolvedValue(photo);
    mockDownload.mockResolvedValue(Buffer.from('photo-data'));
    mockUpload.mockResolvedValue({
      providerType: 'google-drive',
      externalId: 'new-file-id',
      externalUrl: 'https://example.com/new',
    });
    mockGetProvider.mockResolvedValue(makeMockProvider('s3'));

    await processBatch(makeDeps());

    // category undefined → the resolve branch is never entered.
    expect(mockResolveFolderPath).not.toHaveBeenCalled();
    // Upload still proceeds with the empty pathHint default.
    expect(mockUpload).toHaveBeenCalledWith(expect.objectContaining({ pathHint: '' }));
    expect(mockUpdateStatus).toHaveBeenCalledWith('ref-1', {
      status: 'active',
      storageRef: 'new-file-id',
      externalUrl: 'https://example.com/new',
      syncedAt: expect.any(Date),
    });
  });

  test('marks ref as failed with incremented retryCount on upload error', async () => {
    const pendingRef = makePhotoRef({ status: 'pending', retryCount: 0 });
    const activeRef = makeActiveRef();
    const photo = makePhoto();

    mockFindPendingOrFailed.mockResolvedValue([pendingRef]);
    mockFindActiveByPhoto.mockResolvedValue(activeRef);
    mockFindById.mockResolvedValue(photo);
    mockDownload.mockResolvedValue(Buffer.from('photo-data'));
    mockUpload.mockRejectedValue(new Error('Upload failed: network timeout'));

    const sourceProvider = makeMockProvider('google-drive');
    const targetProvider = makeMockProvider('s3');
    mockGetProvider
      .mockResolvedValueOnce(sourceProvider)
      .mockResolvedValueOnce(targetProvider)
      .mockResolvedValueOnce(targetProvider);

    await processBatch(makeDeps());

    // Should mark as failed with incremented retry count and error message
    expect(mockUpdateStatus).toHaveBeenCalledWith('ref-1', {
      status: 'failed',
      errorMessage: 'Upload failed: network timeout',
      retryCount: 1,
      syncedAt: expect.any(Date),
    });
  });

  test('marks ref as failed with incremented retryCount on download error', async () => {
    const pendingRef = makePhotoRef({ status: 'pending', retryCount: 1 });
    const activeRef = makeActiveRef();
    const photo = makePhoto();

    mockFindPendingOrFailed.mockResolvedValue([pendingRef]);
    mockFindActiveByPhoto.mockResolvedValue(activeRef);
    mockFindById.mockResolvedValue(photo);
    mockDownload.mockRejectedValue(new Error('Download failed'));

    const provider = makeMockProvider('google-drive');
    mockGetProvider.mockResolvedValue(provider);

    await processBatch(makeDeps());

    expect(mockUpdateStatus).toHaveBeenCalledWith('ref-1', {
      status: 'failed',
      errorMessage: 'Download failed',
      retryCount: 2,
      syncedAt: expect.any(Date),
    });
  });

  // #144: a revoked/expired token (AUTH_INVALID) is TERMINAL — the provider adapters map a 401/403
  // to it (#105) "so the user re-connects". The worker must NOT retry it: jump retryCount to the cap
  // (so findPendingOrFailed's `retryCount < 3` stops re-picking it) + prefix the message so the
  // provider-stats `failed` count means "reconnect required", not a transient flake. Pre-fix this
  // ref would get retryCount:1 and a bare message + burn 3 backoff cycles. The #105/#43/#44 family.
  test('parks a ref terminally (no retry) on a TERMINAL auth error (#144)', async () => {
    const { SyncError, SyncErrorCode } = await import('../../../errors');
    const pendingRef = makePhotoRef({ status: 'pending', retryCount: 0 });
    const activeRef = makeActiveRef();
    const photo = makePhoto();

    mockFindPendingOrFailed.mockResolvedValue([pendingRef]);
    mockFindActiveByPhoto.mockResolvedValue(activeRef);
    mockFindById.mockResolvedValue(photo);
    mockDownload.mockResolvedValue(Buffer.from('photo-data'));
    mockUpload.mockRejectedValue(
      new SyncError(SyncErrorCode.AUTH_INVALID, 'Google Photos token revoked')
    );

    const sourceProvider = makeMockProvider('google-drive');
    const targetProvider = makeMockProvider('google-photos');
    mockGetProvider
      .mockResolvedValueOnce(sourceProvider)
      .mockResolvedValueOnce(targetProvider)
      .mockResolvedValueOnce(targetProvider);

    await processBatch(makeDeps());

    // retryCount jumps straight to the cap (MAX_RETRY_COUNT) — NOT 1 — so the ref drops out of the
    // work set (findPendingOrFailed's `retryCount < MAX_RETRY_COUNT`), and the message is reconnect-
    // prefixed. Referencing the real constant (not a magic 3) keeps this in lockstep with the cap +
    // the sync-worker-retry-ceiling-sync source-scan guard.
    expect(mockUpdateStatus).toHaveBeenCalledWith('ref-1', {
      status: 'failed',
      errorMessage: 'Reconnect required: Google Photos token revoked',
      retryCount: MAX_RETRY_COUNT,
      syncedAt: expect.any(Date),
    });
  });

  test('processes multiple refs in a single batch', async () => {
    const ref1 = makePhotoRef({ id: 'ref-1', photoId: 'photo-1', status: 'pending' });
    const ref2 = makePhotoRef({ id: 'ref-2', photoId: 'photo-2', status: 'pending' });
    const activeRef1 = makeActiveRef({ photoId: 'photo-1' });
    const activeRef2 = makeActiveRef({ photoId: 'photo-2' });
    const photo1 = makePhoto({ id: 'photo-1' });
    const photo2 = makePhoto({ id: 'photo-2', fileName: 'receipt.png', mimeType: 'image/png' });

    mockFindPendingOrFailed.mockResolvedValue([ref1, ref2]);
    mockFindActiveByPhoto.mockResolvedValueOnce(activeRef1).mockResolvedValueOnce(activeRef2);
    mockFindById.mockResolvedValueOnce(photo1).mockResolvedValueOnce(photo2);

    const provider = makeMockProvider('google-drive');
    mockGetProvider.mockResolvedValue(provider);
    mockDownload.mockResolvedValue(Buffer.from('data'));
    mockUpload.mockResolvedValue({
      providerType: 'google-drive',
      externalId: 'new-id',
      externalUrl: 'https://example.com/new',
    });

    await processBatch(makeDeps());

    // Both refs should have been updated to active
    expect(mockUpdateStatus).toHaveBeenCalledTimes(2);
  });
});
