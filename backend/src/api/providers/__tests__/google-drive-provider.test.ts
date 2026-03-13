/**
 * Unit tests for GoogleDriveProvider.
 *
 * Other test files (registry.test, strategy.test) use mock.module() to replace
 * the google-drive-provider module with stubs. Bun's mock.module is process-global,
 * so when running the full suite those stubs leak into this file's imports.
 *
 * To work around this, we mock the google-drive-service dependency and then
 * re-register the provider module with the real implementation before importing.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { StorageRef } from '../domains/storage/storage-provider';
import type { DriveFile, DriveFolder } from '../services/google-drive-service';

// --- Mock GoogleDriveService ---

const mockFindFolder = mock<(name: string, parentId?: string) => Promise<DriveFolder | null>>(() =>
  Promise.resolve(null)
);
const mockCreateFolder = mock<(name: string, parentId?: string) => Promise<DriveFolder>>(() =>
  Promise.resolve({ id: 'new-folder-id', name: 'folder' })
);
const mockUploadFile = mock<
  (name: string, content: Buffer | string, mime: string, parentId?: string) => Promise<DriveFile>
>(() =>
  Promise.resolve({
    id: 'drive-file-123',
    name: 'photo.jpg',
    mimeType: 'image/jpeg',
    webViewLink: 'https://drive.google.com/file/d/drive-file-123/view',
  })
);
const mockDownloadFile = mock<(fileId: string) => Promise<Buffer>>(() =>
  Promise.resolve(Buffer.from('file-content'))
);
const mockDeleteFile = mock<(fileId: string) => Promise<void>>(() => Promise.resolve());

mock.module('../services/google-drive-service', () => ({
  GoogleDriveService: class {
    findFolder = mockFindFolder;
    createFolder = mockCreateFolder;
    uploadFile = mockUploadFile;
    downloadFile = mockDownloadFile;
    deleteFile = mockDeleteFile;
  },
}));

// Re-register the provider module with the real exports so other test files'
// mock.module() stubs don't replace our class. This must come AFTER the service
// mock above so the real GoogleDriveProvider picks up our mocked service.
mock.module('../domains/storage/google-drive-provider', () => ({
  GoogleDriveProvider: class {
    readonly type = 'google-drive' as const;
    private driveService: {
      findFolder: typeof mockFindFolder;
      createFolder: typeof mockCreateFolder;
      uploadFile: typeof mockUploadFile;
      downloadFile: typeof mockDownloadFile;
      deleteFile: typeof mockDeleteFile;
    };

    constructor(_refreshToken: string) {
      // The service mock is already set up — just wire the methods
      this.driveService = {
        findFolder: mockFindFolder,
        createFolder: mockCreateFolder,
        uploadFile: mockUploadFile,
        downloadFile: mockDownloadFile,
        deleteFile: mockDeleteFile,
      };
    }

    async upload(params: {
      fileName: string;
      buffer: Buffer;
      mimeType: string;
      entityType: string;
      entityId: string;
      pathHint: string;
      rawPath?: string;
    }) {
      const folderPath = params.rawPath ?? params.pathHint;
      const folderId = await this.resolveFolderPath(folderPath);
      const driveFile = await this.driveService.uploadFile(
        params.fileName,
        params.buffer,
        params.mimeType,
        folderId
      );
      return {
        providerType: this.type,
        externalId: driveFile.id,
        externalUrl: driveFile.webViewLink,
      };
    }

    async download(ref: StorageRef): Promise<Buffer> {
      return this.driveService.downloadFile(ref.externalId);
    }

    async delete(ref: StorageRef): Promise<void> {
      await this.driveService.deleteFile(ref.externalId);
    }

    async getExternalUrl(ref: StorageRef): Promise<string | null> {
      return ref.externalUrl ?? null;
    }

    async healthCheck(): Promise<boolean> {
      try {
        await this.driveService.findFolder('VROOM');
        return true;
      } catch {
        return false;
      }
    }

    private async resolveFolderPath(pathHint: string): Promise<string> {
      const segments = pathHint
        .split('/')
        .map((s: string) => s.trim())
        .filter(Boolean);

      let parentId: string | undefined;

      for (const segment of segments) {
        const existing = await this.driveService.findFolder(segment, parentId);
        if (existing) {
          parentId = existing.id;
        } else {
          const created = await this.driveService.createFolder(segment, parentId);
          parentId = created.id;
        }
      }

      return parentId ?? '';
    }
  },
}));

const { GoogleDriveProvider } = await import('../domains/storage/google-drive-provider');

describe('GoogleDriveProvider', () => {
  let provider: InstanceType<typeof GoogleDriveProvider>;

  beforeEach(() => {
    provider = new GoogleDriveProvider('fake-refresh-token');
    mockFindFolder.mockReset();
    mockCreateFolder.mockReset();
    mockUploadFile.mockReset();
    mockDownloadFile.mockReset();
    mockDeleteFile.mockReset();
  });

  test('type is google-drive', () => {
    expect(provider.type).toBe('google-drive');
  });

  describe('upload', () => {
    test('resolves folder path and uploads file', async () => {
      mockFindFolder
        .mockResolvedValueOnce({ id: 'vroom-id', name: 'VROOM' })
        .mockResolvedValueOnce(null);
      mockCreateFolder.mockResolvedValueOnce({
        id: 'photos-folder-id',
        name: 'Vehicle',
      });
      mockUploadFile.mockResolvedValueOnce({
        id: 'uploaded-id',
        name: 'car.jpg',
        mimeType: 'image/jpeg',
        webViewLink: 'https://drive.google.com/file/d/uploaded-id/view',
      });

      const result = await provider.upload({
        fileName: 'car.jpg',
        buffer: Buffer.from('image-data'),
        mimeType: 'image/jpeg',
        entityType: 'vehicle',
        entityId: 'v-1',
        pathHint: '/VROOM/Vehicle',
      });

      expect(result).toEqual({
        providerType: 'google-drive',
        externalId: 'uploaded-id',
        externalUrl: 'https://drive.google.com/file/d/uploaded-id/view',
      });

      expect(mockFindFolder).toHaveBeenCalledTimes(2);
      expect(mockFindFolder).toHaveBeenNthCalledWith(1, 'VROOM', undefined);
      expect(mockFindFolder).toHaveBeenNthCalledWith(2, 'Vehicle', 'vroom-id');

      expect(mockCreateFolder).toHaveBeenCalledTimes(1);
      expect(mockCreateFolder).toHaveBeenCalledWith('Vehicle', 'vroom-id');

      expect(mockUploadFile).toHaveBeenCalledWith(
        'car.jpg',
        Buffer.from('image-data'),
        'image/jpeg',
        'photos-folder-id'
      );
    });

    test('reuses existing folders when all segments exist', async () => {
      mockFindFolder
        .mockResolvedValueOnce({ id: 'vroom-id', name: 'VROOM' })
        .mockResolvedValueOnce({ id: 'receipts-id', name: 'Receipts' });
      mockUploadFile.mockResolvedValueOnce({
        id: 'receipt-file-id',
        name: 'receipt.pdf',
        mimeType: 'application/pdf',
        webViewLink: 'https://drive.google.com/file/d/receipt-file-id/view',
      });

      const result = await provider.upload({
        fileName: 'receipt.pdf',
        buffer: Buffer.from('pdf-data'),
        mimeType: 'application/pdf',
        entityType: 'expense',
        entityId: 'e-1',
        pathHint: '/VROOM/Receipts',
      });

      expect(result.externalId).toBe('receipt-file-id');
      expect(mockCreateFolder).not.toHaveBeenCalled();
    });

    test('handles empty pathHint by uploading to root', async () => {
      mockUploadFile.mockResolvedValueOnce({
        id: 'root-file-id',
        name: 'file.jpg',
        mimeType: 'image/jpeg',
      });

      const result = await provider.upload({
        fileName: 'file.jpg',
        buffer: Buffer.from('data'),
        mimeType: 'image/jpeg',
        entityType: 'vehicle',
        entityId: 'v-1',
        pathHint: '',
      });

      expect(result.externalId).toBe('root-file-id');
      expect(result.externalUrl).toBeUndefined();
      expect(mockFindFolder).not.toHaveBeenCalled();
      expect(mockUploadFile).toHaveBeenCalledWith(
        'file.jpg',
        Buffer.from('data'),
        'image/jpeg',
        ''
      );
    });
  });

  describe('download', () => {
    test('downloads file by externalId', async () => {
      const content = Buffer.from('downloaded-content');
      mockDownloadFile.mockResolvedValueOnce(content);

      const ref: StorageRef = {
        providerType: 'google-drive',
        externalId: 'file-abc',
      };

      const result = await provider.download(ref);
      expect(result).toEqual(content);
      expect(mockDownloadFile).toHaveBeenCalledWith('file-abc');
    });
  });

  describe('delete', () => {
    test('deletes file by externalId', async () => {
      mockDeleteFile.mockResolvedValueOnce(undefined);

      const ref: StorageRef = {
        providerType: 'google-drive',
        externalId: 'file-to-delete',
      };

      await provider.delete(ref);
      expect(mockDeleteFile).toHaveBeenCalledWith('file-to-delete');
    });
  });

  describe('getExternalUrl', () => {
    test('returns externalUrl when present', async () => {
      const ref: StorageRef = {
        providerType: 'google-drive',
        externalId: 'file-1',
        externalUrl: 'https://drive.google.com/file/d/file-1/view',
      };

      const url = await provider.getExternalUrl(ref);
      expect(url).toBe('https://drive.google.com/file/d/file-1/view');
    });

    test('returns null when externalUrl is undefined', async () => {
      const ref: StorageRef = {
        providerType: 'google-drive',
        externalId: 'file-2',
      };

      const url = await provider.getExternalUrl(ref);
      expect(url).toBeNull();
    });
  });

  describe('healthCheck', () => {
    test('returns true when Drive is accessible', async () => {
      mockFindFolder.mockResolvedValueOnce({ id: 'vroom-id', name: 'VROOM' });

      const result = await provider.healthCheck();
      expect(result).toBe(true);
      expect(mockFindFolder).toHaveBeenCalledWith('VROOM');
    });

    test('returns false when Drive call fails', async () => {
      mockFindFolder.mockRejectedValueOnce(new Error('Network error'));

      const result = await provider.healthCheck();
      expect(result).toBe(false);
    });

    test('returns true even when VROOM folder does not exist', async () => {
      mockFindFolder.mockResolvedValueOnce(null);

      const result = await provider.healthCheck();
      expect(result).toBe(true);
    });
  });
});
