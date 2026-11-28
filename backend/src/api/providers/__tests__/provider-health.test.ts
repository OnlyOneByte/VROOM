import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { Photo, PhotoRef } from '../../../db/schema';
import { SyncError, SyncErrorCode } from '../../../errors';
import {
  createTestApp,
  type DataEnvelope,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { FakeStorageProvider } from '../domains/storage/fake-provider';
import { getStorageProviderRegistry } from '../domains/storage/registry';
import { credentialFailureOf, ProviderConfigError } from '../domains/storage/storage-provider';
import { FAILURES_BEFORE_ERROR, type HealthResult } from '../provider-status';
import { processBatch, type SyncWorkerDeps } from '../sync-worker';

let ctx: TestApp;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
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

async function statusOf(id: string): Promise<StatusRow> {
  return (await ctx.sql.get(
    'SELECT status, last_error_code, last_checked_at, last_sync_at, failure_count FROM user_providers WHERE id = ?',
    [id]
  )) as StatusRow;
}

async function seedStorage(id: string, status = 'active'): Promise<void> {
  await ctx.sql.run(
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
  function deps(
    upload: () => Promise<unknown>,
    download: () => Promise<Buffer> = () => Promise.resolve(Buffer.from('x'))
  ): SyncWorkerDeps {
    const provider = {
      type: 'fake',
      download,
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
        getProvider: () => Promise.resolve(provider),
        resolveProviderFolderPath: () => Promise.resolve(''),
      },
    } as unknown as SyncWorkerDeps;
  }

  beforeEach(async () => {
    await seedStorage('prov-src');
    await seedStorage('prov-dst');
  });

  test('an AUTH_INVALID upload marks the target needs_reauth, and leaves the source alone', async () => {
    await processBatch(
      deps(() => Promise.reject(new SyncError(SyncErrorCode.AUTH_INVALID, 'token revoked')))
    );
    expect(await statusOf('prov-dst')).toMatchObject({
      status: 'needs_reauth',
      last_error_code: 'auth',
      failure_count: 1,
    });
    expect((await statusOf('prov-dst')).last_checked_at).not.toBeNull();
    expect(await statusOf('prov-src')).toMatchObject({ status: 'active', last_error_code: null });
  });

  test('a PERMISSION_DENIED download marks the source, not the target, and leaves updated_at alone', async () => {
    const updatedAt = async () =>
      await ctx.sql.all('SELECT id, updated_at FROM user_providers ORDER BY id');
    const before = await updatedAt();
    await processBatch(
      deps(
        () => Promise.resolve({ providerType: 'fake', externalId: 'new' }),
        () => Promise.reject(new SyncError(SyncErrorCode.PERMISSION_DENIED, 'no access'))
      )
    );
    expect(await statusOf('prov-src')).toMatchObject({
      status: 'needs_reauth',
      last_error_code: 'permission',
    });
    expect(await statusOf('prov-dst')).toMatchObject({ status: 'active', last_checked_at: null });
    expect(await updatedAt()).toEqual(before);
  });

  test('a successful upload writes last_sync_at and clears an earlier error', async () => {
    await ctx.sql.run(
      "UPDATE user_providers SET status = 'needs_reauth', last_error_code = 'auth', failure_count = 2 WHERE id = 'prov-dst'"
    );
    await processBatch(deps(() => Promise.resolve({ providerType: 'fake', externalId: 'new' })));
    expect(await statusOf('prov-dst')).toMatchObject({
      status: 'active',
      last_error_code: null,
      failure_count: 0,
    });
    expect((await statusOf('prov-dst')).last_sync_at).not.toBeNull();
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
      await seedStorage('s-ok');
      const result = await testProvider('s-ok');
      expect(result).toEqual({ status: 200, data: { ok: true, message: 'Connected' } });
      expect((await statusOf('s-ok')).last_checked_at).not.toBeNull();
    } finally {
      config.allowFakeStorageProvider = allowed;
    }
  });

  test(`storage: a provider that fails ${FAILURES_BEFORE_ERROR} checks in a row turns error, and a passing check brings it back`, async () => {
    const fake = new FakeStorageProvider();
    const health = spyOn(fake, 'healthCheck').mockResolvedValue(false);
    const built = spyOn(getStorageProviderRegistry(), 'createProviderInstance').mockResolvedValue(
      fake
    );
    try {
      await seedStorage('s-down');
      for (let i = 1; i <= FAILURES_BEFORE_ERROR; i++) {
        const result = await testProvider('s-down');
        expect(result.data).toMatchObject({ ok: false, code: 'unreachable' });
        expect((await statusOf('s-down')).status).toBe(
          i < FAILURES_BEFORE_ERROR ? 'active' : 'error'
        );
      }
      health.mockResolvedValue(true);
      expect((await testProvider('s-down')).data.ok).toBe(true);
      expect(await statusOf('s-down')).toMatchObject({ status: 'active', failure_count: 0 });
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
      expect(await statusOf(id)).toMatchObject({ status: 'needs_reauth', last_error_code: 'auth' });
    }
  );

  test('a provider whose stored secret cannot be read needs reconnecting', async () => {
    const id = await createModel('llm');
    await ctx.sql.run("UPDATE user_providers SET credentials = 'garbage' WHERE id = ?", [id]);
    expect((await testProvider(id)).data).toMatchObject({ ok: false, code: 'auth' });
    expect((await statusOf(id)).status).toBe('needs_reauth');
  });

  test('a turned-off provider keeps its status whatever the check says', async () => {
    await seedStorage('s-off', 'disabled');
    const built = spyOn(getStorageProviderRegistry(), 'createProviderInstance').mockResolvedValue(
      new FakeStorageProvider()
    );
    try {
      await testProvider('s-off');
      expect((await statusOf('s-off')).status).toBe('disabled');
    } finally {
      built.mockRestore();
    }
  });

  test('responses carry the status fields', async () => {
    await seedStorage('s-list');
    await ctx.sql.run(
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

  test('a storage check the vendor rejects reads as auth, not unreachable', async () => {
    const fake = new FakeStorageProvider();
    spyOn(fake, 'healthCheck').mockRejectedValue(
      credentialFailureOf(Object.assign(new Error('bad key'), { name: 'InvalidAccessKeyId' }))
    );
    const built = spyOn(getStorageProviderRegistry(), 'createProviderInstance').mockResolvedValue(
      fake
    );
    try {
      await seedStorage('s-key');
      expect((await testProvider('s-key')).data).toMatchObject({ ok: false, code: 'auth' });
      expect((await statusOf('s-key')).status).toBe('needs_reauth');
    } finally {
      built.mockRestore();
    }
  });

  test('a storage settings problem reads as config and keeps its own message', async () => {
    const fake = new FakeStorageProvider();
    spyOn(fake, 'healthCheck').mockRejectedValue(
      new ProviderConfigError(
        'The bucket "b" doesn\'t exist. Check the bucket name, then test again.'
      )
    );
    const built = spyOn(getStorageProviderRegistry(), 'createProviderInstance').mockResolvedValue(
      fake
    );
    try {
      await seedStorage('s-config');
      expect((await testProvider('s-config')).data).toMatchObject({
        ok: false,
        code: 'config',
        message: 'The bucket "b" doesn\'t exist. Check the bucket name, then test again.',
      });
      expect((await statusOf('s-config')).status).not.toBe('needs_reauth');
    } finally {
      built.mockRestore();
    }
  });

  test('an endpoint the server refuses answers 400 and is recorded as an endpoint problem', async () => {
    const { encrypt } = await import('../../../utils/encryption');
    await ctx.sql.run(
      `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, config, status)
       VALUES ('s-bad', ?, 'storage', 's3', 'S3', ?, ?, 'active')`,
      [
        ctx.user.id,
        encrypt(JSON.stringify({ accessKeyId: 'a', secretAccessKey: 'b' }), {
          rowId: 's-bad',
          userId: ctx.user.id,
          domain: 'storage',
        }),
        JSON.stringify({ endpoint: 'http://169.254.169.254', bucket: 'b', region: 'r' }),
      ]
    );
    const res = await ctx.authed('POST', '/api/v1/providers/s-bad/test');
    expect(res.status).toBe(400);
    expect(await statusOf('s-bad')).toMatchObject({
      last_error_code: 'endpoint',
      failure_count: 1,
    });
  });

  test('sign-in providers cannot be tested', async () => {
    await ctx.sql.run(
      `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, status)
       VALUES ('a-login', ?, 'auth', 'google', 'Google', '', 'active')`,
      [ctx.user.id]
    );
    expect((await ctx.authed('POST', '/api/v1/providers/a-login/test')).status).toBe(400);
  });
});

describe('reconnecting clears a provider that needs it', () => {
  test('saving new credentials returns a needs_reauth provider to active', async () => {
    const id = await createModel('llm');
    await ctx.sql.run(
      "UPDATE user_providers SET status = 'needs_reauth', last_error_code = 'auth', failure_count = 2 WHERE id = ?",
      [id]
    );
    const res = await ctx.authed('PUT', `/api/v1/providers/${id}`, {
      credentials: { apiKey: 'sk-new' },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await statusOf(id)).toMatchObject({
      status: 'active',
      last_error_code: null,
      failure_count: 0,
    });
  });

  test('saving new credentials forgets the last check, so they read as not checked yet', async () => {
    const id = await createModel('llm');
    await ctx.sql.run(
      "UPDATE user_providers SET last_error_code = 'unreachable', failure_count = 1, last_checked_at = 1000 WHERE id = ?",
      [id]
    );
    const res = await ctx.authed('PUT', `/api/v1/providers/${id}`, {
      credentials: { apiKey: 'sk-new' },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await statusOf(id)).toMatchObject({ status: 'active', last_checked_at: null });
  });

  test('reconnecting Google forgets the last check, so the new grant reads as not checked yet', async () => {
    const { googleStorageClient } = await import('../../auth/providers/google');
    await ctx.sql.run(
      `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, config, status, last_error_code, failure_count, last_checked_at)
       VALUES ('g-drive', ?, 'storage', 'google-drive', 'Drive', 'x', '{}', 'needs_reauth', 'auth', 2, 1000)`,
      [ctx.user.id]
    );
    const exchange = spyOn(googleStorageClient, 'validateAuthorizationCode').mockResolvedValue({
      accessToken: () => 'access',
      hasRefreshToken: () => true,
      refreshToken: () => 'refresh',
      hasScopes: () => true,
      scopes: () => [],
    } as unknown as Awaited<ReturnType<typeof googleStorageClient.validateAuthorizationCode>>);
    globalThis.fetch = (async () =>
      Response.json({ email: 'me@example.com', email_verified: true })) as unknown as typeof fetch;
    try {
      const start = await ctx.authed(
        'GET',
        '/api/v1/auth/providers/connect/google?returnTo=%2Fsettings&nonce=n-1&providerId=g-drive'
      );
      const state = new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? '';
      const done = await ctx.authed(
        'GET',
        `/api/v1/auth/callback/provider/google?code=c&state=${encodeURIComponent(state)}`
      );
      const location = new URL(done.headers.get('location') ?? '');
      expect(location.searchParams.get('provider_connected')).toBe('true');
      expect(await statusOf('g-drive')).toMatchObject({
        status: 'active',
        last_error_code: null,
        failure_count: 0,
        last_checked_at: null,
      });
    } finally {
      exchange.mockRestore();
    }
  });

  test('a turned-off provider stays turned off when its credentials change', async () => {
    const id = await createModel('llm');
    await ctx.sql.run("UPDATE user_providers SET status = 'disabled' WHERE id = ?", [id]);
    await ctx.authed('PUT', `/api/v1/providers/${id}`, { credentials: { apiKey: 'sk-new' } });
    expect((await statusOf(id)).status).toBe('disabled');
  });
});

describe('credentialFailureOf reads vendor errors', () => {
  test.each([
    ['an S3 InvalidAccessKeyId', { name: 'InvalidAccessKeyId' }, SyncErrorCode.AUTH_INVALID],
    ['an S3 SignatureDoesNotMatch', { name: 'SignatureDoesNotMatch' }, SyncErrorCode.AUTH_INVALID],
    ['an S3 AccessDenied', { name: 'AccessDenied' }, SyncErrorCode.PERMISSION_DENIED],
    ['a Google 401', { response: { status: 401 } }, SyncErrorCode.AUTH_INVALID],
    ['a Google invalid_grant', { message: 'invalid_grant' }, SyncErrorCode.AUTH_INVALID],
    ['a Google 403', { response: { status: 403 } }, SyncErrorCode.PERMISSION_DENIED],
    ['an AWS 403 status', { $metadata: { httpStatusCode: 403 } }, SyncErrorCode.PERMISSION_DENIED],
    [
      'a Google 403 for missing permissions',
      {
        response: {
          status: 403,
          data: { error: { errors: [{ reason: 'insufficientPermissions' }] } },
        },
      },
      SyncErrorCode.PERMISSION_DENIED,
    ],
    [
      'a non-Google 403 that mentions a quota',
      { message: 'quota policy denies this', response: { status: 403 } },
      SyncErrorCode.PERMISSION_DENIED,
    ],
  ])('%s', (_label, error, code) => {
    expect(credentialFailureOf(Object.assign(new Error('x'), error))?.code).toBe(code);
  });

  test.each([
    ['a network error', Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' })],
    ['a 500', Object.assign(new Error('x'), { response: { status: 500 } })],
    [
      'a Google 403 for a rate limit',
      Object.assign(new Error('Forbidden'), {
        response: {
          status: 403,
          data: { error: { errors: [{ reason: 'userRateLimitExceeded' }] } },
        },
      }),
    ],
    [
      'a Google 403 for a full storage quota',
      Object.assign(new Error('Forbidden'), {
        response: { status: 403 },
        errors: [{ reason: 'storageQuotaExceeded' }],
      }),
    ],
    ['a non-error', 'boom'],
  ])('%s is not a credential failure', (_label, error) => {
    expect(credentialFailureOf(error)).toBeNull();
  });
});
