import { describe, expect, spyOn, test } from 'bun:test';
import { CONFIG } from '../../../config';
import { PayloadTooLargeError } from '../../../errors';
import { FakeStorageProvider } from '../../providers/domains/storage/fake-provider';
import { getStorageProviderRegistry } from '../../providers/domains/storage/registry';
import { backupService } from '../backup';

describe('restoring a backup from a storage provider', () => {
  test('downloads with the same size cap as an uploaded backup', async () => {
    const fake = new FakeStorageProvider();
    const download = spyOn(fake, 'download').mockResolvedValue(Buffer.from('zip'));
    const lookup = spyOn(getStorageProviderRegistry(), 'getProvider').mockResolvedValue(fake);
    try {
      await backupService.downloadBackup('u-1', 'p-1', 'Backups/vroom-backup-1.zip');
      expect(download).toHaveBeenCalledWith(
        { providerType: fake.type, externalId: 'Backups/vroom-backup-1.zip' },
        { maxBytes: CONFIG.backup.maxFileSize }
      );
    } finally {
      lookup.mockRestore();
    }
  });

  test('a provider file over the cap is refused with a 413', async () => {
    const fake = new FakeStorageProvider();
    const ref = await fake.upload({
      fileName: 'vroom-backup-1.zip',
      buffer: Buffer.alloc(64),
      mimeType: 'application/zip',
      entityType: 'backup',
      entityId: 'u-1',
      pathHint: '',
    });
    const read = fake.download(ref, { maxBytes: 32 });
    await expect(read).rejects.toBeInstanceOf(PayloadTooLargeError);
    await expect(read).rejects.toMatchObject({ statusCode: 413 });
  });
});
