import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { UserProvider } from '../../../../../db/schema';
import {
  createTestApp,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../../../test-helpers/http-client';
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
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

describe('storage provider descriptors', () => {
  test('a new type registered only in STORAGE_PROVIDERS is built by the registry', () => {
    const instance = new FakeStorageProvider();
    const providers = STORAGE_PROVIDERS as unknown as Record<string, StorageProviderDescriptor>;
    providers.webdav = { ...STORAGE_PROVIDERS.fake, label: 'WebDAV', create: () => instance };
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

  test('Google Photos can be created once a Google account is connected for it', async () => {
    const nonce = '5b8f2c1e-3d4a-4b6c-9e7f-1a2b3c4d5e6f';
    storePending(ctx.user.id, nonce, 'refresh-tok', 'me@example.com', 'google-photos');

    const res = await ctx.authed('POST', '/api/v1/providers', {
      domain: 'storage',
      providerType: 'google-photos',
      displayName: 'My photos',
      credentials: {},
      nonce,
    });

    expect(res.status).toBe(201);
    expect(
      ctx.sqlite
        .query(
          "SELECT provider_type AS type, json_extract(config, '$.accountEmail') AS email FROM user_providers"
        )
        .get()
    ).toEqual({ type: 'google-photos', email: 'me@example.com' });
  });

  test('a Google connection made for one provider type cannot create the other', async () => {
    for (const [connectedFor, created] of [
      ['google-drive', 'google-photos'],
      ['google-photos', 'google-drive'],
    ]) {
      const nonce = crypto.randomUUID();
      storePending(ctx.user.id, nonce, 'refresh-tok', 'me@example.com', connectedFor);
      const res = await ctx.authed('POST', '/api/v1/providers', {
        domain: 'storage',
        providerType: created,
        displayName: 'Mixed up',
        credentials: {},
        nonce,
      });
      expect(res.status, `${connectedFor} -> ${created}`).toBe(400);
      expect(await res.text()).toContain('Connect Google again');
    }
    expect(ctx.sqlite.query('SELECT COUNT(*) AS n FROM user_providers').get()).toEqual({ n: 0 });
  });
});
