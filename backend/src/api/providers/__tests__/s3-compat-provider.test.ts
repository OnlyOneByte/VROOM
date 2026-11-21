import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { S3CompatProvider } from '../domains/storage/s3-compat-provider';
import type { StorageRef } from '../domains/storage/storage-provider';

const mockSend = mock<(command: unknown) => Promise<unknown>>(() => Promise.resolve({}));

mock.module('@aws-sdk/client-s3', () => {
  class MockS3Client {
    send = mockSend;
  }
  return {
    S3Client: MockS3Client,
    PutObjectCommand: class {
      constructor(public input: unknown) {}
    },
    GetObjectCommand: class {
      constructor(public input: unknown) {}
    },
    DeleteObjectCommand: class {
      constructor(public input: unknown) {}
    },
    HeadBucketCommand: class {
      constructor(public input: unknown) {}
    },
    ListObjectsV2Command: class {
      constructor(public input: unknown) {}
    },
  };
});

const mockGetSignedUrl = mock<(...args: unknown[]) => Promise<string>>(() =>
  Promise.resolve('https://s3.example.com/signed-url')
);

mock.module('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl,
}));

const credentials = { accessKeyId: 'test-key', secretAccessKey: 'test-secret' };
const KEY_PATTERN = (prefix: string, fileName: string) =>
  new RegExp(
    `^${prefix}[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-${fileName.replace('.', '\\.')}$`
  );

const config = { endpoint: 'https://s3.example.com', bucket: 'test-bucket', region: 'us-east-1' };

describe('S3CompatProvider', () => {
  let provider: S3CompatProvider;

  beforeEach(() => {
    provider = new S3CompatProvider(credentials, config);
    mockSend.mockReset();
    mockGetSignedUrl.mockReset();
  });

  test('type is s3', () => {
    expect(provider.type).toBe('s3');
  });

  describe('upload', () => {
    test('sends PutObjectCommand with correct key and returns StorageRef', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await provider.upload({
        fileName: 'photo.jpg',
        buffer: Buffer.from('image-data'),
        mimeType: 'image/jpeg',
        entityType: 'vehicle',
        entityId: 'v-123',
        pathHint: '/vroom/Vehicle',
      });

      expect(result.providerType).toBe('s3');
      expect(result.externalId).toMatch(KEY_PATTERN('vroom/Vehicle/vehicle/v-123/', 'photo.jpg'));

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0]?.[0] as { input: Record<string, unknown> };
      expect(command.input).toEqual({
        Bucket: 'test-bucket',
        Key: result.externalId,
        Body: Buffer.from('image-data'),
        ContentType: 'image/jpeg',
      });
    });

    test('two uploads with the same file name on one record get distinct keys', async () => {
      mockSend.mockResolvedValue({});
      const params = {
        fileName: 'image.jpg',
        mimeType: 'image/jpeg',
        entityType: 'expense',
        entityId: 'e-1',
        pathHint: 'vroom/Receipts',
      };

      const first = await provider.upload({ ...params, buffer: Buffer.from('first') });
      const second = await provider.upload({ ...params, buffer: Buffer.from('second') });

      expect(first.externalId).not.toBe(second.externalId);
      expect(first.externalId).toMatch(KEY_PATTERN('vroom/Receipts/expense/e-1/', 'image.jpg'));
      expect(second.externalId).toMatch(KEY_PATTERN('vroom/Receipts/expense/e-1/', 'image.jpg'));
      const putKeys = mockSend.mock.calls.map(
        (call) => (call[0] as { input: { Key: string } }).input.Key
      );
      expect(putKeys).toEqual([first.externalId, second.externalId]);
    });

    test('rawPath uploads keep the caller-chosen key', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await provider.upload({
        fileName: 'vroom-backup-1.zip',
        buffer: Buffer.from('zip'),
        mimeType: 'application/zip',
        entityType: 'backup',
        entityId: 'u-1',
        pathHint: '',
        rawPath: '/vroom/Backups/',
      });

      expect(result.externalId).toBe('vroom/Backups/vroom-backup-1.zip');
    });

    test('strips leading slashes from pathHint to avoid empty key segments', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await provider.upload({
        fileName: 'receipt.pdf',
        buffer: Buffer.from('pdf-data'),
        mimeType: 'application/pdf',
        entityType: 'expense',
        entityId: 'e-456',
        pathHint: '///vroom///Receipts///',
      });

      expect(result.externalId).toMatch(
        KEY_PATTERN('vroom/Receipts/expense/e-456/', 'receipt.pdf')
      );
    });

    test('handles empty pathHint', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await provider.upload({
        fileName: 'doc.pdf',
        buffer: Buffer.from('data'),
        mimeType: 'application/pdf',
        entityType: 'insurance_policy',
        entityId: 'ip-1',
        pathHint: '',
      });

      expect(result.externalId).toMatch(KEY_PATTERN('insurance_policy/ip-1/', 'doc.pdf'));
    });
  });

  describe('download', () => {
    test('sends GetObjectCommand and returns Buffer', async () => {
      const bodyBytes = new Uint8Array([1, 2, 3, 4]);
      mockSend.mockResolvedValueOnce({
        Body: {
          transformToByteArray: () => Promise.resolve(bodyBytes),
        },
      });

      const ref: StorageRef = {
        providerType: 's3',
        externalId: 'vroom/vehicle/v-1/photo.jpg',
      };

      const result = await provider.download(ref);
      expect(result).toEqual(Buffer.from(bodyBytes));

      const command = mockSend.mock.calls[0]?.[0] as { input: Record<string, unknown> };
      expect(command.input).toEqual({
        Bucket: 'test-bucket',
        Key: 'vroom/vehicle/v-1/photo.jpg',
      });
    });

    test('throws when response body is empty', async () => {
      mockSend.mockResolvedValueOnce({ Body: undefined });

      const ref: StorageRef = {
        providerType: 's3',
        externalId: 'missing-key',
      };

      await expect(provider.download(ref)).rejects.toThrow(
        'Empty response body for key: missing-key'
      );
    });
  });

  describe('delete', () => {
    test('sends DeleteObjectCommand with correct key', async () => {
      mockSend.mockResolvedValueOnce({});

      const ref: StorageRef = {
        providerType: 's3',
        externalId: 'vroom/vehicle/v-1/photo.jpg',
      };

      await provider.delete(ref);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0]?.[0] as { input: Record<string, unknown> };
      expect(command.input).toEqual({
        Bucket: 'test-bucket',
        Key: 'vroom/vehicle/v-1/photo.jpg',
      });
    });
  });

  describe('getExternalUrl', () => {
    test('returns presigned URL on success', async () => {
      mockGetSignedUrl.mockResolvedValueOnce('https://s3.example.com/presigned/photo.jpg');

      const ref: StorageRef = {
        providerType: 's3',
        externalId: 'vroom/vehicle/v-1/photo.jpg',
      };

      const url = await provider.getExternalUrl(ref);
      expect(url).toBe('https://s3.example.com/presigned/photo.jpg');
      expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
    });

    test('returns null when presigning fails', async () => {
      mockGetSignedUrl.mockRejectedValueOnce(new Error('Signing error'));

      const ref: StorageRef = {
        providerType: 's3',
        externalId: 'vroom/vehicle/v-1/photo.jpg',
      };

      const url = await provider.getExternalUrl(ref);
      expect(url).toBeNull();
    });
  });

  describe('healthCheck', () => {
    test('returns true when bucket is accessible', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await provider.healthCheck();
      expect(result).toBe(true);

      const command = mockSend.mock.calls[0]?.[0] as { input: Record<string, unknown> };
      expect(command.input).toEqual({ Bucket: 'test-bucket' });
    });

    test('returns false when HeadBucket fails', async () => {
      mockSend.mockRejectedValueOnce(new Error('Access denied'));

      const result = await provider.healthCheck();
      expect(result).toBe(false);
    });
  });
});

