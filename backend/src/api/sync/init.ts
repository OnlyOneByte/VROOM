import { GoogleDriveStrategy } from '../providers/backup-strategies/google-drive-strategy';
import { ZipBackupStrategy } from '../providers/backup-strategies/zip-strategy';
import { backupStrategyRegistry } from './backup-strategy-registry';

backupStrategyRegistry.register('google-drive', new GoogleDriveStrategy());
backupStrategyRegistry.register('s3', new ZipBackupStrategy());
backupStrategyRegistry.register('fake', new ZipBackupStrategy());
