import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { Photo, PhotoRef } from '../../../db/schema';
import type { StorageRef } from '../domains/storage/storage-provider';

// --- Mocks must be set up before importing the module under test ---

const mockFindPendingOrFailed = mock<() => Promise<PhotoRef[]>>(() => Promise.resolve([]));
const mockFindActiveByPhoto = mock<() => Promise<PhotoRef | null>>(() => Promise.resolve(null));
const mockUpdateStatus = mock(() => Promise.resolve());

mock.module('../../photos/photo-ref-repository', () => ({
  photoRefRepository: {
    findPendingOrFailed: mockFindPendingOrFailed,
    findActiveByPhoto: mockFindActiveByPhoto,
    updateStatus: mockUpdateStatus,
  },
}));

const mockFindById = mock<() => Promise<Photo | null>>(() => Promise.resolve(null));

mock.module('../../photos/photo-repository', () => ({
  photoRepository: {
    findById: mockFindById,
  },
}));

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

mock.module('../domains/storage/registry', () => ({
  storageProviderRegistry: {
    getProviderInternal: mockGetProvider,
    resolveProviderFolderPath: mock(() => Promise.resolve('')),
  },
}));

let mockConfigEnabled = false;

// Capture the real CONFIG before mocking so other modules that depend on
// CONFIG.backup, CONFIG.validation, CONFIG.auth, etc. still work when tests
// run in the same process.
import {
  getBackupTableKeys,
  getRequiredBackupFiles,
  CONFIG as REAL_CONFIG,
  TABLE_FILENAME_MAP,
  TABLE_SCHEMA_MAP,
} from '../../../config';

mock.module('../../../config', () => ({
  CONFIG: {
    ...REAL_CONFIG,
    syncWorker: {
      get enabled() {
        return mockConfigEnabled;
      },
      pollIntervalMs: 30_000,
      batchSize: 10,
    },
  },
  TABLE_SCHEMA_MAP,
  TABLE_FILENAME_MAP,
  getBackupTableKeys,
  getRequiredBackupFiles,
}));

mock.module('../../../utils/logger', () => ({
  logger: {
    info: mock(() => {}),
    debug: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  },
}));

// --- Import module under test AFTER mocks ---
import {
  processBatch,
  shouldSkipDueToBackoff,
  startSyncWorker,
  stopSyncWorker,
} from '../sync-worker';

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
  afterEach(() => {
    stopSyncWorker();
    mockConfigEnabled = false;
  });

  test('startSyncWorker is a no-op when CONFIG.syncWorker.enabled is false', () => {
    mockConfigEnabled = false;
    startSyncWorker();
    // Calling stop should be safe (no interval to clear)
    stopSyncWorker();
  });

  test('startSyncWorker sets up interval when enabled', () => {
    mockConfigEnabled = true;
    startSyncWorker();
    // Calling stop should clear the interval without error
    stopSyncWorker();
  });

  test('stopSyncWorker is safe to call multiple times', () => {
    mockConfigEnabled = true;
    startSyncWorker();
    stopSyncWorker();
    stopSyncWorker(); // second call should not throw
  });

  test('startSyncWorker warns if already running', () => {
    mockConfigEnabled = true;
    startSyncWorker();
    startSyncWorker(); // second call — should warn, not create duplicate
    stopSyncWorker();
  });
});

describe('processBatch', () => {
  beforeEach(() => {
    mockFindPendingOrFailed.mockReset();
    mockFindActiveByPhoto.mockReset();
    mockFindById.mockReset();
    mockGetProvider.mockReset();
    mockUpdateStatus.mockReset();
    mockDownload.mockReset();
    mockUpload.mockReset();

    // Default: no pending refs
    mockFindPendingOrFailed.mockResolvedValue([]);
  });

  test('does nothing when no pending refs exist', async () => {
    mockFindPendingOrFailed.mockResolvedValue([]);
    await processBatch();
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

    await processBatch();

    // Should not attempt to process (no updateStatus calls)
    expect(mockUpdateStatus).not.toHaveBeenCalled();
    expect(mockFindActiveByPhoto).not.toHaveBeenCalled();
  });

  test('skips ref when no active source ref exists for the photo', async () => {
    const pendingRef = makePhotoRef({ status: 'pending' });
    mockFindPendingOrFailed.mockResolvedValue([pendingRef]);
    mockFindActiveByPhoto.mockResolvedValue(null);

    await processBatch();

    expect(mockFindActiveByPhoto).toHaveBeenCalledWith('photo-1');
    expect(mockUpdateStatus).not.toHaveBeenCalled();
  });

  test('skips ref when photo record not found', async () => {
    const pendingRef = makePhotoRef({ status: 'pending' });
    const activeRef = makeActiveRef();
    mockFindPendingOrFailed.mockResolvedValue([pendingRef]);
    mockFindActiveByPhoto.mockResolvedValue(activeRef);
    mockFindById.mockResolvedValue(null);

    await processBatch();

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

    await processBatch();

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

    await processBatch();

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

    await processBatch();

    expect(mockUpdateStatus).toHaveBeenCalledWith('ref-1', {
      status: 'failed',
      errorMessage: 'Download failed',
      retryCount: 2,
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

    await processBatch();

    // Both refs should have been updated to active
    expect(mockUpdateStatus).toHaveBeenCalledTimes(2);
  });
});
