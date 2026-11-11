// In-memory fake of the Google Photos client surface. Inject it into GooglePhotosService to run real service
// logic with no network and no mock.module.

import type {
  PhotosAlbum,
  PhotosClient,
  PhotosMediaItem,
  PhotosSearchPage,
} from '../api/providers/services/google-photos-service';

interface StoredMedia {
  id: string;
  filename: string;
  mimeType: string;
  albumId: string;
  bytes: Buffer;
}

interface FaultRule {
  method: string;
  error: Error;
  remaining: number;
}

export function photosApiError(
  code: number,
  message: string
): Error & { code: number; status: number } {
  const err = new Error(message) as Error & { code: number; status: number };
  err.code = code;
  err.status = code;
  return err;
}

// Shared backing store for the fake Photos client. Create one per test.
export class FakePhotosStore {
  albums = new Map<string, PhotosAlbum>();
  media = new Map<string, StoredMedia>();
  // Consumed by batchCreate.
  uploadTokens = new Map<string, { bytes: Buffer; mimeType: string; fileName: string }>();
  private idCounter = 0;
  private faults: FaultRule[] = [];

  nextId(prefix: string): string {
    this.idCounter += 1;
    return `${prefix}-${this.idCounter}`;
  }

  injectFault(method: string, error: Error, times = 1): void {
    this.faults.push({ method, error, remaining: times });
  }

  maybeFail(method: string): void {
    const rule = this.faults.find((f) => f.method === method && f.remaining > 0);
    if (rule) {
      rule.remaining -= 1;
      throw rule.error;
    }
  }

  seedAlbum(title: string): string {
    const id = this.nextId('album');
    this.albums.set(id, { id, title });
    return id;
  }

  // Scripts the items searchMediaItems returns, paged by pageSize. Each item is also stored, so download() resolves it.
  seedSearchablePhotos(
    specs: Array<{ filename?: string; mimeType?: string; bytes?: Buffer }>,
    pageSize = specs.length || 1
  ): string[] {
    const ids: string[] = [];
    for (const spec of specs) {
      const id = this.nextId('media');
      const mimeType = spec.mimeType ?? 'image/jpeg';
      this.media.set(id, {
        id,
        filename: spec.filename ?? `${id}.jpg`,
        mimeType,
        albumId: 'searchable',
        bytes: spec.bytes ?? Buffer.from(`bytes-${id}`),
      });
      ids.push(id);
    }
    this.searchPageSize = Math.max(1, pageSize);
    this.searchableIds = ids;
    return ids;
  }

  searchableIds: string[] = [];
  searchPageSize = 1;
}

export function makeFakePhotosClient(store: FakePhotosStore): PhotosClient {
  const baseUrlFor = (id: string) => `https://photos.fake/${id}`;

  return {
    uploadBytes(buffer, mimeType, fileName) {
      store.maybeFail('uploadBytes');
      const token = store.nextId('uploadtoken');
      store.uploadTokens.set(token, { bytes: buffer, mimeType, fileName });
      return Promise.resolve(token);
    },

    batchCreate(albumId, uploadToken, fileName) {
      store.maybeFail('batchCreate');
      const pending = store.uploadTokens.get(uploadToken);
      if (!pending) {
        return Promise.reject(photosApiError(400, `Unknown upload token: ${uploadToken}`));
      }
      store.uploadTokens.delete(uploadToken);
      const id = store.nextId('media');
      store.media.set(id, {
        id,
        filename: fileName,
        mimeType: pending.mimeType,
        albumId,
        bytes: pending.bytes,
      });
      return Promise.resolve({
        id,
        filename: fileName,
        baseUrl: baseUrlFor(id),
        mimeType: pending.mimeType,
      } satisfies PhotosMediaItem);
    },

    getMediaItem(mediaItemId) {
      store.maybeFail('getMediaItem');
      const m = store.media.get(mediaItemId);
      if (!m) return Promise.reject(photosApiError(404, `Media item not found: ${mediaItemId}`));
      // A FRESH baseUrl each call — models the real API's expiring URLs.
      return Promise.resolve({
        id: m.id,
        filename: m.filename,
        baseUrl: baseUrlFor(m.id),
        mimeType: m.mimeType,
      } satisfies PhotosMediaItem);
    },

    downloadMediaItem(mediaItemId) {
      store.maybeFail('downloadMediaItem');
      const m = store.media.get(mediaItemId);
      if (!m) return Promise.reject(photosApiError(404, `Media item not found: ${mediaItemId}`));
      return Promise.resolve(m.bytes);
    },

    listAlbums() {
      store.maybeFail('listAlbums');
      return Promise.resolve([...store.albums.values()]);
    },

    createAlbum(title) {
      store.maybeFail('createAlbum');
      const id = store.nextId('album');
      const album: PhotosAlbum = { id, title };
      store.albums.set(id, album);
      return Promise.resolve(album);
    },

    searchMediaItems(_albumId, pageToken) {
      store.maybeFail('searchMediaItems');
      // pageToken is the offset into the seeded id list (absent → start at 0); page by searchPageSize.
      const start = pageToken ? Number.parseInt(pageToken, 10) : 0;
      const end = start + store.searchPageSize;
      const pageIds = store.searchableIds.slice(start, end);
      const items: PhotosMediaItem[] = pageIds.map((id) => {
        const m = store.media.get(id);
        return {
          id,
          filename: m?.filename,
          baseUrl: `https://photos.fake/${id}`,
          mimeType: m?.mimeType,
        } satisfies PhotosMediaItem;
      });
      const page: PhotosSearchPage = { items };
      if (end < store.searchableIds.length) page.nextPageToken = String(end);
      return Promise.resolve(page);
    },
  };
}
