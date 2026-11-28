import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { repos } from '../../../app-context';
import type { Photo, PhotoRef } from '../../../db/schema';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../../test-helpers/http-client';
import { processBatch, type SyncWorkerDeps } from '../sync-worker';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
  for (const id of ['prov-target', 'prov-source']) {
    await ctx.sql.run(
      `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, status, updated_at)
       VALUES (?, ?, 'storage', 'fake', ?, 'x', 'active', 1000)`,
      [id, ctx.user.id, id]
    );
  }
  await ctx.sql.run(
    `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('veh-r', ?, 'Seat', 'Ibiza', 2015)`,
    [ctx.user.id]
  );
  await ctx.sql.run(
    `INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size)
     VALUES ('photo-r', ?, 'vehicle', 'veh-r', 'a.jpg', 'image/jpeg', 1)`,
    [ctx.user.id]
  );
  await ctx.sql.run(
    `INSERT INTO photo_refs (id, photo_id, provider_id, storage_ref, status, retry_count, synced_at, created_at)
     VALUES ('ref-source', 'photo-r', 'prov-source', 'file-1', 'active', 0, 900, 900),
            ('ref-dead', 'photo-r', 'prov-target', '', 'failed', 3, 2000, 900)`
  );
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

async function queuedIds(): Promise<string[]> {
  return (await repos().photoRefs.findPendingOrFailed(50)).map((ref) => ref.id);
}

describe('photo refs that ran out of retries come back after a reconnect', () => {
  test('a ref past its retry limit stays out of the queue while nothing changed', async () => {
    expect(await queuedIds()).toEqual([]);
  });

  test('reconnecting the target provider puts it back in the queue', async () => {
    await ctx.sql.run("UPDATE user_providers SET updated_at = 3100 WHERE id = 'prov-target'");
    expect(await queuedIds()).toEqual(['ref-dead']);
  });

  test('reconnecting the provider holding the source copy puts it back in the queue', async () => {
    await ctx.sql.run("UPDATE user_providers SET updated_at = 3200 WHERE id = 'prov-source'");
    expect(await queuedIds()).toEqual(['ref-dead']);
  });

  test('a revived ref skipped by the worker is offered again on the next poll', async () => {
    await ctx.sql.run("UPDATE user_providers SET updated_at = 3300 WHERE id = 'prov-target'");
    expect(await queuedIds()).toEqual(['ref-dead']);
    expect(await queuedIds(), 'still queued until a sync attempt records a new failure').toEqual([
      'ref-dead',
    ]);

    await ctx.sql.run("UPDATE photo_refs SET synced_at = 3400 WHERE id = 'ref-dead'");
    expect(await queuedIds()).toEqual([]);
  });

  test('backfill resets the provider’s failed refs to pending with no retries', async () => {
    const res = await ctx.authed('POST', '/api/v1/providers/prov-target/backfill');
    expect(res.status).toBeLessThan(300);
    expect(
      await ctx.sql.get("SELECT status, retry_count FROM photo_refs WHERE id = 'ref-dead'")
    ).toEqual({ status: 'pending', retry_count: 0 });
  });
});

