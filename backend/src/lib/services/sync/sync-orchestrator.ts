/**
 * Sync Orchestrator - Coordinates all sync, backup, and restore operations
 * This is the single entry point for all sync-related functionality
 *
 * Includes sync lock management to prevent concurrent operations
 */

import type { BackupData } from '../../types/sync';
import { logger } from '../../utils/logger';
import { backupService } from './backup-service';
import { type BackupSyncResult, googleSyncService, type SheetsSyncResult } from './google-sync';
import type { ImportSummary, RestoreResponse } from './restore/restore-executor';
import { restoreExecutor } from './restore/restore-executor';

/**
 * ⚠️ PRODUCTION WARNING:
 * The sync lock is an in-memory implementation that will NOT work correctly in:
 * - Multi-instance deployments (horizontal scaling)
 * - Serverless environments (state is lost between invocations)
 * - Load-balanced setups (locks are not shared across instances)
 *
 * For production, replace with:
 * - Redis (recommended): Use SET NX EX for atomic lock acquisition
 * - Database-based locks: Use SELECT FOR UPDATE or advisory locks
 * - Distributed lock service: e.g., etcd, Consul
 */
export class SyncOrchestrator {
  private locks = new Map<string, { timestamp: number; ttl: number }>();
  private cleanupInterval: Timer | null = null;

  constructor() {
    // Clean up expired locks every minute
    this.cleanupInterval = setInterval(() => this.cleanupLocks(), 60000);
  }

  // ============================================================================
  // SYNC LOCK MANAGEMENT
  // ============================================================================

  /**
   * Acquire a sync lock for a user
   */
  async acquireLock(userId: string, ttl = 300000): Promise<boolean> {
    const existing = this.locks.get(userId);
    if (existing && Date.now() - existing.timestamp < existing.ttl) {
      return false;
    }

    this.locks.set(userId, { timestamp: Date.now(), ttl });
    return true;
  }

  /**
   * Release a sync lock for a user
   */
  releaseLock(userId: string): void {
    this.locks.delete(userId);
  }

  /**
   * Check if a user has an active sync lock
   */
  isLocked(userId: string): boolean {
    const existing = this.locks.get(userId);
    if (!existing) return false;
    return Date.now() - existing.timestamp < existing.ttl;
  }

  /**
   * Get the number of active locks
   */
  getActiveLockCount(): number {
    this.cleanupLocks();
    return this.locks.size;
  }

  /**
   * Clean up expired locks
   */
  private cleanupLocks(): void {
    const now = Date.now();
    for (const [userId, lock] of this.locks.entries()) {
      if (now - lock.timestamp >= lock.ttl) {
        this.locks.delete(userId);
      }
    }
  }

  /**
   * Destroy the orchestrator and clean up resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.locks.clear();
  }
  /**
   * Execute sync operations for specified types
   */
  async executeSync(
    userId: string,
    syncTypes: string[]
  ): Promise<{
    sheets?: SheetsSyncResult;
    backup?: BackupSyncResult;
    errors?: Record<string, string>;
  }> {
    logger.info('Executing sync operations', { userId, syncTypes });

    const syncPromises = syncTypes.map(async (type) => {
      if (type === 'sheets') {
        return { type: 'sheets', result: await googleSyncService.syncToSheets(userId) };
      }
      if (type === 'backup') {
        return {
          type: 'backup',
          result: await googleSyncService.uploadBackupToGoogleDrive(userId),
        };
      }
      throw new Error(`Unknown sync type: ${type}`);
    });

    const results = await Promise.allSettled(syncPromises);

    return this.collectSyncResults(results, syncTypes);
  }

  // ============================================================================
  // Backup Operations
  // ============================================================================

  /**
   * Create a backup of user data
   */
  async createBackup(userId: string): Promise<BackupData> {
    logger.info('Creating backup via orchestrator', { userId });
    return backupService.createBackup(userId);
  }

