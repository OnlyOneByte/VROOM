import { GoogleDriveStrategy } from '../providers/backup-strategies/google-drive-strategy';
import { backupStrategyRegistry } from './backup-strategy-registry';

backupStrategyRegistry.register('google-drive', new GoogleDriveStrategy());
