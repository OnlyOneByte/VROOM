/**
 * GoogleDriveProvider tests — exercises the REAL provider against a REAL
 * GoogleDriveService wired to an in-memory fake Drive client (injected via the
 * constructor seam). No `mock.module` here: the old version stubbed the service
 * AND re-registered a 100-line re-implementation of the provider, which (a) only
 * tested the copy, and (b) leaked process-global stubs into sibling test files.
 * Injection tests the actual shipping code and leaks nothing.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import {
  FakeGoogleStore,
  googleApiError,
  idOf,
  makeFakeDrive,
} from '../../../test-helpers/fake-google-clients';
import { GoogleDriveProvider } from '../domains/storage/google-drive-provider';
import type { StorageRef } from '../domains/storage/storage-provider';
import { GoogleDriveService } from '../services/google-drive-service';

let store: FakeGoogleStore;
let provider: GoogleDriveProvider;

beforeEach(() => {
  store = new FakeGoogleStore();
  const driveService = new GoogleDriveService('fake-refresh-token', makeFakeDrive(store));
  provider = new GoogleDriveProvider('fake-refresh-token', driveService);
});

describe('GoogleDriveProvider', () => {
  test('type is google-drive', () => {
    expect(provider.type).toBe('google-drive');
  });

  describe('upload', () => {
    test('walks the path, creating missing folders, and uploads into the leaf', async () => {
      const result = await provider.upload({
        fileName: 'car.jpg',
        buffer: Buffer.from('image-data'),
        mimeType: 'image/jpeg',
        entityType: 'vehicle',
        entityId: 'v-1',
        pathHint: 'VROOM/Vehicle',
      });

      expect(result.providerType).toBe('google-drive');
      expect(result.externalId).toBeTruthy();
      expect(result.externalUrl).toContain(result.externalId);

      // The file landed in the VROOM/Vehicle leaf with the right bytes.
      const vroom = store.childrenOf('').find((f) => f.name === 'VROOM');
      const vehicle = store.childrenOf(idOf(vroom)).find((f) => f.name === 'Vehicle');
      const uploaded = store.files.get(result.externalId);
      expect(uploaded?.parents).toEqual([idOf(vehicle)]);
      expect(uploaded?.content.toString()).toBe('image-data');
    });

    test('reuses existing folders when all path segments already exist', async () => {
      const vroom = store.seedFolder('VROOM');
      const receipts = store.seedFolder('Receipts', vroom);

      const result = await provider.upload({
        fileName: 'receipt.pdf',
        buffer: Buffer.from('pdf-data'),
        mimeType: 'application/pdf',
        entityType: 'expense',
        entityId: 'e-1',
        pathHint: 'VROOM/Receipts',
      });

      // No duplicate folders were created.
      expect(store.childrenOf('').filter((f) => f.name === 'VROOM')).toHaveLength(1);
      expect(store.childrenOf(vroom).filter((f) => f.name === 'Receipts')).toHaveLength(1);
      expect(store.files.get(result.externalId)?.parents).toEqual([receipts]);
    });

    test('rawPath takes precedence over pathHint', async () => {
      const result = await provider.upload({
        fileName: 'backup.zip',
        buffer: Buffer.from('zip'),
        mimeType: 'application/zip',
        entityType: 'backup',
        entityId: 'u-1',
        pathHint: 'IGNORED',
        rawPath: 'VROOM/Backups',
      });
      const vroom = store.childrenOf('').find((f) => f.name === 'VROOM');
      const backups = store.childrenOf(idOf(vroom)).find((f) => f.name === 'Backups');
      expect(store.files.get(result.externalId)?.parents).toEqual([idOf(backups)]);
      expect(store.childrenOf('').some((f) => f.name === 'IGNORED')).toBe(false);
    });

    test('empty pathHint uploads to root', async () => {
      const result = await provider.upload({
        fileName: 'file.jpg',
        buffer: Buffer.from('data'),
        mimeType: 'image/jpeg',
        entityType: 'vehicle',
        entityId: 'v-1',
        pathHint: '',
      });
      expect(store.files.get(result.externalId)?.parents).toEqual([]);
    });
  });

  describe('download', () => {
    test('returns the uploaded bytes by externalId', async () => {
      const up = await provider.upload({
        fileName: 'blob.bin',
        buffer: Buffer.from([9, 8, 7]),
        mimeType: 'application/octet-stream',
        entityType: 'vehicle',
        entityId: 'v-1',
        pathHint: '',
      });
      const ref: StorageRef = { providerType: 'google-drive', externalId: up.externalId };
      expect((await provider.download(ref)).equals(Buffer.from([9, 8, 7]))).toBe(true);
    });
  });

  describe('delete', () => {
    test('removes the file by externalId', async () => {
      const up = await provider.upload({
        fileName: 'temp.zip',
        buffer: Buffer.from('x'),
        mimeType: 'application/zip',
        entityType: 'backup',
        entityId: 'u-1',
        pathHint: '',
      });
      await provider.delete({ providerType: 'google-drive', externalId: up.externalId });
      expect(store.files.has(up.externalId)).toBe(false);
    });
  });

  describe('getExternalUrl', () => {
    test('returns externalUrl when present, null when absent', async () => {
      expect(
        await provider.getExternalUrl({
          providerType: 'google-drive',
          externalId: 'f',
          externalUrl: 'https://drive.google.com/file/d/f/view',
        })
      ).toBe('https://drive.google.com/file/d/f/view');
      expect(
        await provider.getExternalUrl({ providerType: 'google-drive', externalId: 'f' })
      ).toBeNull();
    });
  });

  describe('list', () => {
    test('lists files in an existing folder path', async () => {
      const vroom = store.seedFolder('VROOM');
      const backups = store.seedFolder('Backups', vroom);
      store.seedFile({ name: 'a.zip', mimeType: 'application/zip', parentId: backups });
      store.seedFile({ name: 'b.zip', mimeType: 'application/zip', parentId: backups });

      const files = await provider.list('VROOM/Backups');
      expect(files.map((f) => f.name).sort()).toEqual(['a.zip', 'b.zip']);
    });

    test('returns [] when the folder path does not exist', async () => {
      expect(await provider.list('VROOM/Nope')).toEqual([]);
    });
  });

  describe('healthCheck', () => {
    test('true when Drive is reachable (folder absent is still healthy)', async () => {
      expect(await provider.healthCheck()).toBe(true);
    });

    test('false when the Drive API errors', async () => {
      store.injectFault('files.list', googleApiError(401, 'Invalid Credentials'));
      expect(await provider.healthCheck()).toBe(false);
    });
  });
});
