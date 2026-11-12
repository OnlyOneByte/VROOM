import { beforeEach, describe, expect, mock, test } from 'bun:test';
import fc from 'fast-check';
import { coalesceGoogleDriveFile } from '../domains/storage/drive-file-utils';
import type { DriveFile } from '../services/google-drive-service';

const EPOCH_ISO = new Date(0).toISOString();

const nullableTimestampArb = fc.oneof(
  fc.constant(undefined),
  fc.integer({ min: 86400000, max: 4102444800000 }).map((ms) => new Date(ms).toISOString())
);

const driveSizeArb = fc.oneof(
  fc.constant(undefined),
  fc.constant(''),
  fc.constant('not-a-number'),
  fc.nat({ max: 1_000_000_000 }).map(String)
);

const driveFileArb: fc.Arbitrary<DriveFile> = fc.record({
  id: fc.stringMatching(/^[a-zA-Z0-9_-]{5,30}$/),
  name: fc.stringMatching(/^[a-zA-Z0-9._-]{1,50}$/),
  mimeType: fc.constant('application/octet-stream'),
  size: driveSizeArb,
  createdTime: nullableTimestampArb,
  modifiedTime: nullableTimestampArb,
});

const pathSegmentArb = fc.stringMatching(/^[a-zA-Z0-9]{1,20}$/);

const rawPathArb = fc
  .array(pathSegmentArb, { minLength: 1, maxLength: 4 })
  .map((segments) => `/${segments.join('/')}`);

const fileNameArb = fc.stringMatching(/^[a-zA-Z0-9]{1,20}\.(zip|jpg|pdf)$/);

