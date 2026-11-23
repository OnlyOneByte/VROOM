import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { UserProvider } from '../../../../../db/schema';
import { createTestApp, json, type TestApp } from '../../../../../test-helpers/http-client';
import { storePending } from '../../../../../utils/pending-credentials';
import { FakeStorageProvider } from '../fake-provider';
import {
  getStorageProviderRegistry,
  STORAGE_PROVIDERS,
  type StorageProviderDescriptor,
} from '../registry';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

describe('storage provider descriptors', () => {
  test('a new type registered only in STORAGE_PROVIDERS is built by the registry', () => {
    const instance = new FakeStorageProvider();
    const providers = STORAGE_PROVIDERS as unknown as Record<string, StorageProviderDescriptor>;
    providers.webdav = {
      credentialKind: 'none',
      create: () => instance,
      defaultFolders: STORAGE_PROVIDERS.fake.defaultFolders,
    };
    try {
      const row = { id: 'p-webdav', providerType: 'webdav', credentials: '', config: null };
      const built = getStorageProviderRegistry().createProviderInstance(
        row as unknown as UserProvider
      );
      expect(built).toBe(instance);
    } finally {
      delete providers.webdav;
    }
  });

  test('an unknown type is still refused', () => {
    const row = { id: 'p-x', providerType: 'dropbox', credentials: '', config: null };
    expect(() =>
      getStorageProviderRegistry().createProviderInstance(row as unknown as UserProvider)
    ).toThrow('Unsupported provider type: dropbox');
  });

  test('Google Photos cannot be created through the API, even with a connected Google account', async () => {
    const nonce = '5b8f2c1e-3d4a-4b6c-9e7f-1a2b3c4d5e6f';
    storePending(ctx.user.id, nonce, 'refresh-tok', 'me@example.com');

    const res = await ctx.authed('POST', '/api/v1/providers', {
      domain: 'storage',
      providerType: 'google-photos',
      displayName: 'My photos',
      credentials: {},
      nonce,
    });

    const body = await json<{ error: { message: string } }>(res);
    expect(res.status).toBe(400);
    expect(JSON.stringify(body)).toContain('Provider type must be one of');
    expect(ctx.sqlite.query('SELECT COUNT(*) AS n FROM user_providers').get()).toEqual({ n: 0 });
  });
});
