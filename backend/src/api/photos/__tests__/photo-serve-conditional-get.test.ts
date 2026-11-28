import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../../test-helpers/http-client';
import type {
  DownloadOptions,
  StorageFileInfo,
  StorageProvider,
  StorageRef,
  UploadParams,
} from '../../providers/domains/storage/storage-provider';
import { MAX_FILE_SIZE } from '../photo-service';

const PHOTO_BYTES = Buffer.alloc(2_621_440, 7);
const STORAGE_KEY = 'receipts/receipt.jpg';
const PHOTO_PATH = '/api/v1/photos/expense/exp-1/photo-1/thumbnail';

let ctx: TestApp;
let downloads = 0;
let downloadOptions: DownloadOptions | undefined;
let restoreRegistry: () => void;

async function installCountingProvider(): Promise<void> {
  const { FakeStorageProvider } = await import('../../providers/domains/storage/fake-provider');
  const fake = new FakeStorageProvider();
  await fake.upload({
    fileName: 'receipt.jpg',
    buffer: PHOTO_BYTES,
    mimeType: 'image/jpeg',
    entityType: 'expense',
    entityId: 'exp-1',
    pathHint: '',
    rawPath: 'receipts',
  });

  const counting: StorageProvider = {
    type: fake.type,
    upload: (params: UploadParams) => fake.upload(params),
    download: (ref: StorageRef, options?: DownloadOptions) => {
      downloads++;
      downloadOptions = options;
      return fake.download(ref, options);
    },
    delete: (ref: StorageRef) => fake.delete(ref),
    getExternalUrl: (ref: StorageRef) => fake.getExternalUrl(ref),
    healthCheck: () => fake.healthCheck(),
    list: (folderPath: string): Promise<StorageFileInfo[]> => fake.list(folderPath),
  };

  const { getStorageProviderRegistry } = await import('../../providers/domains/storage/registry');
  const registry = getStorageProviderRegistry();
  registry.createProviderInstance = async () => counting;
  restoreRegistry = () => {
    Reflect.deleteProperty(registry, 'createProviderInstance');
  };
}

