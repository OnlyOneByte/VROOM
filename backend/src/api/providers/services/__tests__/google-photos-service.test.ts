import { beforeEach, describe, expect, test } from 'bun:test';
import { SyncErrorCode } from '../../../../errors';
import {
  FakePhotosStore,
  makeFakePhotosClient,
  photosApiError,
} from '../../../../test-helpers/fake-google-photos-client';
import {
  classifyPhotosApiError,
  GooglePhotosService,
  listAllAlbums,
  MAX_RECEIPT_SEARCH_PAGES,
  VROOM_ALBUM_TITLE,
} from '../google-photos-service';

let store: FakePhotosStore;
let svc: GooglePhotosService;

beforeEach(() => {
  store = new FakePhotosStore();
  svc = new GooglePhotosService('fake-refresh-token', makeFakePhotosClient(store));
});

describe('GooglePhotosService — album resolution', () => {
  test('creates the VROOM album when none exists', async () => {
    const id = await svc.resolveAlbumId();
    expect(id).toBeTruthy();
    expect([...store.albums.values()].some((a) => a.title === VROOM_ALBUM_TITLE)).toBe(true);
  });

  test('caches the resolved album id, so later calls skip the album lookup', async () => {
    const id = await svc.resolveAlbumId();
    store.injectFault('listAlbums', photosApiError(500, 'album lookup should be cached'));
    expect(await svc.resolveAlbumId()).toBe(id);
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
    expect(store.albums.size).toBe(0);
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
    store.injectFault('listAlbums', photosApiError(500, 'Backend Error'));
    expect(await svc.healthCheck()).toBe(false);
    store.injectFault('listAlbums', photosApiError(401, 'Invalid Credentials'));
    await expect(svc.healthCheck()).rejects.toMatchObject({ code: SyncErrorCode.AUTH_INVALID });
  });
});

describe('GooglePhotosService — receipt listing', () => {
  test('skipped photos do not use up the limit, so later pages are read', async () => {
    const ids = store.seedSearchablePhotos(
      Array.from({ length: 30 }, () => ({})),
      10
    );
    const imported = new Set(ids.slice(0, 25));
    const listed = await svc.listReceiptPhotos(5, async (id) => imported.has(id));
    expect(listed.map((p) => p.id)).toEqual(ids.slice(25));
  });

  test('paging stops after a bounded number of pages', async () => {
    store.seedSearchablePhotos(
      Array.from({ length: MAX_RECEIPT_SEARCH_PAGES + 5 }, () => ({})),
      1
    );
    let looked = 0;
    const listed = await svc.listReceiptPhotos(100, async () => {
      looked++;
      return true;
    });
    expect(listed).toEqual([]);
    expect(looked).toBe(MAX_RECEIPT_SEARCH_PAGES);
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
    await expect(svc.uploadImage(Buffer.from('x'), 'image/jpeg', 'a.jpg')).rejects.toThrow(
      'slow down'
    );
    const ok = await svc.uploadImage(Buffer.from('y'), 'image/jpeg', 'b.jpg');
    expect(ok.id).toBeTruthy();
  });
});

describe('Google Photos API errors', () => {
  test('a 401 is a sign-in failure', () => {
    expect(classifyPhotosApiError(401, 'unauthenticated').code).toBe(SyncErrorCode.AUTH_INVALID);
  });

  test('a quota or rate-limit 403, or a 429, is retryable quota, not a reconnect', () => {
    const quota = '{"error":{"code":403,"status":"RESOURCE_EXHAUSTED","message":"Quota exceeded"}}';
    expect(classifyPhotosApiError(403, quota).code).toBe(SyncErrorCode.QUOTA_EXCEEDED);
    expect(classifyPhotosApiError(403, 'rateLimitExceeded').code).toBe(
      SyncErrorCode.QUOTA_EXCEEDED
    );
    expect(classifyPhotosApiError(429, 'too many requests').code).toBe(
      SyncErrorCode.QUOTA_EXCEEDED
    );
  });

  test('any other 403 is a permission failure', () => {
    const denied = '{"error":{"code":403,"status":"PERMISSION_DENIED"}}';
    expect(classifyPhotosApiError(403, denied).code).toBe(SyncErrorCode.PERMISSION_DENIED);
  });

  test('a 403 that only mentions a quota project is a permission failure, not throttling', () => {
    const body =
      '{"error":{"code":403,"status":"PERMISSION_DENIED","message":"This API requires a quota project"}}';
    expect(classifyPhotosApiError(403, body).code).toBe(SyncErrorCode.PERMISSION_DENIED);
  });

  test('a newer RATE_LIMIT_EXCEEDED reason is throttling', () => {
    const body = '{"error":{"code":403,"details":[{"reason":"RATE_LIMIT_EXCEEDED"}]}}';
    expect(classifyPhotosApiError(403, body).code).toBe(SyncErrorCode.QUOTA_EXCEEDED);
  });

  test('other statuses are network errors', () => {
    expect(classifyPhotosApiError(500, 'oops').code).toBe(SyncErrorCode.NETWORK_ERROR);
  });
});

describe('listing Google Photos albums', () => {
  test('follows nextPageToken until the last page', async () => {
    const pages: Record<
      string,
      { albums: { id: string; title: string }[]; nextPageToken?: string }
    > = {
      first: { albums: [{ id: 'a1', title: 'A' }], nextPageToken: 'p2' },
      p2: { albums: [{ id: 'a2', title: 'B' }], nextPageToken: 'p3' },
      p3: { albums: [{ id: 'a3', title: 'C' }] },
    };
    const asked: (string | undefined)[] = [];
    const albums = await listAllAlbums(async (token) => {
      asked.push(token);
      return pages[token ?? 'first'];
    });
    expect(albums.map((a) => a.id)).toEqual(['a1', 'a2', 'a3']);
    expect(asked).toEqual([undefined, 'p2', 'p3']);
  });

  test('stops after a bounded number of pages if the token never ends', async () => {
    let calls = 0;
    await listAllAlbums(async () => {
      calls++;
      return { albums: [], nextPageToken: 'again' };
    });
    expect(calls).toBe(100);
  });
});
