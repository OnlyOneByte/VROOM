import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { S3CompatProvider } from '../domains/storage/s3-compat-provider';
import type { StorageRef } from '../domains/storage/storage-provider';

// --- Mock AWS SDK ---

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
  };
});

const mockGetSignedUrl = mock<(...args: unknown[]) => Promise<string>>(() =>
  Promise.resolve('https://s3.example.com/signed-url')
);

mock.module('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl,
}));

const credentials = { accessKeyId: 'test-key', secretAccessKey: 'test-secret' };
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

      expect(result).toEqual({
        providerType: 's3',
        externalId: 'vroom/Vehicle/vehicle/v-123/photo.jpg',
      });

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0]?.[0] as { input: Record<string, unknown> };
      expect(command.input).toEqual({
        Bucket: 'test-bucket',
        Key: 'vroom/Vehicle/vehicle/v-123/photo.jpg',
        Body: Buffer.from('image-data'),
        ContentType: 'image/jpeg',
      });
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

      expect(result.externalId).toBe('vroom/Receipts/expense/e-456/receipt.pdf');
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

      expect(result.externalId).toBe('insurance_policy/ip-1/doc.pdf');
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
