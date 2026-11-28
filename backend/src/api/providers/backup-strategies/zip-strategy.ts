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
  "Older backups couldn't be cleaned up. Give the storage key permission to list and delete files.";

async function enforceRetentionSafely(
  context: BackupStrategyContext
): Promise<{ deleted: number; warning?: string }> {
  try {
    return { deleted: await backupService.enforceRetention(context.userId, context.providerId) };
  } catch (error) {
    logger.warn('Backup retention failed for provider', {
      providerId: context.providerId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { deleted: 0, warning: RETENTION_WARNING };
  }
}

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

    const retention = await enforceRetentionSafely(context);

    return {
      success: true,
      ...(retention.warning ? { warning: retention.warning } : {}),
      metadata: {
        fileRef: ref.externalId,
        fileName,
        deletedOldBackups: retention.deleted,
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
    return {
      success: zip.success,
      message: zip.message,
      ...(zip.warning ? { warning: zip.warning } : {}),
      capabilities: { zip },
    };
  }
}
