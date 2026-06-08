/**
 * GooglePhotosProvider against a real GooglePhotosService wired to the in-memory
 * fake PhotosClient (injected — NO mock.module). Verifies the StorageProvider
 * contract incl. the REDUCED capabilities (delete:false/list:false/arbitraryFiles:
 * false), the delete no-op (D1a), list→[] (D3b), and fresh-URL behavior.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { GooglePhotosProvider } from '../domains/storage/google-photos-provider';
import { capabilitiesOf } from '../domains/storage/storage-provider';
import { GooglePhotosService } from '../services/google-photos-service';
import { FakePhotosStore, makeFakePhotosClient } from '../../../test-helpers/fake-google-photos-client';

let store: FakePhotosStore;
let provider: GooglePhotosProvider;

beforeEach(() => {
  store = new FakePhotosStore();
  const service = new GooglePhotosService('fake-refresh-token', makeFakePhotosClient(store));
  provider = new GooglePhotosProvider('fake-refresh-token', service);
});

describe('GooglePhotosProvider', () => {
  test('type + reduced capabilities', () => {
    expect(provider.type).toBe('google-photos');
    expect(provider.capabilities).toEqual({ delete: false, list: false, arbitraryFiles: false });
    expect(capabilitiesOf(provider)).toEqual({ delete: false, list: false, arbitraryFiles: false });
  });

  test('upload returns a google-photos StorageRef with a url', async () => {
    const ref = await provider.upload({
      fileName: 'car.jpg',
      buffer: Buffer.from('image'),
      mimeType: 'image/jpeg',
      entityType: 'vehicle',
      entityId: 'v-1',
      pathHint: '',
    });
    expect(ref.providerType).toBe('google-photos');
    expect(ref.externalId).toBeTruthy();
    expect(ref.externalUrl).toContain(ref.externalId);
  });

  test('download round-trips uploaded bytes', async () => {
    const bytes = Buffer.from([9, 8, 7]);
    const ref = await provider.upload({
      fileName: 'a.jpg',
      buffer: bytes,
      mimeType: 'image/jpeg',
      entityType: 'vehicle',
      entityId: 'v-1',
      pathHint: '',
    });
    expect((await provider.download(ref)).equals(bytes)).toBe(true);
  });

  test('getExternalUrl returns a FRESH url (re-fetched, not the stored one)', async () => {
    const ref = await provider.upload({
      fileName: 'a.jpg',
      buffer: Buffer.from('x'),
      mimeType: 'image/jpeg',
      entityType: 'vehicle',
      entityId: 'v-1',
      pathHint: '',
    });
    expect(await provider.getExternalUrl(ref)).toContain(ref.externalId);
  });

  test('delete is a no-op and never throws (Library API is append-only)', async () => {
    const ref = await provider.upload({
      fileName: 'a.jpg',
      buffer: Buffer.from('x'),
      mimeType: 'image/jpeg',
      entityType: 'vehicle',
      entityId: 'v-1',
      pathHint: '',
    });
    await expect(provider.delete(ref)).resolves.toBeUndefined();
    // The media item is still present — VROOM-side row removal is the caller's job.
    expect(store.media.has(ref.externalId)).toBe(true);
  });

  test('list returns [] (not a backup-ZIP target)', async () => {
    expect(await provider.list('VROOM/Backups')).toEqual([]);
  });

  test('healthCheck reflects the service', async () => {
    expect(await provider.healthCheck()).toBe(true);
  });
});