  /**
   * Export backup as ZIP file
   */
  async exportBackupAsZip(userId: string): Promise<Buffer> {
    logger.info('Exporting backup as ZIP via orchestrator', { userId });
    return backupService.exportAsZip(userId);
  }

  /**
   * Upload backup to Google Drive
   */
  async uploadBackupToDrive(userId: string): Promise<BackupSyncResult> {
    logger.info('Uploading backup to Drive via orchestrator', { userId });
    const result = await googleSyncService.uploadBackupToGoogleDrive(userId);

    // Enforce retention policy after successful upload
    // If we got a result with fileId, the upload was successful
    if (result.fileId) {
      await this.enforceBackupRetention(userId).catch((error) => {
        logger.warn('Failed to enforce backup retention policy', { userId, error });
        // Don't fail the upload if retention cleanup fails
      });
    }

    return result;
  }

  /**
   * List backups in Google Drive
   */
  async listDriveBackups(userId: string): Promise<
    Array<{
      id: string;
      name: string;
      size: string;
      createdTime: string;
      modifiedTime: string;
      webViewLink: string;
    }>
  > {
    logger.info('Listing Drive backups via orchestrator', { userId });

    const { getDriveServiceForUser } = await import('../integrations/drive-helper');
    const { SettingsRepository } = await import('../../repositories/settings');
    const { databaseService } = await import('../../core/database');

    const db = databaseService.getDatabase();
    const settingsRepo = new SettingsRepository(db);
    let settings = await settingsRepo.getByUserId(userId);

    // If no backup folder ID exists, try to initialize/find it
    if (!settings || !settings.googleDriveBackupFolderId) {
      logger.info('No backup folder ID found, checking for existing folder structure', { userId });
      const checkResult = await googleSyncService.checkExistingGoogleDriveBackups(userId);

      if (checkResult.hasBackupFolder && checkResult.backupFolderId) {
        // Folder was found and settings were updated
        settings = await settingsRepo.getByUserId(userId);
      } else {
        // No folder exists yet
        logger.info('No backup folder found', { userId });
        return [];
      }
    }

    if (!settings?.googleDriveBackupFolderId) {
      return [];
    }

    const driveService = await getDriveServiceForUser(userId);
    const backups = await googleSyncService.listBackupsInDrive(
      driveService,
      settings.googleDriveBackupFolderId
    );

    logger.info('Backups found', { userId, count: backups.length });

    return backups;
  }

  /**
   * Initialize Google Drive folder structure
   */
  async initializeDrive(userId: string): Promise<{
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
    logger.info('Initializing Drive via orchestrator', { userId });
    return googleSyncService.initializeGoogleDriveForUser(userId);
  }

  /**
   * Check for existing Google Drive backups
   */
  async checkExistingDriveBackups(userId: string): Promise<{
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
    logger.info('Checking existing Drive backups via orchestrator', { userId });
    return googleSyncService.checkExistingGoogleDriveBackups(userId);
  }

  /**
   * Download backup file from Google Drive
   */
  async downloadBackupFromDrive(
    userId: string,
    fileId: string
  ): Promise<{
    buffer: Buffer;
    metadata: { name: string };
  }> {
    logger.info('Downloading backup from Drive via orchestrator', { userId, fileId });

    const { getDriveServiceForUser } = await import('../integrations/drive-helper');
    const driveService = await getDriveServiceForUser(userId);

    const buffer = await driveService.downloadFile(fileId);
    const metadata = await driveService.getFileMetadata(fileId);

    return { buffer, metadata };
  }

  /**
   * Delete backup file from Google Drive
   */
  async deleteBackupFromDrive(userId: string, fileId: string): Promise<void> {
    logger.info('Deleting backup from Drive via orchestrator', { userId, fileId });

    const { getDriveServiceForUser } = await import('../integrations/drive-helper');
    const driveService = await getDriveServiceForUser(userId);

    await driveService.deleteFile(fileId);
  }

