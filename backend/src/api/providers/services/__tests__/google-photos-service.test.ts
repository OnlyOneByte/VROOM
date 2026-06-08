/**
 * GooglePhotosService against an in-memory fake PhotosClient (injected via the
 * constructor seam — NO mock.module). Exercises the real service logic: album
 * resolve-or-create + caching, 2-step upload, fresh-URL fetch, download, and
 * error/resilience paths — all zero-network.
 *
 * Pattern doc: .kiro/steering/TestingExternalAPIs.md
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { GooglePhotosService, VROOM_ALBUM_TITLE } from '../google-photos-service';
import {
  FakePhotosStore,
  makeFakePhotosClient,
  photosApiError,
} from '../../../../test-helpers/fake-google-photos-client';

let store: FakePhotosStore;
let svc: GooglePhotosService;

beforeEach(() => {
  store = new FakePhotosStore();
  svc = new GooglePhotosService('fake-refresh-token', makeFakePhotosClient(store));
});

describe('GooglePhotosService — album resolution', () => {
  test('creates the VROOM album when none exists, and caches the id', async () => {
    const id = await svc.resolveAlbumId();
    expect(id).toBeTruthy();
    expect([...store.albums.values()].some((a) => a.title === VROOM_ALBUM_TITLE)).toBe(true);
    expect(svc.cachedAlbumId).toBe(id);
  });

  test('reuses an existing VROOM album instead of creating a duplicate', async () => {
    const seeded = store.seedAlbum(VROOM_ALBUM_TITLE);
    const id = await svc.resolveAlbumId();
    expect(id).toBe(seeded);
    const vroomAlbums = [...store.albums.values()].filter((a) => a.title === VROOM_ALBUM_TITLE);
    expect(vroomAlbums).toHaveLength(1);
  });

  test('a constructor-cached album id skips the resolve round-trip', async () => {
    const cached = new GooglePhotosService('t', makeFakePhotosClient(store), 'album-cached');
    expect(await cached.resolveAlbumId()).toBe('album-cached');
    expect(store.albums.size).toBe(0); // never listed or created
  });
});

describe('GooglePhotosService — upload', () => {
  test('2-step upload stores bytes and returns a media item with a baseUrl', async () => {
    const bytes = Buffer.from('jpeg-bytes');
    const item = await svc.uploadImage(bytes, 'image/jpeg', 'car.jpg');

    expect(item.id).toBeTruthy();
    expect(item.baseUrl).toContain(item.id);
    const stored = store.media.get(item.id);
    expect(stored?.bytes.equals(bytes)).toBe(true);
    expect(stored?.mimeType).toBe('image/jpeg');
  });

  test('upload consumes the upload token (no orphaned pending tokens)', async () => {
    await svc.uploadImage(Buffer.from('x'), 'image/png', 'a.png');
    expect(store.uploadTokens.size).toBe(0);
  });
});

describe('GooglePhotosService — read', () => {
  test('getFreshUrl returns a current baseUrl for a stored item', async () => {
    const item = await svc.uploadImage(Buffer.from('x'), 'image/jpeg', 'a.jpg');
    const url = await svc.getFreshUrl(item.id);
    expect(url).toContain(item.id);
  });

  test('download round-trips the uploaded bytes', async () => {
    const bytes = Buffer.from([1, 2, 3, 4]);
    const item = await svc.uploadImage(bytes, 'image/jpeg', 'a.jpg');
    expect((await svc.download(item.id)).equals(bytes)).toBe(true);
  });

  test('healthCheck is true when albums list, false when it errors', async () => {
    expect(await svc.healthCheck()).toBe(true);
    store.injectFault('listAlbums', photosApiError(401, 'Invalid Credentials'));
    expect(await svc.healthCheck()).toBe(false);
  });
});

describe('GooglePhotosService — error/resilience paths', () => {
  test('a 429 on batchCreate surfaces from uploadImage', async () => {
    store.injectFault('batchCreate', photosApiError(429, 'Rate limit exceeded'));
    await expect(svc.uploadImage(Buffer.from('x'), 'image/jpeg', 'a.jpg')).rejects.toThrow(
      'Rate limit exceeded'
    );
  });

  test('a 403 on album listing propagates (caller decides)', async () => {
    store.injectFault('listAlbums', photosApiError(403, 'Forbidden'));
    await expect(svc.resolveAlbumId()).rejects.toThrow('Forbidden');
  });

  test('fault is consumed once — the next upload succeeds', async () => {
    store.injectFault('uploadBytes', photosApiError(429, 'slow down'), 1);
    await expect(svc.uploadImage(Buffer.from('x'), 'image/jpeg', 'a.jpg')).rejects.toThrow('slow down');
    const ok = await svc.uploadImage(Buffer.from('y'), 'image/jpeg', 'b.jpg');
    expect(ok.id).toBeTruthy();
  });
});
