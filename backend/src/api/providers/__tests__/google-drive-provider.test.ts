import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { GoogleDriveProvider } from '../domains/storage/google-drive-provider';
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

describe('GoogleDriveProvider', () => {
  let provider: GoogleDriveProvider;

  beforeEach(() => {
    provider = new GoogleDriveProvider('fake-refresh-token');
    mockFindFolder.mockReset();
    mockCreateFolder.mockReset();
    mockUploadFile.mockReset();
    mockDownloadFile.mockReset();
    mockDeleteFile.mockReset();
  });

  afterEach(() => {
    mock.restore();
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
