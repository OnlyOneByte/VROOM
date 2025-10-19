/**
 * Drive Sync - Handles Google Drive backup operations
 */

import { eq } from 'drizzle-orm';
import { users } from '../../../db/schema';
import { BACKUP_CONFIG } from '../../constants/backup';
import { databaseService } from '../../database';
import type { GoogleDriveService } from '../../google-drive';
import { SettingsRepository } from '../../repositories/settings-repository';
import { logger } from '../../utils/logger';
import { backupCreator } from '../backup/backup-creator';
import { SyncError, SyncErrorCode } from './sync-errors';

export interface BackupSyncResult {
  fileId: string;
  fileName: string;
  webViewLink: string;
  lastBackupDate: string;
}

export class DriveSync {
  private settingsRepository: SettingsRepository;

  constructor() {
    const db = databaseService.getDatabase();
    this.settingsRepository = new SettingsRepository(db);
  }

  /**
   * Upload backup to Google Drive
   */
  async uploadBackupToGoogleDrive(userId: string): Promise<BackupSyncResult> {
    logger.info('Starting Google Drive backup upload', { userId });

    const settings = await this.settingsRepository.getUserSettings(userId);

    if (!settings || !settings.googleDriveBackupEnabled) {
      throw new SyncError(
        SyncErrorCode.VALIDATION_ERROR,
        'Google Drive backup is not enabled for this user'
      );
    }

    const user = await this.getUserWithToken(userId);

    try {
      const { GoogleDriveService } = await import('../../google-drive');
      const driveService = new GoogleDriveService(user.googleRefreshToken, user.googleRefreshToken);

      const folderStructure = await driveService.createVroomFolderStructure(user.displayName);

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `vroom-backup-${timestamp}.zip`;
      const fileContent = await backupCreator.exportAsZip(userId);
      const mimeType = 'application/zip';

      const uploadedFile = await driveService.uploadFile(
        fileName,
        fileContent,
        mimeType,
        folderStructure.subFolders.backups.id
      );

      const retentionCount =
        settings.googleDriveBackupRetentionCount || BACKUP_CONFIG.DEFAULT_RETENTION_COUNT;
      await this.cleanupOldBackups(
        driveService,
        folderStructure.subFolders.backups.id,
        retentionCount
      );

      await this.settingsRepository.updateLastBackupDate(
        userId,
        folderStructure.subFolders.backups.id
      );

      logger.info('Google Drive backup upload completed', {
        userId,
        fileId: uploadedFile.id,
        fileName,
      });

      return {
        fileId: uploadedFile.id,
        fileName: uploadedFile.name,
        webViewLink: uploadedFile.webViewLink || '',
        lastBackupDate: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('Google Drive backup upload failed', {
        userId,
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
        SyncErrorCode.NETWORK_ERROR,
        'Failed to upload backup to Google Drive',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * List backups in Google Drive folder
   */
  async listBackupsInDrive(
    driveService: GoogleDriveService,
    backupFolderId: string
  ): Promise<
    Array<{
      id: string;
      name: string;
      size: string;
      createdTime: string;
      modifiedTime: string;
      webViewLink: string;
    }>
  > {
    const files = await driveService.listFilesInFolder(backupFolderId);

    return files
      .filter((file) => file.name.startsWith('vroom-backup-') && file.name.endsWith('.zip'))
      .map((file) => ({
        id: file.id,
        name: file.name,
        size: file.size || '0',
        createdTime: file.createdTime || '',
        modifiedTime: file.modifiedTime || '',
        webViewLink: file.webViewLink || '',
      }))
      .sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
  }

  /**
   * Initialize Google Drive folder structure
   */
  async initializeGoogleDriveForUser(userId: string): Promise<{
    folderStructure: {
      mainFolder: { id: string; name: string; webViewLink?: string };
      subFolders: {
        receipts: { id: string; name: string };
        maintenance: { id: string; name: string };
        photos: { id: string; name: string };
        backups: { id: string; name: string };
      };
    };
    existingBackups: Array<{
      id: string;
      name: string;
      createdTime?: string;
      modifiedTime?: string;
      size?: string;
    }>;
  }> {
    logger.info('Initializing Google Drive folder structure', { userId });

    const user = await this.getUserWithToken(userId);

    try {
      const { GoogleDriveService } = await import('../../google-drive');
      const driveService = new GoogleDriveService(user.googleRefreshToken, user.googleRefreshToken);

      const folderStructure = await driveService.createVroomFolderStructure(user.displayName);

      const existingBackups = await this.listBackupsInDrive(
        driveService,
        folderStructure.subFolders.backups.id
      );

      await this.settingsRepository.updateBackupFolderId(
        userId,
        folderStructure.subFolders.backups.id
      );

      // If existing backups found, update lastBackupDate with the most recent one
      if (existingBackups.length > 0) {
        const mostRecentBackup = existingBackups[0]; // Already sorted by modifiedTime descending
        if (mostRecentBackup.modifiedTime) {
          const lastBackupDate = new Date(mostRecentBackup.modifiedTime);
          await this.settingsRepository.updateLastBackupDateWithTime(userId, lastBackupDate);
          logger.info('Updated lastBackupDate from existing backup', {
            userId,
            lastBackupDate: lastBackupDate.toISOString(),
          });
        }
      }

      logger.info('Google Drive folder structure initialized', {
        userId,
        backupCount: existingBackups.length,
      });

      return {
        folderStructure,
        existingBackups,
      };
    } catch (error) {
      logger.error('Failed to initialize Google Drive folder structure', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      if (error instanceof Error && error.message.includes('auth')) {
        throw new SyncError(
          SyncErrorCode.AUTH_INVALID,
          'Google Drive access not available. Please re-authenticate with Google.',
          error.message
        );
      }

      throw new SyncError(
        SyncErrorCode.NETWORK_ERROR,
        'Failed to initialize Google Drive folder structure',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Delete old backups (keep only the last N backups)
   */
  private async cleanupOldBackups(
    driveService: GoogleDriveService,
    backupFolderId: string,
    keepCount: number = BACKUP_CONFIG.DEFAULT_RETENTION_COUNT
  ): Promise<number> {
    const backups = await this.listBackupsInDrive(driveService, backupFolderId);

    if (backups.length <= keepCount) {
      return 0;
    }

    const toDelete = backups.slice(keepCount);
    let deletedCount = 0;

    for (const backup of toDelete) {
      try {
        await driveService.deleteFile(backup.id);
        deletedCount++;
      } catch (error) {
        logger.warn('Failed to delete old backup', {
          backupId: backup.id,
          backupName: backup.name,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    logger.info('Old backups cleaned up', { deletedCount, keepCount });

    return deletedCount;
  }

  /**
   * Check for existing Google Drive folder structure and backups
   */
  async checkExistingGoogleDriveBackups(userId: string): Promise<{
    hasBackupFolder: boolean;
    backupFolderId?: string;
    existingBackups: Array<{
      id: string;
      name: string;
      createdTime?: string;
      modifiedTime?: string;
      size?: string;
    }>;
  }> {
    const settings = await this.settingsRepository.getUserSettings(userId);

    if (settings?.googleDriveBackupFolderId) {
      return await this.checkKnownBackupFolder(userId, settings.googleDriveBackupFolderId);
    }

    return await this.searchForBackupFolder(userId);
  }

  /**
   * Check a known backup folder ID for existing backups
   */
  private async checkKnownBackupFolder(
    userId: string,
    backupFolderId: string
  ): Promise<{
    hasBackupFolder: boolean;
    backupFolderId?: string;
    existingBackups: Array<{
      id: string;
      name: string;
      createdTime?: string;
      modifiedTime?: string;
      size?: string;
    }>;
  }> {
    try {
      const user = await this.getUserWithToken(userId);

      const { GoogleDriveService } = await import('../../google-drive');
      const driveService = new GoogleDriveService(user.googleRefreshToken, user.googleRefreshToken);

      const existingBackups = await this.listBackupsInDrive(driveService, backupFolderId);

      // Update lastBackupDate if we found backups
      if (existingBackups.length > 0) {
        const mostRecentBackup = existingBackups[0]; // Already sorted by modifiedTime descending
        if (mostRecentBackup.modifiedTime) {
          const lastBackupDate = new Date(mostRecentBackup.modifiedTime);
          await this.settingsRepository.updateLastBackupDateWithTime(userId, lastBackupDate);
          logger.info('Updated lastBackupDate from existing backup folder', {
            userId,
            lastBackupDate: lastBackupDate.toISOString(),
          });
        }
      }

      return {
        hasBackupFolder: true,
        backupFolderId,
        existingBackups,
      };
    } catch (error) {
      logger.warn('Error accessing backup folder', {
        userId,
        backupFolderId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return { hasBackupFolder: false, existingBackups: [] };
    }
  }

  /**
   * Search for backup folder in Google Drive
   */
  private async searchForBackupFolder(userId: string): Promise<{
    hasBackupFolder: boolean;
    backupFolderId?: string;
    existingBackups: Array<{
      id: string;
      name: string;
      createdTime?: string;
      modifiedTime?: string;
      size?: string;
    }>;
  }> {
    try {
      const user = await this.getUserWithToken(userId);

      const { GoogleDriveService } = await import('../../google-drive');
      const driveService = new GoogleDriveService(user.googleRefreshToken, user.googleRefreshToken);

      // Try to create or find the folder structure
      const folderStructure = await driveService.createVroomFolderStructure(user.displayName);
      const backupFolderId = folderStructure.subFolders.backups.id;
      const existingBackups = await this.listBackupsInDrive(driveService, backupFolderId);

      // Update settings with found folder
      await this.settingsRepository.updateBackupFolderId(userId, backupFolderId);

      // Update lastBackupDate if we found backups
      if (existingBackups.length > 0) {
        const mostRecentBackup = existingBackups[0]; // Already sorted by modifiedTime descending
        if (mostRecentBackup.modifiedTime) {
          const lastBackupDate = new Date(mostRecentBackup.modifiedTime);
          await this.settingsRepository.updateLastBackupDateWithTime(userId, lastBackupDate);
          logger.info('Updated lastBackupDate from search', {
            userId,
            lastBackupDate: lastBackupDate.toISOString(),
          });
        }
      }

      return {
        hasBackupFolder: true,
        backupFolderId,
        existingBackups,
      };
    } catch (error) {
      logger.warn('Error searching for backup folder', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return { hasBackupFolder: false, existingBackups: [] };
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

export const driveSync = new DriveSync();
