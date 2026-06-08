/**
 * Contract tests for FakeStorageProvider.
 *
 * Proves the fake honors the StorageProvider interface end-to-end in memory
 * (upload → download → list → getExternalUrl → delete), so a test that selects
 * it via a `providerType: 'fake'` row exercises the real photo-service/registry
 * code paths with zero network. This is the reusable seam for testing every
 * external storage provider (Google Photos, S3, OneDrive, …).
 */

import { describe, expect, test } from 'bun:test';
import { FakeStorageProvider } from '../fake-provider';
import type { UploadParams } from '../storage-provider';

function uploadParams(overrides: Partial<UploadParams> = {}): UploadParams {
  return {
    fileName: 'receipt.jpg',
    buffer: Buffer.from('hello-bytes'),
    mimeType: 'image/jpeg',
    entityType: 'expense',
    entityId: 'exp-1',
    pathHint: 'Receipts',
    ...overrides,
  };
}

describe('FakeStorageProvider', () => {
  test('type is "fake"', () => {
    expect(new FakeStorageProvider().type).toBe('fake');
  });

  test('upload → download round-trips the exact bytes', async () => {
    const p = new FakeStorageProvider();
    const ref = await p.upload(uploadParams({ buffer: Buffer.from('abc123') }));
    expect(ref.providerType).toBe('fake');
    const got = await p.download(ref);
    expect(got.toString()).toBe('abc123');
  });

  test('uploaded file appears in list() under its folder', async () => {
    const p = new FakeStorageProvider();
    await p.upload(uploadParams({ rawPath: 'Vehicles/v1', fileName: 'front.jpg' }));
    const listed = await p.list('Vehicles/v1');
    expect(listed.map((f) => f.name)).toContain('front.jpg');
  });

  test('getExternalUrl returns a url for an existing ref, null otherwise', async () => {
    const p = new FakeStorageProvider();
    const ref = await p.upload(uploadParams());
    expect(await p.getExternalUrl(ref)).toMatch(/^fake:\/\//);
    expect(await p.getExternalUrl({ providerType: 'fake', externalId: 'missing' })).toBeNull();
  });

  test('delete removes the file', async () => {
    const p = new FakeStorageProvider();
    const ref = await p.upload(uploadParams());
    await p.delete(ref);
    expect(await p.getExternalUrl(ref)).toBeNull();
    await expect(p.download(ref)).rejects.toThrow();
  });

  test('healthCheck is always true', async () => {
    expect(await new FakeStorageProvider().healthCheck()).toBe(true);
  });

  test('constructor seed pre-populates list() (canned content for E2E)', async () => {
    const p = new FakeStorageProvider([
      {
        key: 'Vehicles/v1/seeded.jpg',
        name: 'seeded.jpg',
        size: 0,
        createdTime: new Date(0).toISOString(),
        lastModified: new Date(0).toISOString(),
      },
    ]);
    const listed = await p.list('Vehicles/v1');
    expect(listed.map((f) => f.name)).toContain('seeded.jpg');
  });
});
