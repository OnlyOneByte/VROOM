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
    const now = new Date('2025-01-01T00:00:15Z');
    const ref = makePhotoRef({ status: 'failed', retryCount: 0, syncedAt: lastAttempt });
    expect(shouldSkipDueToBackoff(ref, now)).toBe(true);
  });

  test('returns false when enough time has passed (retryCount=0, 30s elapsed)', () => {
    const lastAttempt = new Date('2025-01-01T00:00:00Z');
    const now = new Date('2025-01-01T00:00:31Z');
    const ref = makePhotoRef({ status: 'failed', retryCount: 0, syncedAt: lastAttempt });
    expect(shouldSkipDueToBackoff(ref, now)).toBe(false);
  });

  test('returns true for retryCount=1 when less than 60s elapsed', () => {
    const lastAttempt = new Date('2025-01-01T00:00:00Z');
    const now = new Date('2025-01-01T00:00:50Z');
    const ref = makePhotoRef({ status: 'failed', retryCount: 1, syncedAt: lastAttempt });
    expect(shouldSkipDueToBackoff(ref, now)).toBe(true);
  });

  test('returns false for retryCount=1 when 60s+ elapsed', () => {
    const lastAttempt = new Date('2025-01-01T00:00:00Z');
    const now = new Date('2025-01-01T00:01:01Z');
    const ref = makePhotoRef({ status: 'failed', retryCount: 1, syncedAt: lastAttempt });
    expect(shouldSkipDueToBackoff(ref, now)).toBe(false);
  });

  test('returns true for retryCount=2 when less than 120s elapsed', () => {
    const lastAttempt = new Date('2025-01-01T00:00:00Z');
    const now = new Date('2025-01-01T00:01:50Z');
    const ref = makePhotoRef({ status: 'failed', retryCount: 2, syncedAt: lastAttempt });
    expect(shouldSkipDueToBackoff(ref, now)).toBe(true);
  });

  test('falls back to createdAt when syncedAt is null', () => {
    const createdAt = new Date('2025-01-01T00:00:00Z');
    const now = new Date('2025-01-01T00:00:15Z');
    const ref = makePhotoRef({ status: 'failed', retryCount: 0, syncedAt: null, createdAt });
    expect(shouldSkipDueToBackoff(ref, now)).toBe(true);
  });
});

describe('startSyncWorker / stopSyncWorker', () => {
  afterEach(() => {
    stopSyncWorker();
  });

  test('startSyncWorker is a no-op in the test environment (disabled)', () => {
    startSyncWorker();
    stopSyncWorker();
  });

  test('stopSyncWorker is safe to call multiple times', () => {
    startSyncWorker();
    stopSyncWorker();
    stopSyncWorker();
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
      syncedAt: new Date(),
    });
    mockFindPendingOrFailed.mockResolvedValue([recentFailure]);

    await processBatch(makeDeps());

    expect(mockUpdateStatus).not.toHaveBeenCalled();
    expect(mockFindActiveByPhoto).not.toHaveBeenCalled();
  });

  test('records a failure when no active source ref exists for the photo', async () => {
    const pendingRef = makePhotoRef({ status: 'pending' });
    mockFindPendingOrFailed.mockResolvedValue([pendingRef]);
    mockFindActiveByPhoto.mockResolvedValue(null);

    await processBatch(makeDeps());

    expect(mockFindActiveByPhoto).toHaveBeenCalledWith('photo-1');
    expect(mockUpdateStatus).toHaveBeenCalledWith('ref-1', {
      status: 'failed',
      errorMessage: 'No active source copy available for this photo',
      retryCount: 1,
      syncedAt: expect.any(Date),
    });
  });

  test('records a failure when the photo record is not found', async () => {
    const pendingRef = makePhotoRef({ status: 'pending' });
    const activeRef = makeActiveRef();
    mockFindPendingOrFailed.mockResolvedValue([pendingRef]);
    mockFindActiveByPhoto.mockResolvedValue(activeRef);
    mockFindById.mockResolvedValue(null);

    await processBatch(makeDeps());

    expect(mockFindById).toHaveBeenCalledWith('photo-1');
    expect(mockUpdateStatus).toHaveBeenCalledWith('ref-1', {
      status: 'failed',
      errorMessage: 'Photo record no longer exists',
      retryCount: 1,
      syncedAt: expect.any(Date),
    });
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
      .mockResolvedValueOnce(sourceProvider)
      .mockResolvedValueOnce(targetProvider)
      .mockResolvedValueOnce(targetProvider);

    await processBatch(makeDeps());

    expect(mockDownload).toHaveBeenCalledWith({
      providerType: 'google-drive',
      externalId: 'existing-file-id',
    });

    expect(mockUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'car.jpg',
        mimeType: 'image/jpeg',
        entityType: 'vehicle',
        entityId: 'vehicle-1',
      })
    );

    expect(mockUpdateStatus).toHaveBeenCalledWith('ref-1', {
      status: 'active',
      storageRef: 'new-file-id',
      externalUrl: 'https://example.com/new',
      syncedAt: expect.any(Date),
    });
  });

  test('path-resolution failure is swallowed — the sync still completes with an empty pathHint', async () => {
    const pendingRef = makePhotoRef({ status: 'pending' });
    const activeRef = makeActiveRef();
    const photo = makePhoto();

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

    expect(mockResolveFolderPath).toHaveBeenCalled();
    expect(mockUpload).toHaveBeenCalledWith(expect.objectContaining({ pathHint: '' }));
    expect(mockUpdateStatus).toHaveBeenCalledWith('ref-1', {
      status: 'active',
      storageRef: 'new-file-id',
      externalUrl: 'https://example.com/new',
      syncedAt: expect.any(Date),
    });
  });

  test('unknown entityType skips path resolution and still uploads (empty pathHint)', async () => {
    const pendingRef = makePhotoRef({ status: 'pending' });
    const activeRef = makeActiveRef();
    const photo = makePhoto({ entityType: 'not_a_known_entity' });

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

    expect(mockResolveFolderPath).not.toHaveBeenCalled();
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

  test('parks a ref terminally (no retry) on a TERMINAL auth error', async () => {
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

    expect(mockUpdateStatus).toHaveBeenCalledTimes(2);
  });
});
