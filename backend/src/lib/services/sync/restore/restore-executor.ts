/**
 * Restore Executor - Orchestrates restore operations
 */

import { eq } from 'drizzle-orm';
import { vehicles } from '../../../../db/schema';
import { databaseService } from '../../../core/database';
import { SyncError, SyncErrorCode } from '../../../core/errors';
import { settingsRepository } from '../../../repositories';
import { logger } from '../../../utils/logger';
import { GoogleSheetsService } from '../../integrations/google-sheets';
import { backupService } from '../../sync';
import { type Conflict, ConflictDetector } from './conflict-detector';
import { DataImporter } from './data-importer';

export interface ImportSummary {
  vehicles: number;
  expenses: number;
  financing: number;
  financingPayments: number;
  insurance: number;
}

export interface RestoreResponse {
  success: boolean;
  preview?: ImportSummary;
  imported?: ImportSummary;
  conflicts?: Conflict[];
}

export class RestoreExecutor {
  private conflictDetector: ConflictDetector;
  private dataImporter: DataImporter;

  constructor() {
    const db = databaseService.getDatabase();
    this.conflictDetector = new ConflictDetector(db);
    this.dataImporter = new DataImporter();
  }

  /**
   * Restore user data from a backup ZIP file
   *
   * @param userId - The user ID to restore data for
   * @param file - The backup ZIP file as a Buffer
   * @param mode - Restore mode:
   *   - 'preview': Validate and show what would be imported (no changes)
   *   - 'merge': Import data, detecting conflicts with existing data
   *   - 'replace': Delete all existing data and import backup
   * @returns RestoreResponse with success status, import summary, and any conflicts
   * @throws {SyncError} If validation fails or user ID doesn't match
   */
  async restoreFromBackup(
    userId: string,
    file: Buffer,
    mode: 'replace' | 'merge' | 'preview'
  ): Promise<RestoreResponse> {
    logger.info('Starting restore from backup', { userId, mode });

    // Parse backup
    const parsedBackup = await backupService.parseZipBackup(file);

    // Validate user ID
    const userIdValidation = backupService.validateUserId(parsedBackup.metadata.userId, userId);
    if (!userIdValidation.valid) {
      throw new SyncError(
        SyncErrorCode.VALIDATION_ERROR,
        userIdValidation.errors[0] || 'User ID mismatch'
      );
    }

    // Validate backup data
    const validation = backupService.validateBackupData(parsedBackup);
    if (!validation.valid) {
      throw new SyncError(
        SyncErrorCode.VALIDATION_ERROR,
        'Backup validation failed',
        validation.errors
      );
    }

    const summary: ImportSummary = {
      vehicles: parsedBackup.vehicles.length,
      expenses: parsedBackup.expenses.length,
      financing: parsedBackup.financing.length,
      financingPayments: parsedBackup.financingPayments.length,
      insurance: parsedBackup.insurance.length,
    };

    if (mode === 'preview') {
      logger.info('Restore preview generated', { userId, summary });
      return {
        success: true,
        preview: summary,
      };
    }

    if (mode === 'merge') {
      const conflicts = await this.conflictDetector.detectConflicts(userId, parsedBackup);
      if (conflicts.length > 0) {
        logger.warn('Conflicts detected during merge', { userId, conflictCount: conflicts.length });
        return {
          success: false,
          conflicts,
        };
      }
    }

    const db = databaseService.getDatabase();

    try {
      await db.transaction(async (tx) => {
        if (mode === 'replace') {
          await this.dataImporter.deleteUserData(tx, userId);
        }

        await this.dataImporter.insertBackupData(tx, parsedBackup);
      });

      logger.info('Restore from backup completed', { userId, mode, summary });

      return {
        success: true,
        imported: summary,
      };
    } catch (error) {
      logger.error('Restore from backup failed', {
        userId,
        mode,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      throw new SyncError(
        SyncErrorCode.VALIDATION_ERROR,
        'Failed to restore backup',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Restore user data from Google Sheets
   *
   * Fetches data from the user's synced Google Sheets and imports it.
   * Requires the user to have Google Sheets sync configured.
   *
   * @param userId - The user ID to restore data for
   * @param mode - Restore mode:
   *   - 'preview': Validate and show what would be imported (no changes)
   *   - 'merge': Import data, detecting conflicts with existing data
   *   - 'replace': Delete all existing data and import from Sheets
   * @returns RestoreResponse with success status, import summary, and any conflicts
   * @throws {SyncError} If Sheets sync is not configured or data fetch fails
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Restore logic requires multiple validation and transaction steps
  async restoreFromSheets(
    userId: string,
    mode: 'replace' | 'merge' | 'preview'
  ): Promise<RestoreResponse> {
    logger.info('Starting restore from Google Sheets', { userId, mode });

    const db = databaseService.getDatabase();

    const settings = await settingsRepository.getUserSettings(userId);

    if (!settings || !settings.googleSheetsSpreadsheetId) {
      throw new SyncError(
        SyncErrorCode.VALIDATION_ERROR,
        'No Google Sheets spreadsheet found for this user'
      );
    }

    const user = await this.getUserWithToken(userId);

    try {
      const sheetsService = new GoogleSheetsService(
        user.googleRefreshToken,
        user.googleRefreshToken
      );

      const sheetData = await sheetsService.readSpreadsheetData(settings.googleSheetsSpreadsheetId);

      if (sheetData.metadata.userId !== userId) {
        throw new SyncError(
          SyncErrorCode.VALIDATION_ERROR,
          'Spreadsheet data belongs to a different user'
        );
      }

      // Validate sheet data
      const validation = backupService.validateBackupData(sheetData);
      if (!validation.valid) {
        throw new SyncError(
          SyncErrorCode.VALIDATION_ERROR,
          'Sheet data validation failed',
          validation.errors
        );
      }

      const summary: ImportSummary = {
        vehicles: sheetData.vehicles.length,
        expenses: sheetData.expenses.length,
        financing: sheetData.financing.length,
        financingPayments: sheetData.financingPayments.length,
        insurance: sheetData.insurance.length,
      };

      if (mode === 'preview') {
        logger.info('Restore from sheets preview generated', { userId, summary });
        return {
          success: true,
          preview: summary,
        };
      }

      if (mode === 'merge') {
        const conflicts = await this.conflictDetector.detectConflicts(userId, sheetData);
        if (conflicts.length > 0) {
          logger.warn('Conflicts detected during sheets merge', {
            userId,
            conflictCount: conflicts.length,
          });
          return {
            success: false,
            conflicts,
          };
        }
      }

      await db.transaction(async (tx) => {
        if (mode === 'replace') {
          await this.dataImporter.deleteUserData(tx, userId);
        }

        await this.dataImporter.insertBackupData(tx, sheetData);
      });

      logger.info('Restore from Google Sheets completed', { userId, mode, summary });

      return {
        success: true,
        imported: summary,
      };
    } catch (error) {
      logger.error('Restore from Google Sheets failed', {
        userId,
        mode,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      if (error instanceof Error && error.message.includes('auth')) {
        throw new SyncError(
          SyncErrorCode.AUTH_INVALID,
          'Google Drive access not available. Please re-authenticate with Google.',
          error.message
        );
      }

      if (error instanceof SyncError) {
        throw error;
      }

      throw new SyncError(
        SyncErrorCode.VALIDATION_ERROR,
        'Failed to restore from Google Sheets',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Auto-restore from the latest Google Drive backup if user has no local data
   *
   * This method is typically called during user onboarding or after account setup.
   * It checks if the user has any existing vehicles, and if not, attempts to restore
   * from their most recent Google Drive backup.
   *
   * @param userId - The user ID to check and restore for
   * @returns Object with:
   *   - restored: Whether a restore was performed
   *   - backupInfo: Information about the backup file used (if restored)
   *   - summary: Import summary (if restored)
   *   - error: Error message if restore was skipped or failed
   *
   * @example
   * ```typescript
   * const result = await restoreExecutor.autoRestoreFromLatestBackup(userId);
   * if (result.restored) {
   *   console.log(`Restored ${result.summary.vehicles} vehicles`);
   * }
   * ```
   */
  async autoRestoreFromLatestBackup(userId: string): Promise<{
    restored: boolean;
    backupInfo?: {
      fileId: string;
      fileName: string;
      createdTime?: string;
    };
    summary?: ImportSummary;
    error?: string;
  }> {
    logger.info('Starting auto-restore from latest backup', { userId });

    try {
      const db = databaseService.getDatabase();

      // Check if user already has data
      const existingVehicles = await db
        .select()
        .from(vehicles)
        .where(eq(vehicles.userId, userId))
        .limit(1);

      if (existingVehicles.length > 0) {
        logger.info('User already has data, skipping auto-restore', { userId });
        return {
          restored: false,
          error: 'User already has local data',
        };
      }

      const settings = await settingsRepository.getUserSettings(userId);

      if (!settings || !settings.googleDriveBackupFolderId) {
        logger.info('No backup folder configured, skipping auto-restore', { userId });
        return {
          restored: false,
          error: 'No backup folder configured',
        };
      }

      const user = await this.getUserWithToken(userId);

      const { GoogleDriveService } = await import('../../integrations/google-drive');
      const driveService = new GoogleDriveService(user.googleRefreshToken, user.googleRefreshToken);

      // Import google sync to list backups
      const { googleSyncService } = await import('../../sync');
      const backups = await googleSyncService.listBackupsInDrive(
        driveService,
        settings.googleDriveBackupFolderId
      );

      if (backups.length === 0) {
        logger.info('No backups found, skipping auto-restore', { userId });
        return {
          restored: false,
          error: 'No backups found',
        };
      }

      // Get the latest backup
      const latestBackup = backups[0];

      // Download and restore
      const fileBuffer = await driveService.downloadFile(latestBackup.id);
      const result = await this.restoreFromBackup(userId, fileBuffer, 'replace');

      if (result.success && result.imported) {
        logger.info('Auto-restore completed successfully', {
          userId,
          backupId: latestBackup.id,
          summary: result.imported,
        });

        return {
          restored: true,
          backupInfo: {
            fileId: latestBackup.id,
            fileName: latestBackup.name,
            createdTime: latestBackup.createdTime,
          },
          summary: result.imported,
        };
      }

      return {
        restored: false,
        error: 'Restore operation failed',
      };
    } catch (error) {
      logger.error('Auto-restore failed', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        restored: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get user with Google refresh token
   */
  private async getUserWithToken(userId: string): Promise<{
    id: string;
    displayName: string;
    googleRefreshToken: string;
  }> {
    const db = databaseService.getDatabase();
    const { users } = await import('../../../../db/schema');
    const userResults = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    if (!userResults.length || !userResults[0].googleRefreshToken) {
      throw new SyncError(
        SyncErrorCode.AUTH_INVALID,
        'Google Drive access not available. Please re-authenticate with Google.'
      );
    }

    return {
      id: userResults[0].id,
      displayName: userResults[0].displayName,
      googleRefreshToken: userResults[0].googleRefreshToken,
    };
  }
}

export const restoreExecutor = new RestoreExecutor();
