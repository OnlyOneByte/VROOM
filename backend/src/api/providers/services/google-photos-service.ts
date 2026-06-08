/**
 * Google Photos Service — stores VROOM photos in the user's Google Photos library.
 *
 * The Google Photos Library API differs fundamentally from Drive/S3 (see
 * .kiro/specs/google-photos-provider/): it is append-only (no delete of library
 * items), photos/videos only (no PDF), album-based (no folders), and its media
 * `baseUrl`s expire (~60 min) and must be re-fetched. This service exposes only the
 * operations VROOM needs and that the API supports: upload (2-step), get-fresh-url,
 * download, and album resolve-or-create.
 *
 * The HTTP boundary is the injectable {@link PhotosClient} (NOT the `googleapis`
 * typed SDK — the Library API's upload is a raw bytes POST). Inject an in-memory
 * fake in tests (test-helpers/fake-google-photos-client.ts) to exercise the real
 * service logic with ZERO network, per .kiro/steering/TestingExternalAPIs.md.
 */

import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { SyncError, SyncErrorCode } from '../../../errors';

const PHOTOS_API = 'https://photoslibrary.googleapis.com';
/** The single album VROOM creates and uploads into. */
export const VROOM_ALBUM_TITLE = 'VROOM';

export interface PhotosMediaItem {
  id: string;
  filename?: string;
  /** Short-lived (~60 min) — re-fetch via getMediaItem before use. */
  baseUrl?: string;
  mimeType?: string;
}

export interface PhotosAlbum {
  id: string;
  title?: string;
}

/**
 * The thin HTTP surface of the Google Photos Library API that this service uses.
 * The real implementation ({@link createRealPhotosClient}) is an OAuth2-authed
 * fetch wrapper; tests inject an in-memory fake.
 */
export interface PhotosClient {
  /** Upload raw bytes → opaque upload token (step 1 of media creation). */
  uploadBytes(buffer: Buffer, mimeType: string, fileName: string): Promise<string>;
  /** Create a media item from an upload token in an album (step 2). */
  batchCreate(albumId: string, uploadToken: string, fileName: string): Promise<PhotosMediaItem>;
  /** Fetch a media item (used to get a FRESH baseUrl — the stored one expires). */
  getMediaItem(mediaItemId: string): Promise<PhotosMediaItem>;
  /** Download the bytes of a media item (resolves a fresh baseUrl internally). */
  downloadMediaItem(mediaItemId: string): Promise<Buffer>;
  /** List the caller's albums (app-created) — used to find-or-create the VROOM album. */
  listAlbums(): Promise<PhotosAlbum[]>;
  /** Create an album with the given title. */
  createAlbum(title: string): Promise<PhotosAlbum>;
}

export class GooglePhotosService {
  private client: PhotosClient;
  private albumId: string | undefined;

  /**
   * @param refreshToken Google OAuth refresh token (ignored when `client` injected).
   * @param client       Optional pre-built PhotosClient — inject an in-memory fake
   *                      in tests. Production builds an OAuth2-authed real client.
   * @param albumId       Optional cached VROOM album id (from provider `config`) so
   *                      we skip the resolve-or-create round-trip when known.
   */
  constructor(refreshToken: string, client?: PhotosClient, albumId?: string) {
    this.client = client ?? createRealPhotosClient(refreshToken);
    this.albumId = albumId;
  }

  /** Resolve (cache) the VROOM album id, creating the album if it doesn't exist. */
  async resolveAlbumId(): Promise<string> {
    if (this.albumId) return this.albumId;
    const albums = await this.client.listAlbums();
    const existing = albums.find((a) => a.title === VROOM_ALBUM_TITLE);
    const album = existing ?? (await this.client.createAlbum(VROOM_ALBUM_TITLE));
    if (!album.id) {
      throw new SyncError(SyncErrorCode.NETWORK_ERROR, 'Failed to resolve VROOM album');
    }
    this.albumId = album.id;
    return album.id;
  }

  /** Upload an image and return the created media item. */
  async uploadImage(buffer: Buffer, mimeType: string, fileName: string): Promise<PhotosMediaItem> {
    const albumId = await this.resolveAlbumId();
    const uploadToken = await this.client.uploadBytes(buffer, mimeType, fileName);
    const item = await this.client.batchCreate(albumId, uploadToken, fileName);
    if (!item.id) {
      throw new SyncError(SyncErrorCode.NETWORK_ERROR, 'Google Photos returned no media item id');
    }
    return item;
  }

  /** Get a FRESH, currently-valid baseUrl for a media item (the stored one expires). */
  async getFreshUrl(mediaItemId: string): Promise<string | null> {
    const item = await this.client.getMediaItem(mediaItemId);
    return item.baseUrl ?? null;
  }

