import type { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import { CONFIG } from '../../../config';
import { SyncError, SyncErrorCode } from '../../../errors';
import { OPERATION_TIMEOUTS } from '../../../utils/timeout';
import {
  credentialFailureOf,
  type DownloadOptions,
  readWithinSize,
} from '../domains/storage/storage-provider';

const PHOTOS_API = 'https://photoslibrary.googleapis.com';
export const VROOM_ALBUM_TITLE = 'VROOM';
export const MAX_RECEIPT_SEARCH_PAGES = 20;

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

export interface PhotosClient {
  uploadBytes(buffer: Buffer, mimeType: string, fileName: string): Promise<string>;
  batchCreate(albumId: string, uploadToken: string, fileName: string): Promise<PhotosMediaItem>;
  getMediaItem(mediaItemId: string): Promise<PhotosMediaItem>;
  downloadMediaItem(mediaItemId: string, options?: DownloadOptions): Promise<Buffer>;
  listAlbums(): Promise<PhotosAlbum[]>;
  createAlbum(title: string): Promise<PhotosAlbum>;
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

  async download(mediaItemId: string, options?: DownloadOptions): Promise<Buffer> {
    return this.client.downloadMediaItem(mediaItemId, options);
  }

  async listReceiptPhotos(
    maxItems: number,
    skip: (photoId: string) => Promise<boolean> = async () => false
  ): Promise<PhotosMediaItem[]> {
    if (!this.client.searchMediaItems) {
      throw new SyncError(
        SyncErrorCode.AUTH_INVALID,
        'Reading photos requires the Google Photos read permission, which is not enabled yet'
      );
    }
    const albumId = await this.resolveAlbumId();
    const items: PhotosMediaItem[] = [];
    let pageToken: string | undefined;
    for (let pages = 0; pages < MAX_RECEIPT_SEARCH_PAGES; pages++) {
      const page = await this.client.searchMediaItems(albumId, pageToken);
      for (const item of page.items) {
        if (await skip(item.id)) continue;
        items.push(item);
        if (items.length >= maxItems) return items;
      }
      pageToken = page.nextPageToken;
      if (!pageToken) break;
    }
    return items;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.listAlbums();
      return true;
    } catch (error) {
      const credentialFailure = credentialFailureOf(error);
      if (credentialFailure) throw credentialFailure;
      return false;
    }
  }
}

interface AlbumPage {
  albums?: PhotosAlbum[];
  nextPageToken?: string;
}

const MAX_ALBUM_PAGES = 100;

export async function listAllAlbums(
  fetchPage: (pageToken: string | undefined) => Promise<AlbumPage>
): Promise<PhotosAlbum[]> {
  const albums: PhotosAlbum[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_ALBUM_PAGES; page++) {
    const result = await fetchPage(pageToken);
    albums.push(...(result.albums ?? []));
    pageToken = result.nextPageToken;
    if (!pageToken) break;
  }
  return albums;
}

const QUOTA_REASONS =
  /RESOURCE_EXHAUSTED|RATE_LIMIT_EXCEEDED|rateLimitExceeded|userRateLimitExceeded|quotaExceeded/;

export function classifyPhotosApiError(status: number, body: string): SyncError {
  const message = `Google Photos API ${status}: ${body}`;
  if (status === 401) return new SyncError(SyncErrorCode.AUTH_INVALID, message);
  if (status === 429 || (status === 403 && QUOTA_REASONS.test(body))) {
    return new SyncError(SyncErrorCode.QUOTA_EXCEEDED, message);
  }
  if (status === 403) return new SyncError(SyncErrorCode.PERMISSION_DENIED, message);
  return new SyncError(SyncErrorCode.NETWORK_ERROR, message);
}

// Library API upload is a raw bytes POST, so this uses fetch rather than the googleapis SDK.
function createRealPhotosClient(refreshToken: string): PhotosClient {
  const oauth2Client: OAuth2Client = new google.auth.OAuth2(
    CONFIG.auth.googleClientId,
    CONFIG.auth.googleClientSecret,
    CONFIG.auth.googleStorageRedirectUri
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
    const res = await fetch(url, {
      ...init,
      headers,
      signal: AbortSignal.timeout(OPERATION_TIMEOUTS.DOWNLOAD),
    });
    if (!res.ok) {
      throw classifyPhotosApiError(res.status, await res.text().catch(() => res.statusText));
    }
    return res;
  }

  return {
    async uploadBytes(buffer, mimeType, fileName) {
      const token = await accessToken();
      const res = await fetch(`${PHOTOS_API}/v1/uploads`, {
        signal: AbortSignal.timeout(OPERATION_TIMEOUTS.DOWNLOAD),
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
        throw classifyPhotosApiError(res.status, await res.text().catch(() => res.statusText));
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

    async downloadMediaItem(mediaItemId, options) {
      const res = await authedFetch(`${PHOTOS_API}/v1/mediaItems/${mediaItemId}`, {
        method: 'GET',
      });
      const item = (await res.json()) as PhotosMediaItem;
      if (!item.baseUrl) {
        throw new SyncError(SyncErrorCode.NETWORK_ERROR, 'Media item has no baseUrl');
      }
      // Google Photos '=d' suffix returns the original bytes, not a resized rendition.
      const bytes = await fetch(`${item.baseUrl}=d`, {
        signal: AbortSignal.timeout(OPERATION_TIMEOUTS.DOWNLOAD),
      });
      if (!bytes.ok) {
        throw new SyncError(
          SyncErrorCode.NETWORK_ERROR,
          `Google Photos download failed: ${bytes.status}`
        );
      }
      if (options?.maxBytes === undefined || !bytes.body) {
        return Buffer.from(await bytes.arrayBuffer());
      }
      const declared = Number(bytes.headers.get('content-length') ?? 0);
      const body = bytes.body;
      return readWithinSize(body, declared, options, () => void body.cancel().catch(() => {}));
    },

    listAlbums() {
      return listAllAlbums(async (pageToken) => {
        const params = new URLSearchParams({ pageSize: '50', excludeNonAppCreatedData: 'true' });
        if (pageToken) params.set('pageToken', pageToken);
        const res = await authedFetch(`${PHOTOS_API}/v1/albums?${params}`, { method: 'GET' });
        return (await res.json()) as AlbumPage;
      });
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
      // Listing needs the app-created-data scope; it returns only items VROOM uploaded.
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
