import { logger } from '../../../utils/logger';
import { backupService, resolveBackupFolderPath } from '../../sync/backup';
import type {
  BackupCapabilityResult,
  BackupStrategy,
  BackupStrategyContext,
  BackupStrategyResult,
} from '../../sync/backup-strategy';
import { storageProviderRegistry } from '../domains/storage/registry';
import type { StorageProvider } from '../domains/storage/storage-provider';

export const RETENTION_WARNING =
  "Backed up, but old backups couldn't be removed. The storage key needs permission to list and delete files.";

export async function uploadZipBackup(
  context: BackupStrategyContext,
  createProvider: () => StorageProvider | Promise<StorageProvider>
): Promise<BackupCapabilityResult> {
  try {
    if (!context.zipBuffer) {
      return { success: false, message: 'ZIP generation failed or skipped' };
    }

    const provider = await createProvider();
    const folderPath = resolveBackupFolderPath(context.providerRow, context.providerConfig);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `vroom-backup-${timestamp}.zip`;

    const ref = await provider.upload({
      fileName,
      buffer: context.zipBuffer,
      mimeType: 'application/zip',
      entityType: 'backup',
      entityId: context.userId,
      pathHint: '',
      rawPath: folderPath,
    });

    let deletedOldBackups = 0;
    let warning: string | undefined;
    try {
      deletedOldBackups = await backupService.enforceRetention(context.userId, context.providerId);
    } catch (error) {
      logger.warn('Old backup cleanup failed for provider', {
        providerId: context.providerId,
        error: error instanceof Error ? error.message : String(error),
      });
      warning = RETENTION_WARNING;
    }

    return {
      success: true,
      ...(warning && { warning }),
      metadata: {
        fileRef: ref.externalId,
        fileName,
        deletedOldBackups,
      },
    };
  } catch (error) {
    logger.warn('ZIP upload failed for provider', {
      providerId: context.providerId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      message: error instanceof Error ? error.message : 'ZIP upload failed',
    };
  }
}

export class ZipBackupStrategy implements BackupStrategy {
  async execute(context: BackupStrategyContext): Promise<BackupStrategyResult> {
    if (!context.providerConfig.enabled) {
      return {
        success: false,
        message: 'ZIP backup is off for this provider, and it has no other kind of backup',
        capabilities: {},
      };
    }
    const zip = await uploadZipBackup(context, () =>
      storageProviderRegistry.createProviderInstance(context.providerRow)
    );
    return { success: zip.success, message: zip.message, capabilities: { zip } };
  }
}
