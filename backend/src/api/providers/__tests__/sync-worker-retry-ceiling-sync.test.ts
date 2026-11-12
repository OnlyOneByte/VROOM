import { beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});

describe('sync-worker retry ceiling matches the repository query', () => {
  test('the repository hands the worker refs below MAX_RETRY_COUNT and withholds refs at it', async () => {
    const { db } = await import('../../../db/connection');
    const schema = await import('../../../db/schema');
    const { photoRefRepository } = await import('../../photos/photo-ref-repository');
    const { MAX_RETRY_COUNT } = await import('../sync-worker');

    const [provider] = await db
      .insert(schema.userProviders)
      .values({
        userId: ctx.user.id,
        domain: 'storage',
        providerType: 's3',
        displayName: 'Ceiling test storage',
        credentials: 'opaque',
        status: 'active',
      })
      .returning();
    const seedRef = async (id: string, retryCount: number) => {
      const [photo] = await db
        .insert(schema.photos)
        .values({
          userId: ctx.user.id,
          entityType: 'vehicle',
          entityId: `vehicle-${id}`,
          fileName: `${id}.jpg`,
          mimeType: 'image/jpeg',
          fileSize: 1,
        })
        .returning();
      await db.insert(schema.photoRefs).values({
        id,
        photoId: photo.id,
        providerId: provider.id,
        storageRef: '',
        status: 'failed',
        retryCount,
      });
    };
    await seedRef('one-below-ceiling', MAX_RETRY_COUNT - 1);
    await seedRef('at-ceiling', MAX_RETRY_COUNT);

    const queued = (await photoRefRepository.findPendingOrFailed(100)).map((r) => r.id);

    expect(queued).toContain('one-below-ceiling');
    expect(queued).not.toContain('at-ceiling');
  });
});
