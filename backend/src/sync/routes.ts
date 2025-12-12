/**
 * Consolidated Sync Routes
 *
 * Consolidates:
 * - routes/sync/index.ts (main sync orchestration)
 * - routes/sync/backups.ts (backup management)
 * - routes/sync/restore.ts (restore operations)
 *
 * Removes SyncOrchestrator - calls services directly with simple lock management
 */

import { Hono } from 'hono';
import { CONFIG } from '../config';
import { createSuccessResponse, handleSyncError, SyncError, SyncErrorCode } from '../errors';
import { bodyLimit, idempotency, rateLimiter, requireAuth } from '../middleware';
import { settingsRepository } from '../settings/repository';
import { logger } from '../utils/logger';
import { OPERATION_TIMEOUTS, withTimeout } from '../utils/timeout';
import { activityTracker } from './activity-tracker';
import { backupService } from './backup';
import { getDriveServiceForUser } from './google-drive';
import { restoreService } from './restore';

const routes = new Hono();

// ============================================================================
// SIMPLE LOCK MANAGEMENT (replaces SyncOrchestrator)
// ============================================================================

const syncLocks = new Map<string, number>(); // userId → timestamp

function acquireLock(userId: string): boolean {
  const existing = syncLocks.get(userId);
  if (existing && Date.now() - existing < 300000) return false; // 5 minute lock
  syncLocks.set(userId, Date.now());
  return true;
}

function releaseLock(userId: string): void {
  syncLocks.delete(userId);
}

// ============================================================================
// MIDDLEWARE SETUP
// ============================================================================

// Apply authentication to all routes
routes.use('*', requireAuth);

// Rate limiters
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

// ============================================================================
// MAIN SYNC ROUTES
// ============================================================================

/**
 * GET /api/sync/health
 * Health check endpoint for sync service
 */
routes.get('/health', async (c) => {
  const activeLocks = syncLocks.size;

  return c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    activeLocks,
    service: 'sync',
  });
});

/**
 * POST /api/sync
 * Trigger sync operations for specified types
 */
routes.post('/', syncRateLimiter, idempotency({ required: false }), async (c) => {
  const user = c.get('user');
  const userId = user.id;

  try {
    const body = await c.req.json();
    const syncTypes = body.syncTypes;

    // Validate sync types
    if (!syncTypes || !Array.isArray(syncTypes) || syncTypes.length === 0) {
      throw new SyncError(SyncErrorCode.VALIDATION_ERROR, 'syncTypes must be a non-empty array');
    }

    const validSyncTypes = ['sheets', 'backup'];
    const invalidTypes = syncTypes.filter((type: string) => !validSyncTypes.includes(type));

    if (invalidTypes.length > 0) {
      throw new SyncError(
        SyncErrorCode.VALIDATION_ERROR,
        `Invalid sync types: ${invalidTypes.join(', ')}. Valid types are: ${validSyncTypes.join(', ')}`
      );
    }

    logger.info('Sync request received', { userId, syncTypes });

    const hasChanges = await activityTracker.hasChangesSinceLastSync(userId);

    // Acquire lock
    if (!acquireLock(userId)) {
      throw new SyncError(
        SyncErrorCode.SYNC_IN_PROGRESS,
        'A sync operation is already in progress for this user'
      );
    }

    try {
      const results: Record<string, unknown> = {};

      // Execute sync operations directly (no orchestrator)
      // TODO: Implement direct service calls after extracting GoogleSyncService
      for (const syncType of syncTypes) {
        if (syncType === 'backup') {
          // TODO: Call backup service directly
          results.backup = { message: 'Backup sync not yet implemented' };
        } else if (syncType === 'sheets') {
          // TODO: Call sheets service directly
          results.sheets = { message: 'Sheets sync not yet implemented' };
        }
      }

      // TODO: Mark sync complete
      // await activityTracker.markSyncComplete(userId);

      return c.json(
        createSuccessResponse(
          {
            syncTypes,
            results,
            hasChanges,
            timestamp: new Date().toISOString(),
          },
          'Sync completed successfully'
        )
      );
    } finally {
      releaseLock(userId);
    }
  } catch (error) {
    releaseLock(userId);
    return handleSyncError(c, error, 'sync');
  }
});

/**
 * GET /api/sync/status
 * Get sync configuration and status
 */
