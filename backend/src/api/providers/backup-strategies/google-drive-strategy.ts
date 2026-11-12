import { logger } from '../../../utils/logger';
import { backupService, resolveBackupFolderPath } from '../../sync/backup';
import type {
  BackupCapabilityResult,
  BackupStrategy,
  BackupStrategyContext,
  BackupStrategyResult,
} from '../../sync/backup-strategy';
import { GoogleDriveProvider } from '../domains/storage/google-drive-provider';
import { GoogleSheetsService } from '../services/google-sheets-service';

// bun mock.module leaks across test files, so tests inject fakes instead.
export interface GoogleDriveStrategyDeps {
  createDriveProvider: (refreshToken: string) => GoogleDriveProvider;
  createSheetsService: (refreshToken: string) => GoogleSheetsService;
}

const defaultDeps: GoogleDriveStrategyDeps = {
  createDriveProvider: (refreshToken) => new GoogleDriveProvider(refreshToken),
  createSheetsService: (refreshToken) => new GoogleSheetsService(refreshToken),
};

export class GoogleDriveStrategy implements BackupStrategy {
  constructor(private readonly deps: GoogleDriveStrategyDeps = defaultDeps) {}

  async execute(context: BackupStrategyContext): Promise<BackupStrategyResult> {
    const { providerConfig, decryptedCredentials } = context;
    const refreshToken = decryptedCredentials.refreshToken as string;
    const capabilities: Record<string, BackupCapabilityResult> = {};

    const zipEnabled = providerConfig.enabled;
    const sheetsEnabled = providerConfig.sheetsSyncEnabled === true;

    if (zipEnabled) {
      capabilities.zip = await this.executeZipUpload(context, refreshToken);
    }

    if (sheetsEnabled) {
      capabilities.sheets = await this.executeSheetsSync(context, refreshToken);
    }

    // A partial success advances the sync anchor, so any failed capability must fail the run.
    const attempted = Object.values(capabilities);
    const failed = attempted.filter((c) => !c.success);
    return {
      success: failed.length === 0,
      message: failed.length > 0 ? failed.map((c) => c.message).join('; ') : undefined,
      capabilities,
    };
  }

  private async executeZipUpload(
    context: BackupStrategyContext,
    refreshToken: string
  ): Promise<BackupCapabilityResult> {
    try {
      if (!context.zipBuffer) {
        return { success: false, message: 'ZIP generation failed or skipped' };
      }

      const provider = this.deps.createDriveProvider(refreshToken);
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
      return {
        success: false,
        message: error instanceof Error ? error.message : 'ZIP upload failed',
      };
    }
  }

  private async executeSheetsSync(
    context: BackupStrategyContext,
    refreshToken: string
  ): Promise<BackupCapabilityResult> {
    try {
      const sheetsService = this.deps.createSheetsService(refreshToken);
      const backupFolderPath = resolveBackupFolderPath(context.providerRow, context.providerConfig);
      const spreadsheetInfo = await sheetsService.createOrUpdateVroomSpreadsheet(
        context.userId,
        backupFolderPath,
        context.displayName
      );

      return {
        success: true,
        metadata: {
          spreadsheetId: spreadsheetInfo.id,
          webViewLink: spreadsheetInfo.webViewLink,
        },
      };
    } catch (error) {
      logger.warn('Sheets sync failed for provider', {
        providerId: context.providerId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Sheets sync failed',
      };
    }
  }
}
