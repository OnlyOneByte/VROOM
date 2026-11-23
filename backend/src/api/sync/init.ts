import { GoogleDriveStrategy } from '../providers/backup-strategies/google-drive-strategy';
import { ZipBackupStrategy } from '../providers/backup-strategies/zip-strategy';
import {
  STORAGE_PROVIDER_TYPES,
  storageProviderDescriptor,
} from '../providers/domains/storage/registry';
import { backupStrategyRegistry } from './backup-strategy-registry';

const zipStrategy = new ZipBackupStrategy();
const sheetsStrategy = new GoogleDriveStrategy();

for (const type of STORAGE_PROVIDER_TYPES) {
  const features = storageProviderDescriptor(type)?.features;
  if (features && !features.photoOnly) {
    backupStrategyRegistry.register(type, features.backupSheets ? sheetsStrategy : zipStrategy);
  }
}
