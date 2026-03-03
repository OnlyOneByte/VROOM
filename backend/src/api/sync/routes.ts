/**
 * Sync Routes - Backup, restore, and sync operations
 */

import { Hono } from 'hono';
import { CONFIG } from '../../config';
import type { UserSettings } from '../../db/schema';
import { createSuccessResponse, handleSyncError, SyncError, SyncErrorCode } from '../../errors';
import { bodyLimit, idempotency, rateLimiter, requireAuth } from '../../middleware';
import { logger } from '../../utils/logger';
import { OPERATION_TIMEOUTS, withTimeout } from '../../utils/timeout';
import { settingsRepository } from '../settings/repository';
import { activityTracker } from './activity-tracker';
import { backupService } from './backup';
import { createDriveServiceForUser, getDriveServiceForUser } from './google-drive';
import { createSheetsServiceForUser } from './google-sheets';
import { restoreService } from './restore';

const routes = new Hono();

routes.use('*', requireAuth);

const syncRateLimiter = rateLimiter({
  ...CONFIG.rateLimit.sync,
  keyGenerator: (c) => c.get('user').id,
});
const backupRateLimiter = rateLimiter({
  ...CONFIG.rateLimit.backup,
  keyGenerator: (c) => c.get('user').id,
});
const restoreRateLimiter = rateLimiter({
  ...CONFIG.rateLimit.restore,
  keyGenerator: (c) => c.get('user').id,
});
const driveInitRateLimiter = rateLimiter({
  ...CONFIG.rateLimit.driveInit,
  keyGenerator: (c) => c.get('user').id,
});

// --- Sync helper functions ---

/**
 * Validates that the stored backup folder still exists in Google Drive.
 * If the user deleted the folder, re-creates the full VROOM folder structure
 * and updates the stored folder ID in settings.
 * Returns the valid backup folder ID.
 */
async function ensureBackupFolder(
  userId: string,
  displayName: string,
  settings: UserSettings
): Promise<{ folderId: string; driveService: Awaited<ReturnType<typeof getDriveServiceForUser>> }> {
  const driveService = await getDriveServiceForUser(userId);
  const storedFolderId = settings.googleDriveBackupFolderId;

  if (storedFolderId && (await driveService.folderExists(storedFolderId))) {
    return { folderId: storedFolderId, driveService };
  }

  logger.warn('Backup folder missing or deleted, re-creating folder structure', { userId });
  const folderStructure = await driveService.createVroomFolderStructure(displayName);
  const newFolderId = folderStructure.subFolders.backups.id;
  await settingsRepository.updateBackupFolderId(userId, newFolderId);

  return { folderId: newFolderId, driveService };
}

async function performBackupSync(
  userId: string,
  displayName: string,
  settings: UserSettings
): Promise<Record<string, unknown>> {
  if (!settings.googleDriveBackupEnabled || !settings.googleDriveBackupFolderId) {
    return { success: false, message: 'Google Drive backup not configured' };
  }

  const zipBuffer = await withTimeout(
    backupService.exportAsZip(userId),
    OPERATION_TIMEOUTS.BACKUP,
    'Backup export'
  );

  const { folderId, driveService } = await ensureBackupFolder(userId, displayName, settings);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `vroom-backup-${timestamp}.zip`;

  const uploadedFile = await driveService.uploadFile(
    fileName,
    zipBuffer,
    'application/zip',
    folderId
  );

  const deletedCount = await enforceBackupRetention(
    driveService,
    folderId,
    settings.googleDriveBackupRetentionCount ?? CONFIG.backup.defaultRetentionCount
  );

  await settingsRepository.updateBackupDate(userId);

  return {
    success: true,
    fileId: uploadedFile.id,
    fileName: uploadedFile.name,
    deletedOldBackups: deletedCount,
  };
}

async function enforceBackupRetention(
  driveService: Awaited<ReturnType<typeof getDriveServiceForUser>>,
  folderId: string,
  retentionCount: number
): Promise<number> {
  const existingBackups = await driveService.listFilesInFolder(folderId);
  const backupFiles = existingBackups
    .filter((f) => f.name.startsWith('vroom-backup-') && f.name.endsWith('.zip'))
    .sort((a, b) => (b.modifiedTime || '').localeCompare(a.modifiedTime || ''));

  if (backupFiles.length <= retentionCount) return 0;

  const toDelete = backupFiles.slice(retentionCount);
  for (const file of toDelete) {
    try {
      await driveService.deleteFile(file.id);
    } catch (deleteError) {
      logger.warn('Failed to delete old backup', { fileId: file.id, deleteError });
    }
  }
  return toDelete.length;
}

