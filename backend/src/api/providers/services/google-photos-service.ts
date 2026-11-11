/**
 * Stores VROOM photos in the user's Google Photos library. The Library API is append-only, photos-only
 * and album-based, and its baseUrls expire after about 60 minutes, so URLs are re-fetched when used.
 */

import type { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import { SyncError, SyncErrorCode } from '../../../errors';

const PHOTOS_API = 'https://photoslibrary.googleapis.com';
export const VROOM_ALBUM_TITLE = 'VROOM';

export interface PhotosMediaItem {
  id: string;
  filename?: string;
  baseUrl?: string;
  mimeType?: string;
}

export interface PhotosAlbum {
  id: string;
  title?: string;
}

export interface PhotosSearchPage {
  items: PhotosMediaItem[];
  nextPageToken?: string;
}

/** Injectable HTTP surface of the Library API so tests can run with no network. */
export interface PhotosClient {
  uploadBytes(buffer: Buffer, mimeType: string, fileName: string): Promise<string>;
  batchCreate(albumId: string, uploadToken: string, fileName: string): Promise<PhotosMediaItem>;
  getMediaItem(mediaItemId: string): Promise<PhotosMediaItem>;
  downloadMediaItem(mediaItemId: string): Promise<Buffer>;
  listAlbums(): Promise<PhotosAlbum[]>;
  createAlbum(title: string): Promise<PhotosAlbum>;
  /**
   * Optional: the real client omits it because the read needs an OAuth scope that is not yet requested.
   * Callers must handle its absence.
   */
  searchMediaItems?(albumId: string, pageToken?: string): Promise<PhotosSearchPage>;
}

export class GooglePhotosService {
  private client: PhotosClient;
  private albumId: string | undefined;

  constructor(refreshToken: string, client?: PhotosClient, albumId?: string) {
    this.client = client ?? createRealPhotosClient(refreshToken);
    this.albumId = albumId;
  }

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

  async uploadImage(buffer: Buffer, mimeType: string, fileName: string): Promise<PhotosMediaItem> {
    const albumId = await this.resolveAlbumId();
    const uploadToken = await this.client.uploadBytes(buffer, mimeType, fileName);
    const item = await this.client.batchCreate(albumId, uploadToken, fileName);
    if (!item.id) {
      throw new SyncError(SyncErrorCode.NETWORK_ERROR, 'Google Photos returned no media item id');
    }
    return item;
  }

  async getFreshUrl(mediaItemId: string): Promise<string | null> {
    const item = await this.client.getMediaItem(mediaItemId);
    return item.baseUrl ?? null;
  }

  async download(mediaItemId: string): Promise<Buffer> {
    return this.client.downloadMediaItem(mediaItemId);
  }

  /**
   * Lists only items VROOM uploaded, never the camera roll. Throws when the read is unavailable rather
   * than returning an empty list, so the caller can report the real cause.
   */
  async listReceiptPhotos(maxItems: number): Promise<PhotosMediaItem[]> {
    if (!this.client.searchMediaItems) {
      throw new SyncError(
        SyncErrorCode.AUTH_INVALID,
        'Reading photos requires the Google Photos read permission, which is not enabled yet'
      );
    }
    const albumId = await this.resolveAlbumId();
    const items: PhotosMediaItem[] = [];
    let pageToken: string | undefined;
    do {
      const page = await this.client.searchMediaItems(albumId, pageToken);
      for (const item of page.items) {
        items.push(item);
        if (items.length >= maxItems) return items;
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    return items;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.listAlbums();
      return true;
    } catch {
      return false;
    }
  }
}

/** Uses fetch rather than the googleapis SDK because the Library API upload is a raw bytes POST. */
export function createRealPhotosClient(refreshToken: string): PhotosClient {
  const oauth2Client: OAuth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  async function accessToken(): Promise<string> {
    const { token } = await oauth2Client.getAccessToken();
    if (!token)
      throw new SyncError(SyncErrorCode.AUTH_INVALID, 'Failed to obtain Google access token');
    return token;
  }

  async function authedFetch(url: string, init: RequestInit): Promise<Response> {
    const token = await accessToken();
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    const res = await fetch(url, { ...init, headers });
    if (!res.ok) {
      throw new SyncError(
        res.status === 401 || res.status === 403
          ? SyncErrorCode.AUTH_INVALID
          : SyncErrorCode.NETWORK_ERROR,
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
        // Raw upload headers rule out authedFetch, so this repeats its 401/403 → AUTH_INVALID mapping.
        // Otherwise an expired token is retried as a network error.
        throw new SyncError(
          res.status === 401 || res.status === 403
            ? SyncErrorCode.AUTH_INVALID
            : SyncErrorCode.NETWORK_ERROR,
          `Google Photos upload failed: ${res.status}`
        );
      }
      return res.text();
    },

    async batchCreate(albumId, uploadToken, fileName) {
      const res = await authedFetch(`${PHOTOS_API}/v1/mediaItems:batchCreate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          albumId,
          newMediaItems: [{ description: fileName, simpleMediaItem: { fileName, uploadToken } }],
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
      const res = await authedFetch(`${PHOTOS_API}/v1/mediaItems/${mediaItemId}`, {
        method: 'GET',
      });
      return (await res.json()) as PhotosMediaItem;
    },

    async downloadMediaItem(mediaItemId) {
      const res = await authedFetch(`${PHOTOS_API}/v1/mediaItems/${mediaItemId}`, {
        method: 'GET',
      });
      const item = (await res.json()) as PhotosMediaItem;
      if (!item.baseUrl) {
        throw new SyncError(SyncErrorCode.NETWORK_ERROR, 'Media item has no baseUrl');
      }
      // `=d` returns the original bytes rather than a resized rendition.
      const bytes = await fetch(`${item.baseUrl}=d`);
      if (!bytes.ok) {
        throw new SyncError(
          SyncErrorCode.NETWORK_ERROR,
          `Google Photos download failed: ${bytes.status}`
        );
      }
      return Buffer.from(await bytes.arrayBuffer());
    },

    async listAlbums() {
      const res = await authedFetch(
        `${PHOTOS_API}/v1/albums?pageSize=50&excludeNonAppCreatedData=true`,
        {
          method: 'GET',
        }
      );
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

    async searchMediaItems(albumId, pageToken) {
      // Needs the app-created-data read scope; the API then returns only items VROOM uploaded.
      const res = await authedFetch(`${PHOTOS_API}/v1/mediaItems:search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          albumId,
          pageSize: 100,
          ...(pageToken ? { pageToken } : {}),
        }),
      });
      const data = (await res.json()) as {
        mediaItems?: PhotosMediaItem[];
        nextPageToken?: string;
      };
      return { items: data.mediaItems ?? [], nextPageToken: data.nextPageToken };
    },
  };
}