describe('Property 3: StorageFileInfo field coalescing', () => {
  test('all output fields are defined for any null/undefined input combination', () => {
    fc.assert(
      fc.property(driveFileArb, (driveFile) => {
        const result = coalesceGoogleDriveFile(driveFile);

        expect(result.key).toBeDefined();
        expect(result.name).toBeDefined();
        expect(result.size).toBeDefined();
        expect(result.createdTime).toBeDefined();
        expect(result.lastModified).toBeDefined();

        expect(typeof result.size).toBe('number');
        expect(typeof result.createdTime).toBe('string');
        expect(typeof result.lastModified).toBe('string');

        expect(result.size).toBeGreaterThanOrEqual(0);
        expect(Number.isNaN(result.size)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  test('size coercion matches Number(file.size) || 0', () => {
    fc.assert(
      fc.property(driveFileArb, (driveFile) => {
        const result = coalesceGoogleDriveFile(driveFile);
        const expected = Number(driveFile.size) || 0;
        expect(result.size).toBe(expected);
      }),
      { numRuns: 100 }
    );
  });

  test('timestamps fall back to epoch when both createdTime and modifiedTime are absent', () => {
    const noTimestampsArb = driveFileArb.map((f) => ({
      ...f,
      createdTime: undefined,
      modifiedTime: undefined,
    }));

    fc.assert(
      fc.property(noTimestampsArb, (driveFile) => {
        const result = coalesceGoogleDriveFile(driveFile);
        expect(result.createdTime).toBe(EPOCH_ISO);
        expect(result.lastModified).toBe(EPOCH_ISO);
      }),
      { numRuns: 100 }
    );
  });

  test('createdTime prefers file.createdTime, falls back to file.modifiedTime', () => {
    fc.assert(
      fc.property(driveFileArb, (driveFile) => {
        const result = coalesceGoogleDriveFile(driveFile);
        const expected = driveFile.createdTime ?? driveFile.modifiedTime ?? EPOCH_ISO;
        expect(result.createdTime).toBe(expected);
      }),
      { numRuns: 100 }
    );
  });

  test('lastModified prefers file.modifiedTime, falls back to file.createdTime', () => {
    fc.assert(
      fc.property(driveFileArb, (driveFile) => {
        const result = coalesceGoogleDriveFile(driveFile);
        const expected = driveFile.modifiedTime ?? driveFile.createdTime ?? EPOCH_ISO;
        expect(result.lastModified).toBe(expected);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Property 11: rawPath key routing', () => {
  describe('S3CompatProvider', () => {
    let capturedKeys: string[];
    const mockSend = mock<(cmd: unknown) => Promise<unknown>>(() => Promise.resolve({}));

    mock.module('@aws-sdk/client-s3', () => {
      class MockS3Client {
        send = (command: unknown) => {
          const cmd = command as { input?: Record<string, unknown> };
          if (cmd.input && 'Key' in cmd.input) {
            capturedKeys.push(cmd.input.Key as string);
          }
          return mockSend(command);
        };
      }
      return {
        S3Client: MockS3Client,
        PutObjectCommand: class {
          input: unknown;
          constructor(input: unknown) {
            this.input = input;
          }
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

    mock.module('@aws-sdk/s3-request-presigner', () => ({
      getSignedUrl: () => Promise.resolve('https://example.com/signed'),
    }));

    let S3CompatProvider: typeof import('../domains/storage/s3-compat-provider').S3CompatProvider;

    beforeEach(async () => {
      capturedKeys = [];
      mockSend.mockClear();
      const mod = await import('../domains/storage/s3-compat-provider');
      S3CompatProvider = mod.S3CompatProvider;
    });

    test('rawPath produces rawPath/fileName key, bypassing buildKey', async () => {
      await fc.assert(
        fc.asyncProperty(rawPathArb, fileNameArb, async (rawPath, fileName) => {
          capturedKeys = [];
          const provider = new S3CompatProvider(
            { accessKeyId: 'key', secretAccessKey: 'secret' },
            { endpoint: 'https://s3.example.com', bucket: 'bucket', region: 'us-east-1' }
          );

          await provider.upload({
            fileName,
            buffer: Buffer.from('data'),
            mimeType: 'application/zip',
            entityType: 'backup',
            entityId: 'user-1',
            pathHint: '/should/not/appear',
            rawPath,
          });

          const key = capturedKeys[capturedKeys.length - 1];
          const cleanPath = rawPath.replace(/^\/+/, '').replace(/\/+$/, '');
          const expectedKey = cleanPath ? `${cleanPath}/${fileName}` : fileName;
          expect(key).toBe(expectedKey);

          expect(key).not.toContain('backup/user-1');
        }),
        { numRuns: 100 }
      );
    });

    test('without rawPath, uses buildKey with pathHint/entityType/entityId/fileName', async () => {
      await fc.assert(
        fc.asyncProperty(pathSegmentArb, fileNameArb, async (pathHint, fileName) => {
          capturedKeys = [];
          const provider = new S3CompatProvider(
            { accessKeyId: 'key', secretAccessKey: 'secret' },
            { endpoint: 'https://s3.example.com', bucket: 'bucket', region: 'us-east-1' }
          );

          await provider.upload({
            fileName,
            buffer: Buffer.from('data'),
            mimeType: 'application/zip',
            entityType: 'backup',
            entityId: 'user-1',
            pathHint,
          });

          const key = capturedKeys[capturedKeys.length - 1];
          expect(key).toContain('backup/user-1');
          expect(key).toEndWith(fileName);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('GoogleDriveProvider rawPath selection', () => {
    test('rawPath takes precedence over pathHint when set', () => {
      fc.assert(
        fc.property(rawPathArb, pathSegmentArb, (rawPath, pathHint) => {
          const params = { rawPath, pathHint };
          const selectedPath = params.rawPath ?? params.pathHint;
          expect(selectedPath).toBe(rawPath);
          expect(selectedPath).not.toBe(pathHint);
        }),
        { numRuns: 100 }
      );
    });

    test('pathHint is used when rawPath is undefined', () => {
      fc.assert(
        fc.property(pathSegmentArb, (pathHint) => {
          const params = { rawPath: undefined, pathHint };
          const selectedPath = params.rawPath ?? params.pathHint;
          expect(selectedPath).toBe(pathHint);
        }),
        { numRuns: 100 }
      );
    });
  });
});
