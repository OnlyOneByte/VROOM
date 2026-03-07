import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { NewPhotoRef, PhotoRef } from '../../../db/schema';
import { PhotoRefRepository } from '../photo-ref-repository';

// --- Test fixtures ---

const now = new Date();

const activeRef: PhotoRef = {
  id: 'ref-1',
  photoId: 'photo-1',
  providerId: 'provider-1',
  storageRef: 'drive-file-abc',
  externalUrl: 'https://drive.google.com/file/abc',
  status: 'active',
  errorMessage: null,
  retryCount: 0,
  syncedAt: now,
  createdAt: now,
};

const pendingRef: PhotoRef = {
  id: 'ref-2',
  photoId: 'photo-1',
  providerId: 'provider-2',
  storageRef: '',
  externalUrl: null,
  status: 'pending',
  errorMessage: null,
  retryCount: 0,
  syncedAt: null,
  createdAt: now,
};

const failedRef: PhotoRef = {
  id: 'ref-3',
  photoId: 'photo-2',
  providerId: 'provider-1',
  storageRef: '',
  externalUrl: null,
  status: 'failed',
  errorMessage: 'Upload timeout',
  retryCount: 1,
  syncedAt: null,
  createdAt: now,
};

/**
 * Creates a mock DB that supports chained Drizzle query methods.
 * Each call through a full chain (ending at limit/returning/execute) consumes
 * the next result from the queue.
 */
function createMockDb(resultQueue: unknown[][]) {
  let callIndex = 0;

  const chain: Record<string, unknown> = {
    select: mock(() => chain),
    from: mock(() => chain),
    where: mock(() => {
      const idx = callIndex++;
      const result = resultQueue[idx] ?? [];
      chain._currentResult = result;
      return chain;
    }),
    orderBy: mock(() => chain),
    limit: mock(() => chain._currentResult ?? []),
    innerJoin: mock(() => chain),
    // For insert().values().returning()
    insert: mock(() => chain),
    values: mock(() => chain),
    returning: mock(() => {
      const idx = callIndex++;
      return resultQueue[idx] ?? [];
    }),
    // For update().set().where()
    update: mock(() => chain),
    set: mock(() => chain),
    // For delete().where()
    delete: mock(() => chain),
  };

  return chain;
}