describe('photo sync worker liveness', () => {
  const ref = (): PhotoRef =>
    ({
      id: 'ref-x',
      photoId: 'photo-x',
      providerId: 'prov-target',
      storageRef: '',
      externalUrl: null,
      status: 'pending',
      errorMessage: null,
      retryCount: 0,
      syncedAt: null,
      createdAt: new Date(0),
    }) as PhotoRef;

  function deps(overrides: {
    download?: () => Promise<Buffer>;
    findPending?: () => Promise<PhotoRef[]>;
    updates?: unknown[];
  }): SyncWorkerDeps {
    const provider = {
      type: 'fake',
      download: overrides.download ?? (() => Promise.resolve(Buffer.from('x'))),
      upload: () => Promise.resolve({ providerType: 'fake', externalId: 'new' }),
      delete: () => Promise.resolve(),
    };
    return {
      photoRefRepository: {
        findPendingOrFailed: overrides.findPending ?? (() => Promise.resolve([ref()])),
        findActiveByPhoto: () => Promise.resolve({ ...ref(), id: 'src', status: 'active' }),
        updateStatus: (_id: string, update: unknown) => {
          overrides.updates?.push(update);
          return Promise.resolve();
        },
      },
      photoRepository: {
        findById: () =>
          Promise.resolve({ id: 'photo-x', entityType: 'vehicle', fileName: 'a.jpg' } as Photo),
      },
      registry: {
        getProvider: () => Promise.resolve(provider),
        resolveProviderFolderPath: () => Promise.resolve(''),
      },
    } as unknown as SyncWorkerDeps;
  }

  test('a hung download times out and the ref is recorded as failed', async () => {
    const timeoutModule = await import('../../../utils/timeout');
    const spy = spyOn(timeoutModule, 'withTimeout').mockImplementation(
      <T>(_work: Promise<T>, _ms: number, label?: string) =>
        Promise.reject(new Error(`${label} timed out`)) as Promise<T>
    );
    const updates: unknown[] = [];
    try {
      await processBatch(deps({ download: () => new Promise<Buffer>(() => {}), updates }));
    } finally {
      spy.mockRestore();
    }
    expect(updates).toEqual([
      expect.objectContaining({ status: 'failed', errorMessage: 'Photo sync download timed out' }),
    ]);
  });

  test('a batch superseded by the watchdog stops instead of syncing refs the new batch took', async () => {
    const clock = spyOn(Date, 'now').mockReturnValue(5_000_000);
    const two = (): PhotoRef[] => [ref(), { ...ref(), id: 'ref-y', photoId: 'photo-y' }];
    let releaseFirstDownload: () => void = () => {};
    let downloads = 0;
    const uploads: string[] = [];
    const sharedDeps = deps({
      findPending: () => Promise.resolve(two()),
      download: () => {
        downloads++;
        return downloads === 1
          ? new Promise<Buffer>((resolve) => {
              releaseFirstDownload = () => resolve(Buffer.from('late'));
            })
          : Promise.resolve(Buffer.from('x'));
      },
    });
    const registry = sharedDeps.registry as unknown as {
      getProvider: () => Promise<{ upload: (input: { entityId?: string }) => unknown }>;
    };
    const provider = await registry.getProvider();
    const originalUpload = provider.upload;
    provider.upload = (input) => {
      uploads.push(String((input as { fileName?: string }).fileName ?? 'file'));
      return originalUpload(input);
    };
    registry.getProvider = () => Promise.resolve(provider);
    try {
      const first = processBatch(sharedDeps);
      await new Promise((resolve) => setTimeout(resolve, 0));

      const { OPERATION_TIMEOUTS } = await import('../../../utils/timeout');
      clock.mockReturnValue(5_000_000 + 3 * OPERATION_TIMEOUTS.DOWNLOAD + 1);
      await processBatch(sharedDeps);
      expect(uploads, 'the new batch skips the in-flight ref and syncs the other').toHaveLength(1);

      releaseFirstDownload();
      await first;
      expect(uploads, 'the superseded batch finishes its ref but syncs nothing more').toHaveLength(
        2
      );
    } finally {
      clock.mockRestore();
    }
  });

  test('a batch stuck past the watchdog does not block the next one forever', async () => {
    const clock = spyOn(Date, 'now').mockReturnValue(1_000_000);
    let calls = 0;
    const hung = deps({
      findPending: () => {
        calls++;
        return new Promise<PhotoRef[]>(() => {});
      },
    });
    try {
      void processBatch(hung);
      await processBatch(hung);
      expect(calls, 'a second batch inside the watchdog window is skipped').toBe(1);

      const { OPERATION_TIMEOUTS } = await import('../../../utils/timeout');
      clock.mockReturnValue(1_000_000 + 3 * OPERATION_TIMEOUTS.DOWNLOAD + 1);
      void processBatch(hung);
      expect(calls, 'past the watchdog a new batch starts').toBe(2);
    } finally {
      clock.mockRestore();
    }
  });
});
