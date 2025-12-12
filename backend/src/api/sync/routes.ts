/**
 * Sync Routes - Backup, restore, and sync operations
 */

import { Hono } from 'hono';
import { CONFIG } from '../../config';
import { createSuccessResponse, handleSyncError, SyncError, SyncErrorCode } from '../../errors';
import { bodyLimit, idempotency, rateLimiter, requireAuth } from '../../middleware';
import { OPERATION_TIMEOUTS, withTimeout } from '../../utils/timeout';
import { settingsRepository } from '../settings/repository';
import { activityTracker } from './activity-tracker';
import { backupService } from './backup';
import { getDriveServiceForUser } from './google-drive';
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

routes.get('/health', async (c) => {
  return c.json({ status: 'healthy', timestamp: new Date().toISOString(), service: 'sync' });
});

routes.post('/', syncRateLimiter, idempotency({ required: false }), async (c) => {
  const user = c.get('user');
  const userId = user.id;

  try {
    const body = await c.req.json();
    const syncTypes = body.syncTypes;

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

    const hasChanges = await activityTracker.hasChangesSinceLastSync(userId);
    const results: Record<string, unknown> = {};

    for (const syncType of syncTypes) {
      if (syncType === 'backup') {
        results.backup = { message: 'Backup sync not yet implemented' };
      } else if (syncType === 'sheets') {
        results.sheets = { message: 'Sheets sync not yet implemented' };
      }
    }

    return c.json(
      createSuccessResponse(
        { syncTypes, results, hasChanges, timestamp: new Date().toISOString() },
        'Sync completed successfully'
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
  try {
    return c.json(createSuccessResponse([]));
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
  try {
    return c.json(
      createSuccessResponse(
        { message: 'Not yet implemented' },
        'Google Drive initialization pending'
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
