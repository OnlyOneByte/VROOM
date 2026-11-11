import { beforeEach, describe, expect, test } from 'bun:test';
import {
  FakeGoogleStore,
  googleApiError,
  makeFakeDrive,
} from '../../../../test-helpers/fake-google-clients';
import { GoogleDriveService } from '../google-drive-service';

let store: FakeGoogleStore;
let svc: GoogleDriveService;

beforeEach(() => {
  store = new FakeGoogleStore();
  svc = new GoogleDriveService('fake-refresh-token', makeFakeDrive(store));
});

describe('GoogleDriveService — folders', () => {
  test('findFolder returns null when none exists', async () => {
    expect(await svc.findFolder('VROOM')).toBeNull();
  });

  test('findFolder matches by name + mimeType, scoped to parent', async () => {
    const rootVroom = store.seedFolder('VROOM');
    store.seedFolder('VROOM');
    const backups = store.seedFolder('Backups', rootVroom);

    const found = await svc.findFolder('Backups', rootVroom);
    expect(found?.id).toBe(backups);
    store.seedFile({ name: 'Backups', mimeType: 'text/plain', parentId: rootVroom });
    expect((await svc.findFolder('Backups', rootVroom))?.id).toBe(backups);
  });

  test('createFolder persists a folder with the right parent', async () => {
    const parent = store.seedFolder('VROOM');
    const created = await svc.createFolder('Receipts', parent);
    expect(created.id).toBeTruthy();
    expect(store.files.get(created.id)?.mimeType).toBe('application/vnd.google-apps.folder');
    expect(store.files.get(created.id)?.parents).toEqual([parent]);
  });

  test('escapes single quotes in folder names (query injection guard)', async () => {
    const parent = store.seedFolder('VROOM');
    store.seedFolder("Bob's Car", parent);
    const found = await svc.findFolder("Bob's Car", parent);
    expect(found?.name).toBe("Bob's Car");
  });

  test('folderExists is true for live folders, false for missing/trashed', async () => {
    const id = store.seedFolder('VROOM');
    expect(await svc.folderExists(id)).toBe(true);
    expect(await svc.folderExists('nope')).toBe(false);
    const f = store.files.get(id);
    if (f) f.trashed = true;
    expect(await svc.folderExists(id)).toBe(false);
  });
});

describe('GoogleDriveService — files', () => {
  test('uploadFile streams the buffer into stored content', async () => {
    const parent = store.seedFolder('VROOM');
    const body = Buffer.from('hello-zip-bytes');
    const file = await svc.uploadFile('backup.zip', body, 'application/zip', parent);

    expect(file.id).toBeTruthy();
    const stored = store.files.get(file.id);
    expect(stored?.parents).toEqual([parent]);
    expect(stored?.content.equals(body)).toBe(true);
    expect(stored?.size).toBe(body.length);
  });

  test('uploadFile accepts a string body', async () => {
    const file = await svc.uploadFile('note.txt', 'plain-text', 'text/plain');
    expect(store.files.get(file.id)?.content.toString()).toBe('plain-text');
  });

  test('download round-trips the uploaded bytes', async () => {
    const body = Buffer.from([1, 2, 3, 4, 5]);
    const file = await svc.uploadFile('blob.bin', body, 'application/octet-stream');
    const got = await svc.downloadFile(file.id);
    expect(got.equals(body)).toBe(true);
  });

  test('deleteFile removes the file', async () => {
    const file = await svc.uploadFile('temp.zip', Buffer.from('x'), 'application/zip');
    await svc.deleteFile(file.id);
    expect(store.files.has(file.id)).toBe(false);
  });

  test('listFilesInFolder paginates across pages (>100 files)', async () => {
    const folder = store.seedFolder('Backups');
    for (let i = 0; i < 230; i++) {
      store.seedFile({ name: `b-${i}.zip`, mimeType: 'application/zip', parentId: folder });
    }
    const files = await svc.listFilesInFolder(folder);
    expect(files).toHaveLength(230);
    store.seedFile({ name: 'other.zip', mimeType: 'application/zip', parentId: 'elsewhere' });
    expect(await svc.listFilesInFolder(folder)).toHaveLength(230);
  });

  test('moveFile re-parents the file without leaving it under the old folder', async () => {
    const from = store.seedFolder('Old');
    const to = store.seedFolder('New');
    const file = store.seedFile({ name: 'sheet', mimeType: 'text/plain', parentId: from });

    await svc.moveFile(file, to, from);

    expect(store.files.get(file)?.parents).toEqual([to]);
    expect((await svc.listFilesInFolder(from)).map((f) => f.id)).not.toContain(file);
  });
});

describe('GoogleDriveService — error/resilience paths', () => {
  test('upload surfaces a 429 rate-limit error from the API', async () => {
    store.injectFault('files.create', googleApiError(429, 'Rate limit exceeded'));
    await expect(svc.uploadFile('x.zip', Buffer.from('x'), 'application/zip')).rejects.toThrow(
      'Rate limit exceeded'
    );
  });

  test('a 401 (expired token) on list propagates so callers can react', async () => {
    store.injectFault('files.list', googleApiError(401, 'Invalid Credentials'));
    await expect(svc.findFolder('VROOM')).rejects.toThrow('Invalid Credentials');
  });

  test('folderExists swallows API errors and reports false (its try/catch)', async () => {
    const id = store.seedFolder('VROOM');
    store.injectFault('files.get', googleApiError(403, 'Forbidden'));
    expect(await svc.folderExists(id)).toBe(false);
  });

  test('fault is consumed once — the next call succeeds', async () => {
    store.injectFault('files.create', googleApiError(429, 'slow down'), 1);
    await expect(svc.createFolder('A')).rejects.toThrow('slow down');
    const ok = await svc.createFolder('B');
    expect(ok.id).toBeTruthy();
  });
});
