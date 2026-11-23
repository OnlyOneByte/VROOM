import { GoogleDriveStrategy } from '../providers/backup-strategies/google-drive-strategy';
import { ZipBackupStrategy } from '../providers/backup-strategies/zip-strategy';
import {
  STORAGE_PROVIDER_TYPES,
  type StorageProviderDescriptor,
  storageProviderDescriptor,
} from '../providers/domains/storage/registry';
import type { BackupStrategy } from './backup-strategy';
import { backupStrategyRegistry } from './backup-strategy-registry';

const STRATEGIES: Record<
  NonNullable<StorageProviderDescriptor['backupStrategy']>,
  BackupStrategy
> = {
  zip: new ZipBackupStrategy(),
  'google-drive': new GoogleDriveStrategy(),
};

for (const type of STORAGE_PROVIDER_TYPES) {
  const descriptor = storageProviderDescriptor(type);
  if (descriptor && !descriptor.photoOnly) {
    backupStrategyRegistry.register(type, STRATEGIES[descriptor.backupStrategy ?? 'zip']);
  }
}
