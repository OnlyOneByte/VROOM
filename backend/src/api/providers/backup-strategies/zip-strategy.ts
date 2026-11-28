import { logger } from '../../../utils/logger';
import { backupService, resolveBackupFolderPath } from '../../sync/backup';
import type {
  BackupCapabilityResult,
  BackupStrategy,
  BackupStrategyContext,
  BackupStrategyResult,
} from '../../sync/backup-strategy';
import { storageProviderRegistry } from '../domains/storage/registry';
import { credentialCodeOf, type StorageProvider } from '../domains/storage/storage-provider';
import { healthFailure } from '../provider-status';

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

    const deletedOldBackups = await backupService.enforceRetention(
      context.userId,
      context.providerId
    );

    return {
      success: true,
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
    return capabilityFailure(error, 'ZIP upload failed');
  }
}

export function capabilityFailure(error: unknown, fallback: string): BackupCapabilityResult {
  const failure = credentialCodeOf(error);
  if (failure) return { success: false, failure, message: healthFailure(failure).message };
  return { success: false, message: error instanceof Error ? error.message : fallback };
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
