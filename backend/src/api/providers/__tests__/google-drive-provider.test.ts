import { beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { PayloadTooLargeError, SyncErrorCode } from '../../../errors';
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
let driveService: GoogleDriveService;
let provider: GoogleDriveProvider;

beforeEach(() => {
  store = new FakeGoogleStore();
  driveService = new GoogleDriveService('fake-refresh-token', makeFakeDrive(store));
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

    test('the top-level folder is looked up in My Drive, not anywhere in the account', async () => {
      const shared = store.seedFolder('Shared stuff');
      const nested = store.seedFolder('VROOM', shared);

      const result = await provider.upload({
        fileName: 'car.jpg',
        buffer: Buffer.from('x'),
        mimeType: 'image/jpeg',
        entityType: 'vehicle',
        entityId: 'v-1',
        pathHint: 'VROOM',
      });

      const topLevel = store.childrenOf('').filter((f) => f.name === 'VROOM');
      expect(topLevel).toHaveLength(1);
      expect(store.files.get(result.externalId)?.parents).toEqual([idOf(topLevel[0])]);
      expect(store.files.get(result.externalId)?.parents).not.toEqual([nested]);
    });

    test('uploads for one account through separate providers share one new folder', async () => {
      const providerFor = () =>
        new GoogleDriveProvider(
          'same-account-token',
          new GoogleDriveService('same-account-token', makeFakeDrive(store))
        );
      const upload = (fileName: string) =>
        providerFor().upload({
          fileName,
          buffer: Buffer.from(fileName),
          mimeType: 'image/jpeg',
          entityType: 'vehicle',
          entityId: 'v-1',
          pathHint: 'VROOM/Vehicle',
        });

      const [a, b] = await Promise.all([upload('a.jpg'), upload('b.jpg')]);

      const vroom = store.childrenOf('').filter((f) => f.name === 'VROOM');
      expect(vroom).toHaveLength(1);
      const vehicle = store.childrenOf(idOf(vroom[0])).filter((f) => f.name === 'Vehicle');
      expect(vehicle).toHaveLength(1);
      expect(store.files.get(a.externalId)?.parents).toEqual([idOf(vehicle[0])]);
      expect(store.files.get(b.externalId)?.parents).toEqual([idOf(vehicle[0])]);
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

    test('refuses a file over maxBytes before downloading its content', async () => {
      const up = await provider.upload({
        fileName: 'big.zip',
        buffer: Buffer.alloc(64),
        mimeType: 'application/zip',
        entityType: 'backup',
        entityId: 'u-1',
        pathHint: '',
      });
      const ref: StorageRef = { providerType: 'google-drive', externalId: up.externalId };
      const content = spyOn(driveService, 'downloadFile');
      await expect(provider.download(ref, { maxBytes: 32 })).rejects.toBeInstanceOf(
        PayloadTooLargeError
      );
      expect(content).not.toHaveBeenCalled();
      expect((await provider.download(ref, { maxBytes: 64 })).length).toBe(64);
      expect(content).toHaveBeenCalledTimes(1);
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
      store.injectFault('files.list', googleApiError(502, 'Bad Gateway'));
      expect(await provider.healthCheck()).toBe(false);
    });

    test('a busy Drive API is passed on, so the check can say busy', async () => {
      store.injectFault('files.list', googleApiError(503, 'Backend Error'));
      await expect(provider.healthCheck()).rejects.toBeDefined();
    });

    test('a rejected token throws AUTH_INVALID, so the check can say to reconnect', async () => {
      store.injectFault('files.list', googleApiError(401, 'Invalid Credentials'));
      await expect(provider.healthCheck()).rejects.toMatchObject({
        code: SyncErrorCode.AUTH_INVALID,
      });
    });
  });
});