  // ============================================================================
  // Restore Operations
  // ============================================================================

  /**
   * Restore from backup file
   */
  async restoreFromBackup(
    userId: string,
    file: Buffer,
    mode: 'replace' | 'merge' | 'preview'
  ): Promise<RestoreResponse> {
    logger.info('Restoring from backup via orchestrator', { userId, mode });
    return restoreExecutor.restoreFromBackup(userId, file, mode);
  }

  /**
   * Restore from Google Sheets
   */
  async restoreFromSheets(
    userId: string,
    mode: 'replace' | 'merge' | 'preview'
  ): Promise<RestoreResponse> {
    logger.info('Restoring from Sheets via orchestrator', { userId, mode });
    return restoreExecutor.restoreFromSheets(userId, mode);
  }

  /**
   * Auto-restore from latest Google Drive backup
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
    logger.info('Auto-restoring from latest backup via orchestrator', { userId });
    return restoreExecutor.autoRestoreFromLatestBackup(userId);
  }

  // ============================================================================
  // Sheets Operations
  // ============================================================================

  /**
   * Sync data to Google Sheets
   */
  async syncToSheets(userId: string): Promise<SheetsSyncResult> {
    logger.info('Syncing to Sheets via orchestrator', { userId });
    return googleSyncService.syncToSheets(userId);
  }

  /**
   * Enforce backup retention policy
   * Deletes old backups beyond the retention limit
   */
  private async enforceBackupRetention(userId: string): Promise<void> {
    const { BACKUP_CONFIG } = await import('../../constants/sync');

    logger.info('Enforcing backup retention policy', { userId });

    const backups = await this.listDriveBackups(userId);

    if (backups.length <= BACKUP_CONFIG.DEFAULT_RETENTION_COUNT) {
      logger.info('Backup count within retention limit', {
        userId,
        count: backups.length,
        limit: BACKUP_CONFIG.DEFAULT_RETENTION_COUNT,
      });
      return;
    }

    // Sort by creation time (newest first) and delete old ones
    const sortedBackups = backups.sort(
      (a, b) => new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime()
    );

    const backupsToDelete = sortedBackups.slice(BACKUP_CONFIG.DEFAULT_RETENTION_COUNT);

    logger.info('Deleting old backups', {
      userId,
      totalBackups: backups.length,
      toDelete: backupsToDelete.length,
    });

    for (const backup of backupsToDelete) {
      try {
        await this.deleteBackupFromDrive(userId, backup.id);
        logger.info('Deleted old backup', { userId, backupId: backup.id, name: backup.name });
      } catch (error) {
        logger.error('Failed to delete old backup', {
          userId,
          backupId: backup.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        // Continue with other deletions even if one fails
      }
    }
  }

  /**
   * Collect results from Promise.allSettled
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Result collection requires checking multiple result types
  private collectSyncResults(
    results: PromiseSettledResult<{ type: string; result: SheetsSyncResult | BackupSyncResult }>[],
    syncTypes: string[]
  ): {
    sheets?: SheetsSyncResult;
    backup?: BackupSyncResult;
    errors?: Record<string, string>;
  } {
    const response: {
      sheets?: SheetsSyncResult;
      backup?: BackupSyncResult;
      errors?: Record<string, string>;
    } = {};

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { type, result: syncResult } = result.value;
        if (type === 'sheets') {
          response.sheets = syncResult as SheetsSyncResult;
        } else if (type === 'backup') {
          response.backup = syncResult as BackupSyncResult;
        }
      } else {
        const errorMessage =
          result.reason instanceof Error ? result.reason.message : String(result.reason);
        const failedIndex = results.indexOf(result);
        const failedType = syncTypes[failedIndex] || 'unknown';

        if (!response.errors) {
          response.errors = {};
        }
        response.errors[failedType] = errorMessage;
      }
    }

    return response;
  }
}

export const syncOrchestrator = new SyncOrchestrator();
