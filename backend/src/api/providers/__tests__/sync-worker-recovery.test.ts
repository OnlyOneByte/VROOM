import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { Photo, PhotoRef } from '../../../db/schema';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';
import { photoRefRepository } from '../../photos/photo-ref-repository';
import { processBatch, type SyncWorkerDeps } from '../sync-worker';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
  for (const id of ['prov-target', 'prov-source']) {
    ctx.sqlite.run(
      `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, status, updated_at)
       VALUES (?, ?, 'storage', 'fake', ?, 'x', 'active', 1000)`,
      [id, ctx.user.id, id]
    );
  }
  ctx.sqlite.run(
    `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('veh-r', ?, 'Seat', 'Ibiza', 2015)`,
    [ctx.user.id]
  );
  ctx.sqlite.run(
    `INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size)
     VALUES ('photo-r', ?, 'vehicle', 'veh-r', 'a.jpg', 'image/jpeg', 1)`,
    [ctx.user.id]
  );
  ctx.sqlite.run(
    `INSERT INTO photo_refs (id, photo_id, provider_id, storage_ref, status, retry_count, synced_at, created_at)
     VALUES ('ref-source', 'photo-r', 'prov-source', 'file-1', 'active', 0, 900, 900),
            ('ref-dead', 'photo-r', 'prov-target', '', 'failed', 3, 2000, 900)`
  );
});
afterEach(() => ctx.close());

async function queuedIds(): Promise<string[]> {
  return (await photoRefRepository.findPendingOrFailed(50)).map((ref) => ref.id);
}

describe('photo refs that ran out of retries come back after a reconnect', () => {
  test('a ref past its retry limit stays out of the queue while nothing changed', async () => {
    expect(await queuedIds()).toEqual([]);
  });

  test('reconnecting the target provider puts it back in the queue', async () => {
    ctx.sqlite.run("UPDATE user_providers SET updated_at = 3000 WHERE id = 'prov-target'");
    expect(await queuedIds()).toEqual(['ref-dead']);
  });

  test('reconnecting the provider holding the source copy puts it back in the queue', async () => {
    ctx.sqlite.run("UPDATE user_providers SET updated_at = 3000 WHERE id = 'prov-source'");
    expect(await queuedIds()).toEqual(['ref-dead']);
  });

  test('backfill resets the provider’s failed refs to pending with no retries', async () => {
    const res = await ctx.authed('POST', '/api/v1/providers/prov-target/backfill');
    expect(res.status).toBeLessThan(300);
    expect(
      ctx.sqlite.query("SELECT status, retry_count FROM photo_refs WHERE id = 'ref-dead'").get()
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
        getProviderInternal: () => Promise.resolve(provider),
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