routes.get('/status', async (c) => {
  const user = c.get('user');
  const userId = user.id;

  try {
    const settings = await settingsRepository.getOrCreate(userId);
    const syncStatus = activityTracker.getSyncStatus(userId);

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

/**
 * POST /api/sync/configure
 * Update sync settings
 */
routes.post('/configure', async (c) => {
  const user = c.get('user');
  const userId = user.id;

  try {
    const body = await c.req.json();

    const updates: {
      googleSheetsSyncEnabled?: boolean;
      googleDriveBackupEnabled?: boolean;
      syncOnInactivity?: boolean;
      syncInactivityMinutes?: number;
    } = {};

    if (typeof body.googleSheetsSyncEnabled === 'boolean') {
      updates.googleSheetsSyncEnabled = body.googleSheetsSyncEnabled;
    }

    if (typeof body.googleDriveBackupEnabled === 'boolean') {
      updates.googleDriveBackupEnabled = body.googleDriveBackupEnabled;
    }

    if (typeof body.syncOnInactivity === 'boolean') {
      updates.syncOnInactivity = body.syncOnInactivity;
    }

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

    await settingsRepository.updateSyncConfig(userId, updates);

    const updatedSettings = await settingsRepository.getOrCreate(userId);

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

// ============================================================================
// BACKUP ROUTES
// ============================================================================

/**
 * GET /api/sync/backups
 * List backups in Google Drive
 */
routes.get('/backups', async (c) => {
  try {
    // TODO: Implement list backups after extracting GoogleSyncService
    return c.json(createSuccessResponse([]));
  } catch (error) {
    return handleSyncError(c, error, 'list backups');
  }
});

/**
 * GET /api/sync/backups/download
 * Download a backup ZIP file of all user data
 */
routes.get('/backups/download', backupRateLimiter, async (c) => {
  const user = c.get('user');
  const userId = user.id;

  try {
    const zipBuffer = await withTimeout(
      backupService.exportAsZip(userId),
      OPERATION_TIMEOUTS.BACKUP,
      'Backup export'
    );

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `vroom-backup-${timestamp}.zip`;

    return new Response(zipBuffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': zipBuffer.length.toString(),
      },
    });
  } catch (error) {
    return handleSyncError(c, error, 'download backup');
  }
});

/**
 * GET /api/sync/backups/:fileId/download
 * Download a specific backup from Google Drive
 */
routes.get('/backups/:fileId/download', async (c) => {
  const user = c.get('user');
  const userId = user.id;
  const fileId = c.req.param('fileId');

  try {
    const driveService = await getDriveServiceForUser(userId);
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

/**
 * DELETE /api/sync/backups/:fileId
 * Delete a specific backup from Google Drive
 */
routes.delete('/backups/:fileId', async (c) => {
  const user = c.get('user');
  const userId = user.id;
  const fileId = c.req.param('fileId');

  try {
    const driveService = await getDriveServiceForUser(userId);
    await driveService.deleteFile(fileId);

    return c.json(createSuccessResponse(undefined, 'Backup deleted successfully'));
  } catch (error) {
    return handleSyncError(c, error, 'delete backup');
  }
});

/**
 * POST /api/sync/backups/initialize-drive
 * Initialize Google Drive folder structure and check for existing backups
 */
routes.post('/backups/initialize-drive', driveInitRateLimiter, async (c) => {
  const user = c.get('user');
  const _userId = user.id;

  try {
    // TODO: Implement initialize drive after extracting GoogleSyncService
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

// ============================================================================
// RESTORE ROUTES
// ============================================================================

/**
 * POST /api/sync/restore/from-backup
 * Restore data from an uploaded backup file
 */
routes.post(
  '/restore/from-backup',
  restoreRateLimiter,
  bodyLimit({ maxSize: CONFIG.backup.maxFileSize }),
  idempotency({ required: true }),
  async (c) => {
    const user = c.get('user');
    const userId = user.id;

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
          `Invalid mode. Supported modes: ${CONFIG.backup.supportedModes.join(', ')}`
        );
      }

      const fileBuffer = Buffer.from(await file.arrayBuffer());

      const sizeValidation = backupService.validateFileSize(fileBuffer.length);
      if (!sizeValidation.valid) {
        throw new SyncError(SyncErrorCode.VALIDATION_ERROR, sizeValidation.errors[0]);
      }

      const result = await withTimeout(
        restoreService.restoreFromBackup(
          userId,
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

/**
 * POST /api/sync/restore/from-sheets
 * Restore data from Google Sheets
 */
routes.post(
  '/restore/from-sheets',
  restoreRateLimiter,
  idempotency({ required: true }),
  async (c) => {
    const user = c.get('user');
    const userId = user.id;

    try {
      const body = await c.req.json();
      const mode = body.mode || 'preview';

      if (!CONFIG.backup.supportedModes.includes(mode as never)) {
        throw new SyncError(
          SyncErrorCode.VALIDATION_ERROR,
          `Invalid mode. Supported modes: ${CONFIG.backup.supportedModes.join(', ')}`
        );
      }

      const result = await withTimeout(
        restoreService.restoreFromSheets(userId, mode as 'preview' | 'merge' | 'replace'),
        OPERATION_TIMEOUTS.RESTORE,
        'Restore from sheets'
      );

      return c.json(createSuccessResponse(result, 'Restore operation completed'));
    } catch (error) {
      return handleSyncError(c, error, 'restore from sheets');
    }
  }
);

/**
 * POST /api/sync/restore/auto
 * Automatically restore from the latest Google Drive backup
 */
routes.post('/restore/auto', restoreRateLimiter, idempotency({ required: true }), async (c) => {
  const user = c.get('user');
  const userId = user.id;

  try {
    const result = await withTimeout(
      restoreService.autoRestoreFromLatestBackup(userId),
      OPERATION_TIMEOUTS.RESTORE,
      'Auto restore'
    );

    return c.json(createSuccessResponse(result, 'Auto restore completed'));
  } catch (error) {
    return handleSyncError(c, error, 'auto restore');
  }
});

export { routes };
