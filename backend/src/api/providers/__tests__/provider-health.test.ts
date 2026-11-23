import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { Photo, PhotoRef } from '../../../db/schema';
import { SyncError, SyncErrorCode } from '../../../errors';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { FakeStorageProvider } from '../domains/storage/fake-provider';
import { getStorageProviderRegistry } from '../domains/storage/registry';
import { FAILURES_BEFORE_ERROR, type HealthResult } from '../provider-status';
import { processBatch, type SyncWorkerDeps } from '../sync-worker';

let ctx: TestApp;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  ctx.close();
});

interface StatusRow {
  status: string;
  last_error_code: string | null;
  last_checked_at: number | null;
  last_sync_at: number | null;
  failure_count: number;
}

function statusOf(id: string): StatusRow {
  return ctx.sqlite
    .query(
      'SELECT status, last_error_code, last_checked_at, last_sync_at, failure_count FROM user_providers WHERE id = ?'
    )
    .get(id) as StatusRow;
}

function seedStorage(id: string, status = 'active'): void {
  ctx.sqlite.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, config, status)
     VALUES (?, ?, 'storage', 'fake', ?, '', '{}', ?)`,
    [id, ctx.user.id, id, status]
  );
}

async function createModel(domain: 'llm' | 'vlm'): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/providers', {
    domain,
    providerType: 'openai-compatible',
    displayName: domain,
    credentials: { apiKey: 'sk-test' },
    config: { model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1' },
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return (await json<DataEnvelope<{ id: string }>>(res)).data.id;
}

function answerModelCalls(status: number): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'OK' } }] }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch;
}

async function testProvider(id: string): Promise<{ status: number; data: HealthResult }> {
  const res = await ctx.authed('POST', `/api/v1/providers/${id}/test`);
  return { status: res.status, data: (await json<DataEnvelope<HealthResult>>(res)).data };
}

describe('the photo sync worker records what it learns about a provider', () => {
  function deps(upload: () => Promise<unknown>): SyncWorkerDeps {
    const provider = {
      type: 'fake',
      download: () => Promise.resolve(Buffer.from('x')),
      upload,
      delete: () => Promise.resolve(),
    };
    const ref = { id: 'ref-1', photoId: 'photo-1', providerId: 'prov-dst', status: 'pending' };
    return {
      photoRefRepository: {
        findPendingOrFailed: () => Promise.resolve([ref as PhotoRef]),
        findActiveByPhoto: () =>
          Promise.resolve({ ...ref, id: 'src', providerId: 'prov-src', status: 'active' }),
        updateStatus: () => Promise.resolve(),
      },
      photoRepository: {
        findById: () =>
          Promise.resolve({ id: 'photo-1', entityType: 'vehicle', fileName: 'a.jpg' } as Photo),
      },
      registry: {
        getProviderInternal: () => Promise.resolve(provider),
        resolveProviderFolderPath: () => Promise.resolve(''),
      },
    } as unknown as SyncWorkerDeps;
  }

  beforeEach(() => {
    seedStorage('prov-src');
    seedStorage('prov-dst');
  });

  test('an AUTH_INVALID upload marks the target needs_reauth, and leaves the source alone', async () => {
    await processBatch(
      deps(() => Promise.reject(new SyncError(SyncErrorCode.AUTH_INVALID, 'token revoked')))
    );
    expect(statusOf('prov-dst')).toMatchObject({
      status: 'needs_reauth',
      last_error_code: 'auth',
      failure_count: 1,
    });
    expect(statusOf('prov-dst').last_checked_at).not.toBeNull();
    expect(statusOf('prov-src')).toMatchObject({ status: 'active', last_error_code: null });
  });

  test('a successful upload writes last_sync_at and clears an earlier error', async () => {
    ctx.sqlite.run(
      "UPDATE user_providers SET status = 'needs_reauth', last_error_code = 'auth', failure_count = 2 WHERE id = 'prov-dst'"
    );
    await processBatch(deps(() => Promise.resolve({ providerType: 'fake', externalId: 'new' })));
    expect(statusOf('prov-dst')).toMatchObject({
      status: 'active',
      last_error_code: null,
      failure_count: 0,
    });
    expect(statusOf('prov-dst').last_sync_at).not.toBeNull();
  });
});

describe('POST /providers/:id/test works for every capability', () => {
  test('storage: a healthy provider reports Connected and stays active', async () => {
    const config = (await import('../../../config')).CONFIG as {
      allowFakeStorageProvider: boolean;
    };
    const allowed = config.allowFakeStorageProvider;
    config.allowFakeStorageProvider = true;
    try {
      seedStorage('s-ok');
      const result = await testProvider('s-ok');
      expect(result).toEqual({ status: 200, data: { ok: true, message: 'Connected' } });
      expect(statusOf('s-ok').last_checked_at).not.toBeNull();
    } finally {
      config.allowFakeStorageProvider = allowed;
    }
  });

  test(`storage: a provider that fails ${FAILURES_BEFORE_ERROR} checks in a row turns error, and a passing check brings it back`, async () => {
    const fake = new FakeStorageProvider();
    const health = spyOn(fake, 'healthCheck').mockResolvedValue(false);
    const built = spyOn(getStorageProviderRegistry(), 'createProviderInstance').mockReturnValue(
      fake
    );
    try {
      seedStorage('s-down');
      for (let i = 1; i <= FAILURES_BEFORE_ERROR; i++) {
        const result = await testProvider('s-down');
        expect(result.data).toMatchObject({ ok: false, code: 'unreachable' });
        expect(statusOf('s-down').status).toBe(i < FAILURES_BEFORE_ERROR ? 'active' : 'error');
      }
      health.mockResolvedValue(true);
      expect((await testProvider('s-down')).data.ok).toBe(true);
      expect(statusOf('s-down')).toMatchObject({ status: 'active', failure_count: 0 });
    } finally {
      built.mockRestore();
    }
  });

  test.each(['llm', 'vlm'] as const)(
    '%s: a 200 from the model is Connected, a 401 is auth and needs_reauth',
    async (domain) => {
      const id = await createModel(domain);
      answerModelCalls(200);
      expect((await testProvider(id)).data).toEqual({ ok: true, message: 'Connected' });
      answerModelCalls(401);
      expect((await testProvider(id)).data).toMatchObject({ ok: false, code: 'auth' });
      expect(statusOf(id)).toMatchObject({ status: 'needs_reauth', last_error_code: 'auth' });
    }
  );

  test('a provider whose stored secret cannot be read needs reconnecting', async () => {
    const id = await createModel('llm');
    ctx.sqlite.run("UPDATE user_providers SET credentials = 'garbage' WHERE id = ?", [id]);
    expect((await testProvider(id)).data).toMatchObject({ ok: false, code: 'auth' });
    expect(statusOf(id).status).toBe('needs_reauth');
  });

  test('a turned-off provider keeps its status whatever the check says', async () => {
    seedStorage('s-off', 'disabled');
    const built = spyOn(getStorageProviderRegistry(), 'createProviderInstance').mockReturnValue(
      new FakeStorageProvider()
    );
    try {
      await testProvider('s-off');
      expect(statusOf('s-off').status).toBe('disabled');
    } finally {
      built.mockRestore();
    }
  });

  test('responses carry the status fields', async () => {
    seedStorage('s-list');
    ctx.sqlite.run(
      "UPDATE user_providers SET status = 'needs_reauth', last_error_code = 'auth', last_checked_at = 1000 WHERE id = 's-list'"
    );
    const list = (
      await json<DataEnvelope<Record<string, unknown>[]>>(
        await ctx.authed('GET', '/api/v1/providers')
      )
    ).data;
    expect(list.find((p) => p.id === 's-list')).toMatchObject({
      status: 'needs_reauth',
      lastErrorCode: 'auth',
      lastCheckedAt: new Date(1000 * 1000).toISOString(),
    });
  });
});