describe('PhotoRefRepository', () => {
  afterEach(() => {
    mock.restore();
  });

  describe('findActiveByPhotoAndProvider', () => {
    test('returns matching active ref', async () => {
      const db = createMockDb([[activeRef]]);
      const repo = new PhotoRefRepository(db as never);

      const result = await repo.findActiveByPhotoAndProvider('photo-1', 'provider-1');

      expect(result).toEqual(activeRef);
    });

    test('returns null when no active ref exists', async () => {
      const db = createMockDb([[]]);
      const repo = new PhotoRefRepository(db as never);

      const result = await repo.findActiveByPhotoAndProvider('photo-1', 'provider-99');

      expect(result).toBeNull();
    });
  });

  describe('findActiveByPhoto', () => {
    test('returns most recently synced active ref', async () => {
      const db = createMockDb([[activeRef]]);
      const repo = new PhotoRefRepository(db as never);

      const result = await repo.findActiveByPhoto('photo-1');

      expect(result).toEqual(activeRef);
    });

    test('returns null when no active refs exist', async () => {
      const db = createMockDb([[]]);
      const repo = new PhotoRefRepository(db as never);

      const result = await repo.findActiveByPhoto('photo-missing');

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    test('inserts and returns the new photo ref', async () => {
      const newRef: NewPhotoRef = {
        photoId: 'photo-1',
        providerId: 'provider-1',
        storageRef: 'drive-file-xyz',
        externalUrl: 'https://drive.google.com/file/xyz',
        status: 'active',
      };
      const createdRef: PhotoRef = {
        id: 'ref-new',
        photoId: newRef.photoId,
        providerId: newRef.providerId,
        storageRef: newRef.storageRef,
        externalUrl: newRef.externalUrl ?? null,
        status: 'active',
        errorMessage: null,
        retryCount: 0,
        syncedAt: now,
        createdAt: now,
      };

      const db = createMockDb([[createdRef]]);
      const repo = new PhotoRefRepository(db as never);

      const result = await repo.create(newRef);

      expect(result).toEqual(createdRef);
      expect(result.storageRef).toBe('drive-file-xyz');
    });
  });

  describe('updateStatus', () => {
    test('updates status only when no optional fields provided', async () => {
      const db = createMockDb([[]]);
      const repo = new PhotoRefRepository(db as never);

      await repo.updateStatus('ref-1', { status: 'failed' });

      expect(db.update).toHaveBeenCalled();
      expect(db.set).toHaveBeenCalled();
    });

    test('updates status with optional storageRef and externalUrl', async () => {
      const db = createMockDb([[]]);
      const repo = new PhotoRefRepository(db as never);

      await repo.updateStatus('ref-2', {
        status: 'active',
        storageRef: 's3-key-123',
        externalUrl: 'https://s3.example.com/file',
      });

      expect(db.update).toHaveBeenCalled();
      expect(db.set).toHaveBeenCalled();
    });

    test('updates status with errorMessage', async () => {
      const db = createMockDb([[]]);
      const repo = new PhotoRefRepository(db as never);

      await repo.updateStatus('ref-2', {
        status: 'failed',
        errorMessage: 'Connection refused',
      });

      expect(db.update).toHaveBeenCalled();
      expect(db.set).toHaveBeenCalled();
    });
  });

  describe('findPendingOrFailed', () => {
    test('returns pending and failed refs with retries remaining', async () => {
      const db = createMockDb([[pendingRef, failedRef]]);
      const repo = new PhotoRefRepository(db as never);

      const results = await repo.findPendingOrFailed(10);

      expect(results).toHaveLength(2);
      expect(results[0].status).toBe('pending');
      expect(results[1].status).toBe('failed');
    });

    test('returns empty array when no pending/failed refs', async () => {
      const db = createMockDb([[]]);
      const repo = new PhotoRefRepository(db as never);

      const results = await repo.findPendingOrFailed(10);

      expect(results).toHaveLength(0);
    });
  });

  describe('countByProviderAndCategory', () => {
    test('returns count of active refs for provider and entity types', async () => {
      // countByProviderAndCategory uses select().from().innerJoin().where()
      // The where() call returns the result array directly (no .limit())
      const countResult = [{ count: 42 }];
      const countDb = {
        select: mock(() => countDb),
        from: mock(() => countDb),
        innerJoin: mock(() => countDb),
        where: mock(() => countResult),
      };
      const repo = new PhotoRefRepository(countDb as never);

      const count = await repo.countByProviderAndCategory('provider-1', ['vehicle']);

      expect(count).toBe(42);
    });

    test('returns 0 when no matching refs', async () => {
      const countDb = {
        select: mock(() => countDb),
        from: mock(() => countDb),
        innerJoin: mock(() => countDb),
        where: mock(() => [{ count: 0 }]),
      };
      const repo = new PhotoRefRepository(countDb as never);

      const count = await repo.countByProviderAndCategory('provider-99', ['vehicle']);

      expect(count).toBe(0);
    });
  });

  describe('deleteByProvider', () => {
    test('deletes all refs for a provider', async () => {
      const db = createMockDb([[]]);
      const repo = new PhotoRefRepository(db as never);

      await repo.deleteByProvider('provider-1');

      expect(db.delete).toHaveBeenCalled();
    });
  });

  describe('deleteByPhoto', () => {
    test('deletes all refs for a photo', async () => {
      const db = createMockDb([[]]);
      const repo = new PhotoRefRepository(db as never);

      await repo.deleteByPhoto('photo-1');

      expect(db.delete).toHaveBeenCalled();
    });
  });
});
