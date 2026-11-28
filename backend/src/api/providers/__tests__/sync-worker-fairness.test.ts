import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { repos } from '../../../app-context';
import type { Photo, PhotoRef } from '../../../db/schema';
import { SyncError, SyncErrorCode } from '../../../errors';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../../test-helpers/http-client';
import { createInvitee } from '../../../test-helpers/invitee';
import type { UpdateStatusOptions } from '../../photos/photo-ref-repository';
import { processBatch, type SyncWorkerDeps } from '../sync-worker';

function makeRef(id: string, providerId: string): PhotoRef {
  return {
    id,
    photoId: `photo-${id}`,
    providerId,
    storageRef: '',
    externalUrl: null,
    status: 'pending',
    errorMessage: null,
    retryCount: 0,
    syncedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
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
    createdBy: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
}

describe('photo sync batches', () => {
  test('a provider that stops answering only holds up its own refs', async () => {
    const refs = [
      makeRef('slow-1', 'slow'),
      makeRef('slow-2', 'slow'),
      makeRef('slow-3', 'slow'),
      makeRef('fast-1', 'fast'),
    ];
    const statuses = new Map<string, UpdateStatusOptions['status']>();
    const uploads: string[] = [];
    const provider = (id: string) => ({
      type: 'fake',
      download: () => Promise.resolve(Buffer.from('bytes')),
      upload: () => {
        uploads.push(id);
        return id === 'slow'
          ? Promise.reject(new SyncError(SyncErrorCode.NETWORK_ERROR, 'upload timed out'))
          : Promise.resolve({ providerType: 'fake', externalId: 'x', externalUrl: 'https://x' });
      },
    });
    const deps = {
      photoRefRepository: {
        findPendingOrFailed: () => Promise.resolve(refs),
        findActiveByPhoto: (photoId: string) =>
          Promise.resolve({ ...makeRef(`src-${photoId}`, 'source'), status: 'active' }),
        updateStatus: (id: string, options: UpdateStatusOptions) => {
          statuses.set(id, options.status);
          return Promise.resolve();
        },
      },
      photoRepository: { findById: (id: string) => Promise.resolve(makePhoto(id)) },
      registry: {
        getProvider: (id: string) => Promise.resolve(provider(id)),
        resolveProviderFolderPath: () => Promise.resolve(''),
      },
    } as unknown as SyncWorkerDeps;

    await processBatch(deps);

    expect(statuses.get('fast-1')).toBe('active');
    expect(statuses.get('slow-1')).toBe('failed');
    expect(uploads.filter((id) => id === 'slow')).toHaveLength(1);
    expect(statuses.has('slow-2')).toBe(false);
    expect(statuses.has('slow-3')).toBe(false);
  });
});

describe('choosing refs to sync', () => {
  let ctx: TestApp;

  beforeEach(async () => {
    ctx = await createTestApp();
  }, SETUP_TIMEOUT_MS);
  afterEach(() => ctx.close());

  async function seedOwner(userId: string, prefix: string, count: number): Promise<void> {
    await ctx.sql.run(
      `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, status)
       VALUES (?, ?, 'storage', 'fake', ?, 'x', 'active')`,
      [`prov-${prefix}`, userId, prefix]
    );
    for (let i = 0; i < count; i++) {
      const photoId = `photo-${prefix}-${String(i).padStart(2, '0')}`;
      await ctx.sql.run(
        `INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size)
         VALUES (?, ?, 'vehicle', 'veh', 'a.jpg', 'image/jpeg', 1)`,
        [photoId, userId]
      );
      await ctx.sql.run(
        `INSERT INTO photo_refs (id, photo_id, provider_id, storage_ref, status)
         VALUES (?, ?, ?, '', 'pending')`,
        [`ref-${prefix}-${String(i).padStart(2, '0')}`, photoId, `prov-${prefix}`]
      );
    }
  }

  test('a long queue from one owner does not crowd out another owner', async () => {
    const other = await createInvitee(ctx, 'owner-b');
    await seedOwner(ctx.user.id, 'a', 12);
    await seedOwner(other.id, 'b', 1);

    const picked = await repos().photoRefs.findPendingOrFailed(10);

    expect(picked).toHaveLength(10);
    expect(picked.map((r) => r.id)).toContain('ref-b-00');
    expect(
      picked
        .slice(0, 2)
        .map((r) => r.providerId)
        .sort()
    ).toEqual(['prov-a', 'prov-b']);
  });
});