async function seedServablePhoto(): Promise<void> {
  await ctx.sql.run(
    `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('veh-1', ?, 'Toyota', 'Camry', 2022)`,
    [ctx.user.id]
  );
  await ctx.sql.run(
    `INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount)
     VALUES ('exp-1', 'veh-1', ?, 'maintenance', 1700000000, 100.0)`,
    [ctx.user.id]
  );
  await ctx.sql.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, status)
     VALUES ('prov-1', ?, 'storage', 'fake', 'Fake storage', 'unused', 'active')`,
    [ctx.user.id]
  );
  await ctx.sql.run(
    `INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size)
     VALUES ('photo-1', ?, 'expense', 'exp-1', 'receipt.jpg', 'image/jpeg', ?)`,
    [ctx.user.id, PHOTO_BYTES.length]
  );
  await ctx.sql.run(
    `INSERT INTO photo_refs (id, photo_id, provider_id, storage_ref, status)
     VALUES ('ref-1', 'photo-1', 'prov-1', ?, 'active')`,
    [STORAGE_KEY]
  );
}

async function getPhoto(ifNoneMatch?: string): Promise<Response> {
  const headers: Record<string, string> = { Cookie: ctx.cookie };
  if (ifNoneMatch !== undefined) headers['If-None-Match'] = ifNoneMatch;
  return ctx.app.request(PHOTO_PATH, { headers });
}

async function servedBytes(res: Response): Promise<number> {
  return (await res.arrayBuffer()).byteLength;
}

beforeEach(async () => {
  ctx = await createTestApp();
  downloads = 0;
  await installCountingProvider();
  await seedServablePhoto();
}, SETUP_TIMEOUT_MS);

afterEach(() => {
  restoreRegistry();
  ctx.close();
});

describe('photo serve: conditional GET', () => {
  test('the original is read from storage with the photo size limit', async () => {
    const res = await getPhoto();

    expect(res.status).toBe(200);
    expect(downloadOptions).toEqual({ maxBytes: MAX_FILE_SIZE });
  });

  test('a cold GET serves the whole original and a strong validator for it', async () => {
    const res = await getPhoto();

    expect(res.status, await res.clone().text()).toBe(200);
    expect(await servedBytes(res)).toBe(PHOTO_BYTES.length);

    const etag = res.headers.get('ETag');
    expect(etag).toBeTruthy();
    expect(etag?.startsWith('W/')).toBe(false);
    expect(etag).toMatch(/^"[^"]+"$/);
  });

  test('the validator is stable across requests (a cache entry stays usable)', async () => {
    const first = await getPhoto();
    const second = await getPhoto();
    expect(first.headers.get('ETag')).toBeTruthy();
    expect(first.headers.get('ETag')).toBe(second.headers.get('ETag'));
  });

  test('revalidating with the matching validator serves ZERO bytes', async () => {
    const cold = await getPhoto();
    const etag = cold.headers.get('ETag');
    expect(etag).toBeTruthy();

    const revalidated = await getPhoto(etag ?? '');

    expect(revalidated.status).toBe(304);
    expect(await servedBytes(revalidated)).toBe(0);
    expect(revalidated.headers.get('ETag')).toBe(etag);
    expect(revalidated.headers.get('Cache-Control')).toContain('private');
  });

  test('a 304 never re-downloads the original from the storage provider', async () => {
    const cold = await getPhoto();
    const etag = cold.headers.get('ETag') ?? '';
    expect(downloads).toBe(1);

    await getPhoto(etag);

    expect(downloads).toBe(1);
  });

  test("a conditional GET for another user's photo is still 404, never 304", async () => {
    await ctx.sql.run(
      `INSERT INTO users (id, email, display_name) VALUES ('other-user', 'other@test.com', 'Other')`
    );
    await ctx.sql.run(
      `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('veh-2', 'other-user', 'Honda', 'Fit', 2020)`
    );
    await ctx.sql.run(
      `INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount)
       VALUES ('exp-2', 'veh-2', 'other-user', 'maintenance', 1700000000, 50.0)`
    );
    await ctx.sql.run(
      `INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size)
       VALUES ('photo-foreign', 'other-user', 'expense', 'exp-2', 'theirs.jpg', 'image/jpeg', 1024)`
    );

    const res = await ctx.app.request('/api/v1/photos/expense/exp-2/photo-foreign/thumbnail', {
      headers: { Cookie: ctx.cookie, 'If-None-Match': '*' },
    });

    expect(res.status).toBe(404);
  });

  test("another photo's validator never short-circuits this one", async () => {
    await ctx.sql.run(
      `INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size)
       VALUES ('photo-2', ?, 'expense', 'exp-1', 'receipt-2.jpg', 'image/jpeg', ?)`,
      [ctx.user.id, PHOTO_BYTES.length - 1]
    );
    await ctx.sql.run(
      `INSERT INTO photo_refs (id, photo_id, provider_id, storage_ref, status)
       VALUES ('ref-2', 'photo-2', 'prov-1', ?, 'active')`,
      [STORAGE_KEY]
    );

    const other = await ctx.app.request('/api/v1/photos/expense/exp-1/photo-2/thumbnail', {
      headers: { Cookie: ctx.cookie },
    });
    const otherEtag = other.headers.get('ETag');
    const mineEtag = (await getPhoto()).headers.get('ETag');
    expect(otherEtag).toBeTruthy();
    expect(otherEtag).not.toBe(mineEtag);

    const res = await getPhoto(otherEtag ?? '');

    expect(res.status).toBe(200);
    expect(await servedBytes(res)).toBe(PHOTO_BYTES.length);
  });

  test('a stale validator still serves the full bytes', async () => {
    const res = await getPhoto('"stale-from-a-previous-photo"');

    expect(res.status).toBe(200);
    expect(await servedBytes(res)).toBe(PHOTO_BYTES.length);
  });

  test('If-None-Match: * matches any existing representation (304)', async () => {
    const res = await getPhoto('*');

    expect(res.status).toBe(304);
    expect(await servedBytes(res)).toBe(0);
  });

  test('a weakened tag in a multi-value list still matches (weak comparison)', async () => {
    const cold = await getPhoto();
    const etag = cold.headers.get('ETag') ?? '';

    const res = await getPhoto(`"someone-elses-tag", W/${etag}`);

    expect(res.status).toBe(304);
    expect(await servedBytes(res)).toBe(0);
  });
});