describe('S3CompatProvider list', () => {
  const bucketKeys = [
    'Backups/vroom-backup-1.zip',
    'Backups/vroom-backup-2.zip',
    'Backups/old/vroom-backup-0.zip',
    'Backups2/vroom-backup-other-user.zip',
    'vroom-backup-root.zip',
  ];

  function listLikeS3(command: unknown): Promise<unknown> {
    const { Prefix = '', Delimiter } = (
      command as { input: { Prefix?: string; Delimiter?: string } }
    ).input;
    const matching = bucketKeys.filter((key) => key.startsWith(Prefix));
    const direct = Delimiter
      ? matching.filter((key) => !key.slice(Prefix.length).includes(Delimiter))
      : matching;
    return Promise.resolve({
      Contents: direct.map((Key) => ({ Key, Size: 1, LastModified: new Date(0) })),
      IsTruncated: false,
    });
  }

  let provider: S3CompatProvider;
  beforeEach(() => {
    provider = new S3CompatProvider(credentials, config);
    mockSend.mockReset();
    mockSend.mockImplementation(listLikeS3);
  });

  test('lists only the files directly in the folder, not a sibling folder sharing its name prefix', async () => {
    const keys = (await provider.list('Backups')).map((f) => f.key);
    expect(keys).toEqual(['Backups/vroom-backup-1.zip', 'Backups/vroom-backup-2.zip']);
  });

  test('leading and trailing slashes on the folder path are ignored', async () => {
    const keys = (await provider.list('/Backups/')).map((f) => f.key);
    expect(keys).toEqual(['Backups/vroom-backup-1.zip', 'Backups/vroom-backup-2.zip']);
  });

  test('the bucket root lists only root-level files', async () => {
    const keys = (await provider.list('')).map((f) => f.key);
    expect(keys).toEqual(['vroom-backup-root.zip']);
  });
});