async function performSheetsSync(
  userId: string,
  displayName: string
): Promise<Record<string, unknown>> {
  const sheetsService = await createSheetsServiceForUser(userId);
  const spreadsheetInfo = await withTimeout(
    sheetsService.createOrUpdateVroomSpreadsheet(userId, displayName),
    OPERATION_TIMEOUTS.BACKUP,
    'Sheets sync'
  );

  await settingsRepository.updateSyncDate(userId, spreadsheetInfo.id);

  return {
    success: true,
    spreadsheetId: spreadsheetInfo.id,
    webViewLink: spreadsheetInfo.webViewLink,
  };
}

// --- Route handlers ---

routes.get('/health', async (c) => {
  return c.json({ status: 'healthy', timestamp: new Date().toISOString(), service: 'sync' });
});

function validateSyncTypes(syncTypes: unknown): string[] {
  if (!syncTypes || !Array.isArray(syncTypes) || syncTypes.length === 0) {
    throw new SyncError(SyncErrorCode.VALIDATION_ERROR, 'syncTypes must be a non-empty array');
  }

  const validSyncTypes = ['sheets', 'backup'];
  const invalidTypes = syncTypes.filter((type: string) => !validSyncTypes.includes(type));
  if (invalidTypes.length > 0) {
    throw new SyncError(
      SyncErrorCode.VALIDATION_ERROR,
      `Invalid sync types: ${invalidTypes.join(', ')}`
    );
  }

  return syncTypes as string[];
}

async function executeSyncType(
  syncType: string,
  userId: string,
  displayName: string,
  settings: UserSettings,
  hasChanges: boolean
): Promise<Record<string, unknown>> {
  const noChangeResult = { success: true, message: 'No changes since last sync', skipped: true };

  if (syncType === 'backup') {
    return hasChanges ? performBackupSync(userId, displayName, settings) : noChangeResult;
  }

  if (!settings.googleSheetsSyncEnabled) {
    return { success: false, message: 'Google Sheets sync not enabled' };
  }
  return hasChanges ? performSheetsSync(userId, displayName) : noChangeResult;
}

routes.post('/', syncRateLimiter, idempotency({ required: false }), async (c) => {
  const user = c.get('user');
  const userId = user.id;

  try {
    const body = await c.req.json();
    const syncTypes = validateSyncTypes(body.syncTypes);
    const force = body.force === true;
    const hasChanges = force || (await activityTracker.hasChangesSinceLastSync(userId));
    const settings = await settingsRepository.getOrCreate(userId);
    const results: Record<string, unknown> = {};

    for (const syncType of syncTypes) {
      try {
        results[syncType] = await executeSyncType(
          syncType,
          userId,
          user.displayName,
          settings,
          hasChanges
        );
      } catch (error) {
        logger.error(`${syncType} sync failed`, { userId, error });
        results[syncType] = {
          success: false,
          message: error instanceof Error ? error.message : `${syncType} sync failed`,
        };
      }
    }

    return c.json(
      createSuccessResponse(
        { syncTypes, results, hasChanges, timestamp: new Date().toISOString() },
        'Sync completed'
      )
    );
  } catch (error) {
    return handleSyncError(c, error, 'sync');
  }
});

routes.get('/status', async (c) => {
  const user = c.get('user');
  try {
    const settings = await settingsRepository.getOrCreate(user.id);
    const syncStatus = activityTracker.getSyncStatus(user.id);

    return c.json(
      createSuccessResponse({
        googleSheetsSyncEnabled: settings.googleSheetsSyncEnabled,
        googleDriveBackupEnabled: settings.googleDriveBackupEnabled,
        syncOnInactivity: settings.syncOnInactivity,
        syncInactivityMinutes: settings.syncInactivityMinutes,
        lastSyncDate: settings.lastSyncDate,
        lastBackupDate: settings.lastBackupDate,
        lastDataChangeDate: settings.lastDataChangeDate,
        googleSheetsSpreadsheetId: settings.googleSheetsSpreadsheetId,
        googleDriveBackupFolderId: settings.googleDriveBackupFolderId,
        ...syncStatus,
      })
    );
  } catch (error) {
    return handleSyncError(c, error, 'get sync status');
  }
});