  /** Download the bytes of a media item. */
  async download(mediaItemId: string): Promise<Buffer> {
    return this.client.downloadMediaItem(mediaItemId);
  }

  /** Cheap connectivity probe — listing albums succeeds when auth is valid. */
  async healthCheck(): Promise<boolean> {
    try {
      await this.client.listAlbums();
      return true;
    } catch {
      return false;
    }
  }

  /** The resolved album id (if any) — providers persist this into `config` to cache it. */
  get cachedAlbumId(): string | undefined {
    return this.albumId;
  }
}

/**
 * Build a real OAuth2-authed PhotosClient. Mirrors GoogleDriveService's OAuth2 setup;
 * the Photos Library API upload is a raw bytes POST, so this uses fetch with a fresh
 * access token from the OAuth2 client rather than the googleapis typed SDK.
 */
export function createRealPhotosClient(refreshToken: string): PhotosClient {
  const oauth2Client: OAuth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  async function accessToken(): Promise<string> {
    const { token } = await oauth2Client.getAccessToken();
    if (!token) throw new SyncError(SyncErrorCode.AUTH_INVALID, 'Failed to obtain Google access token');
    return token;
  }

  async function authedFetch(url: string, init: RequestInit): Promise<Response> {
    const token = await accessToken();
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    const res = await fetch(url, { ...init, headers });
    if (!res.ok) {
      throw new SyncError(
        res.status === 401 || res.status === 403 ? SyncErrorCode.AUTH_INVALID : SyncErrorCode.NETWORK_ERROR,
        `Google Photos API ${res.status}: ${await res.text().catch(() => res.statusText)}`
      );
    }
    return res;
  }

  return {
    async uploadBytes(buffer, mimeType, fileName) {
      const token = await accessToken();
      const res = await fetch(`${PHOTOS_API}/v1/uploads`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/octet-stream',
          'X-Goog-Upload-Content-Type': mimeType,
          'X-Goog-Upload-Protocol': 'raw',
          'X-Goog-Upload-File-Name': fileName,
        },
        body: new Uint8Array(buffer),
      });
      if (!res.ok) {
        throw new SyncError(SyncErrorCode.NETWORK_ERROR, `Google Photos upload failed: ${res.status}`);
      }
      return res.text(); // body IS the upload token
    },

    async batchCreate(albumId, uploadToken, fileName) {
      const res = await authedFetch(`${PHOTOS_API}/v1/mediaItems:batchCreate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          albumId,
          newMediaItems: [
            { description: fileName, simpleMediaItem: { fileName, uploadToken } },
          ],
        }),
      });
      const data = (await res.json()) as {
        newMediaItemResults?: { mediaItem?: PhotosMediaItem; status?: { message?: string } }[];
      };
      const result = data.newMediaItemResults?.[0];
      if (!result?.mediaItem?.id) {
        throw new SyncError(
          SyncErrorCode.NETWORK_ERROR,
          `Google Photos batchCreate failed: ${result?.status?.message ?? 'unknown'}`
        );
      }
      return result.mediaItem;
    },

    async getMediaItem(mediaItemId) {
      const res = await authedFetch(`${PHOTOS_API}/v1/mediaItems/${mediaItemId}`, { method: 'GET' });
      return (await res.json()) as PhotosMediaItem;
    },

    async downloadMediaItem(mediaItemId) {
      const res = await authedFetch(`${PHOTOS_API}/v1/mediaItems/${mediaItemId}`, { method: 'GET' });
      const item = (await res.json()) as PhotosMediaItem;
      if (!item.baseUrl) {
        throw new SyncError(SyncErrorCode.NETWORK_ERROR, 'Media item has no baseUrl');
      }
      // `=d` returns the original bytes (download param).
      const bytes = await fetch(`${item.baseUrl}=d`);
      if (!bytes.ok) {
        throw new SyncError(SyncErrorCode.NETWORK_ERROR, `Google Photos download failed: ${bytes.status}`);
      }
      return Buffer.from(await bytes.arrayBuffer());
    },

    async listAlbums() {
      const res = await authedFetch(`${PHOTOS_API}/v1/albums?pageSize=50&excludeNonAppCreatedData=true`, {
        method: 'GET',
      });
      const data = (await res.json()) as { albums?: PhotosAlbum[] };
      return data.albums ?? [];
    },

    async createAlbum(title) {
      const res = await authedFetch(`${PHOTOS_API}/v1/albums`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ album: { title } }),
      });
      return (await res.json()) as PhotosAlbum;
    },
  };
}
