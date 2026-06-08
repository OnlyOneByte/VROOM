/**
 * In-memory fake of the Google Photos {@link PhotosClient} surface. Inject into
 * GooglePhotosService (constructor seam) to drive the real service logic — album
 * resolve-or-create, 2-step upload, fresh-URL fetch, download — with ZERO network
 * and no `mock.module`, per .kiro/steering/TestingExternalAPIs.md.
 *
 * Determinism: ids are a monotonic counter, baseUrls embed the id. Resilience:
 * {@link FakePhotosStore.injectFault} makes the Nth call to a method throw a
 * Gaxios-shaped error so tests can assert how the service handles 401/403/429.
 */

import type {
  PhotosAlbum,
  PhotosClient,
  PhotosMediaItem,
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

export function photosApiError(code: number, message: string): Error & { code: number; status: number } {
  const err = new Error(message) as Error & { code: number; status: number };
  err.code = code;
  err.status = code;
  return err;
}

/** Shared backing store for the fake Photos client. One per test for isolation. */
export class FakePhotosStore {
  albums = new Map<string, PhotosAlbum>();
  media = new Map<string, StoredMedia>();
  /** Pending upload tokens → bytes, consumed by batchCreate. */
  uploadTokens = new Map<string, { bytes: Buffer; mimeType: string; fileName: string }>();
  private idCounter = 0;
  private faults: FaultRule[] = [];

  nextId(prefix: string): string {
    this.idCounter += 1;
    return `${prefix}-${this.idCounter}`;
  }

  /** Arm the next `times` call(s) to `method` (e.g. 'batchCreate') to throw `error`. */
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

  /** Seed an album directly (bypasses the API) — e.g. a pre-existing VROOM album. */
  seedAlbum(title: string): string {
    const id = this.nextId('album');
    this.albums.set(id, { id, title });
    return id;
  }
}

/** Build a fake {@link PhotosClient} backed by `store`. */
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
  };
}