routes.post('/configure', async (c) => {
  const user = c.get('user');
  try {
    const body = await c.req.json();
    const updates: {
      googleSheetsSyncEnabled?: boolean;
      googleDriveBackupEnabled?: boolean;
      syncOnInactivity?: boolean;
      syncInactivityMinutes?: number;
    } = {};

    if (typeof body.googleSheetsSyncEnabled === 'boolean')
      updates.googleSheetsSyncEnabled = body.googleSheetsSyncEnabled;
    if (typeof body.googleDriveBackupEnabled === 'boolean')
      updates.googleDriveBackupEnabled = body.googleDriveBackupEnabled;
    if (typeof body.syncOnInactivity === 'boolean')
      updates.syncOnInactivity = body.syncOnInactivity;
    if (typeof body.syncInactivityMinutes === 'number') {
      if (
        body.syncInactivityMinutes < 1 ||
        body.syncInactivityMinutes > CONFIG.validation.settings.maxSyncInactivityMinutes
      ) {
        throw new SyncError(
          SyncErrorCode.VALIDATION_ERROR,
          `syncInactivityMinutes must be between 1 and ${CONFIG.validation.settings.maxSyncInactivityMinutes}`
        );
      }
      updates.syncInactivityMinutes = body.syncInactivityMinutes;
    }

    await settingsRepository.updateSyncConfig(user.id, updates);
    const updatedSettings = await settingsRepository.getOrCreate(user.id);

    return c.json(
      createSuccessResponse(
        {
          googleSheetsSyncEnabled: updatedSettings.googleSheetsSyncEnabled,
          googleDriveBackupEnabled: updatedSettings.googleDriveBackupEnabled,
          syncOnInactivity: updatedSettings.syncOnInactivity,
          syncInactivityMinutes: updatedSettings.syncInactivityMinutes,
        },
        'Sync settings updated successfully'
      )
    );
  } catch (error) {
    return handleSyncError(c, error, 'update sync settings');
  }
});

routes.get('/backups', async (c) => {
  const user = c.get('user');
  try {
    const settings = await settingsRepository.getOrCreate(user.id);

    if (!settings.googleDriveBackupEnabled || !settings.googleDriveBackupFolderId) {
      return c.json(createSuccessResponse([], 'Google Drive backup not configured'));
    }

    const { folderId, driveService } = await ensureBackupFolder(
      user.id,
      user.displayName,
      settings
    );
    const files = await driveService.listFilesInFolder(folderId);
    const backups = files
      .filter((f) => f.name.startsWith('vroom-backup-') && f.name.endsWith('.zip'))
      .sort((a, b) => (b.modifiedTime || '').localeCompare(a.modifiedTime || ''))
      .map((f) => ({
        fileId: f.id,
        fileName: f.name,
        size: f.size,
        createdTime: f.createdTime,
        modifiedTime: f.modifiedTime,
      }));

    return c.json(createSuccessResponse(backups));
  } catch (error) {
    return handleSyncError(c, error, 'list backups');
  }
});

routes.get('/backups/download', backupRateLimiter, async (c) => {
  const user = c.get('user');
  try {
    const zipBuffer = await withTimeout(
      backupService.exportAsZip(user.id),
      OPERATION_TIMEOUTS.BACKUP,
      'Backup export'
    );
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return new Response(zipBuffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="vroom-backup-${timestamp}.zip"`,
        'Content-Length': zipBuffer.length.toString(),
      },
    });
  } catch (error) {
    return handleSyncError(c, error, 'download backup');
  }
});

routes.get('/backups/:fileId/download', async (c) => {
  const user = c.get('user');
  const fileId = c.req.param('fileId');
  try {
    const driveService = await getDriveServiceForUser(user.id);
    const fileBuffer = await driveService.downloadFile(fileId);
    return new Response(fileBuffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="vroom-backup-${fileId}.zip"`,
        'Content-Length': fileBuffer.length.toString(),
      },
    });
  } catch (error) {
    return handleSyncError(c, error, 'download backup from Drive');
  }
});

