import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { AppError, NotFoundError } from '../../../errors';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../../test-helpers/http-client';
import { getStorageProviderRegistry } from '../../providers/domains/storage/registry';
import type { StorageProvider } from '../../providers/domains/storage/storage-provider';
import { healthFailure } from '../../providers/provider-status';
import { backupService } from '../backup';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

const noSuchKey = () =>
  Object.assign(new Error('The specified key does not exist.'), { name: 'NoSuchKey' });
const badKey = () =>
  Object.assign(new Error('The AWS Access Key Id you provided does not exist'), {
    name: 'InvalidAccessKeyId',
  });

function stubProvider(fail: () => Error) {
  return spyOn(getStorageProviderRegistry(), 'getProvider').mockResolvedValue({
    type: 's3',
    download: () => Promise.reject(fail()),
    list: () => Promise.reject(fail()),
  } as unknown as StorageProvider);
}

async function seedProvider(id: string): Promise<void> {
  await ctx.sql.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, config, status)
     VALUES (?, ?, 'storage', 's3', 'Bucket', '', ?, 'active')`,
    [id, ctx.user.id, JSON.stringify({})]
  );
  await ctx.sql.run(
    'INSERT INTO user_preferences (user_id, backup_config) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET backup_config = excluded.backup_config',
    [
      ctx.user.id,
      JSON.stringify({
        providers: { [id]: { enabled: true, folderPath: 'B', retentionCount: 5 } },
      }),
    ]
  );
}

describe('reading backups from a storage provider', () => {
  test('a backup file that no longer exists is a 404, not a server error', async () => {
    const spy = stubProvider(noSuchKey);
    try {
      const read = backupService.downloadBackup(ctx.user.id, 'p1', 'B/vroom-backup-1.zip');
      await expect(read).rejects.toBeInstanceOf(NotFoundError);
      await expect(read).rejects.toThrow('Backup file not found');
    } finally {
      spy.mockRestore();
    }
  });

  test('a key the provider rejects gives the reconnect message', async () => {
    const spy = stubProvider(badKey);
    try {
      const read = backupService.downloadBackup(ctx.user.id, 'p1', 'B/vroom-backup-1.zip');
      await expect(read).rejects.toBeInstanceOf(AppError);
      await expect(read).rejects.toMatchObject({
        statusCode: 502,
        message: healthFailure('auth').message,
      });
    } finally {
      spy.mockRestore();
    }
  });

  test('listing with a rejected key gives the same message on both listing paths', async () => {
    await seedProvider('p-list');
    const spy = stubProvider(badKey);
    try {
      await expect(backupService.listBackups(ctx.user.id, 'p-list')).rejects.toMatchObject({
        statusCode: 502,
        message: healthFailure('auth').message,
      });
      const all = await backupService.listAllBackups(ctx.user.id);
      expect(all.find((entry) => entry.providerId === 'p-list')?.error).toBe(
        healthFailure('auth').message
      );
    } finally {
      spy.mockRestore();
    }
  });
});