routes.delete('/backups/:fileId', async (c) => {
  const user = c.get('user');
  const fileId = c.req.param('fileId');
  try {
    const driveService = await getDriveServiceForUser(user.id);
    await driveService.deleteFile(fileId);
    return c.json(createSuccessResponse(undefined, 'Backup deleted successfully'));
  } catch (error) {
    return handleSyncError(c, error, 'delete backup');
  }
});

routes.post('/backups/initialize-drive', driveInitRateLimiter, async (c) => {
  const user = c.get('user');
  try {
    const driveService = await createDriveServiceForUser(user.id);
    const folderStructure = await driveService.createVroomFolderStructure(user.displayName);

    await settingsRepository.updateBackupFolderId(user.id, folderStructure.subFolders.backups.id);
    await settingsRepository.updateSyncConfig(user.id, { googleDriveBackupEnabled: true });

    return c.json(
      createSuccessResponse(
        {
          mainFolder: {
            id: folderStructure.mainFolder.id,
            name: folderStructure.mainFolder.name,
            webViewLink: folderStructure.mainFolder.webViewLink,
          },
          backupsFolderId: folderStructure.subFolders.backups.id,
        },
        'Google Drive initialized successfully'
      )
    );
  } catch (error) {
    return handleSyncError(c, error, 'initialize Google Drive');
  }
});

routes.post(
  '/restore/from-backup',
  restoreRateLimiter,
  bodyLimit({ maxSize: CONFIG.backup.maxFileSize }),
  idempotency({ required: true }),
  async (c) => {
    const user = c.get('user');
    try {
      const formData = await c.req.formData();
      const file = formData.get('file') as File | null;
      const mode = (formData.get('mode') as string) || 'preview';

      if (!file) {
        throw new SyncError(SyncErrorCode.VALIDATION_ERROR, 'No file provided');
      }

      if (!CONFIG.backup.supportedModes.includes(mode as never)) {
        throw new SyncError(
          SyncErrorCode.VALIDATION_ERROR,
          `Invalid mode. Supported: ${CONFIG.backup.supportedModes.join(', ')}`
        );
      }

      const fileBuffer = Buffer.from(await file.arrayBuffer());
      const sizeValidation = backupService.validateFileSize(fileBuffer.length);
      if (!sizeValidation.valid) {
        throw new SyncError(SyncErrorCode.VALIDATION_ERROR, sizeValidation.errors[0]);
      }

      const result = await withTimeout(
        restoreService.restoreFromBackup(
          user.id,
          fileBuffer,
          mode as 'preview' | 'merge' | 'replace'
        ),
        OPERATION_TIMEOUTS.RESTORE,
        'Restore from backup'
      );
      return c.json(createSuccessResponse(result, 'Restore operation completed'));
    } catch (error) {
      return handleSyncError(c, error, 'restore from backup');
    }
  }
);

routes.post(
  '/restore/from-sheets',
  restoreRateLimiter,
  idempotency({ required: true }),
  async (c) => {
    const user = c.get('user');
    try {
      const body = await c.req.json();
      const mode = body.mode || 'preview';

      if (!CONFIG.backup.supportedModes.includes(mode as never)) {
        throw new SyncError(
          SyncErrorCode.VALIDATION_ERROR,
          `Invalid mode. Supported: ${CONFIG.backup.supportedModes.join(', ')}`
        );
      }

      const result = await withTimeout(
        restoreService.restoreFromSheets(user.id, mode as 'preview' | 'merge' | 'replace'),
        OPERATION_TIMEOUTS.RESTORE,
        'Restore from sheets'
      );
      return c.json(createSuccessResponse(result, 'Restore operation completed'));
    } catch (error) {
      return handleSyncError(c, error, 'restore from sheets');
    }
  }
);

routes.post('/restore/auto', restoreRateLimiter, idempotency({ required: true }), async (c) => {
  const user = c.get('user');
  try {
    const result = await withTimeout(
      restoreService.autoRestoreFromLatestBackup(user.id),
      OPERATION_TIMEOUTS.RESTORE,
      'Auto restore'
    );
    return c.json(createSuccessResponse(result, 'Auto restore completed'));
  } catch (error) {
    return handleSyncError(c, error, 'auto restore');
  }
});

export { routes };
