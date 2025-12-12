/**
 * Backup Routes - Backup management operations
 */

import { Hono } from 'hono';
import { RATE_LIMITS } from '../../lib/constants/rate-limits';
import {
  createSuccessResponse,
  handleSyncError,
  SyncError,
  SyncErrorCode,
} from '../../lib/core/errors/';
import { rateLimiter } from '../../lib/middleware/rate-limiter';
import { syncOrchestrator } from '../../lib/services/sync/sync-orchestrator';
import { logger } from '../../lib/utils/logger';
import { OPERATION_TIMEOUTS, withTimeout } from '../../lib/utils/timeout';

const backupRoutes = new Hono();

// Rate limiters
const backupRateLimiter = rateLimiter({
  ...RATE_LIMITS.BACKUP,
  keyGenerator: (c) => c.get('user').id,
});

const driveInitRateLimiter = rateLimiter({
  ...RATE_LIMITS.DRIVE_INIT,
  keyGenerator: (c) => c.get('user').id,
});

/**
 * GET /api/sync/backups
 * List backups in Google Drive
 */
backupRoutes.get('/', async (c) => {
  const user = c.get('user');
  const userId = user.id;

  try {
    const backups = await syncOrchestrator.listDriveBackups(userId);
    return c.json(createSuccessResponse({ backups }));
  } catch (error) {
    return handleSyncError(c, error, 'list backups', 'LIST_BACKUPS_FAILED');
  }
});

/**
 * GET /api/sync/backups/download
 * Download a backup ZIP file of all user data
 */
backupRoutes.get('/download', backupRateLimiter, async (c) => {
  const user = c.get('user');
  const userId = user.id;

  try {
    const zipBuffer = await withTimeout(
      syncOrchestrator.exportBackupAsZip(userId),
      OPERATION_TIMEOUTS.BACKUP,
      'Export backup as ZIP'
    );

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const fileName = `vroom-backup-${timestamp}.zip`;

    logger.info('Backup downloaded', { userId, fileName, size: zipBuffer.length });

    return new Response(zipBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Length': zipBuffer.length.toString(),
      },
    });
  } catch (error) {
    return handleSyncError(c, error, 'generate backup', 'BACKUP_GENERATION_FAILED');
  }
});

/**
 * GET /api/sync/backups/:fileId/download
 * Download a specific backup from Google Drive
 */
backupRoutes.get('/:fileId/download', async (c) => {
  const user = c.get('user');
  const userId = user.id;
  const fileId = c.req.param('fileId');

  if (!fileId || fileId.trim() === '') {
    throw new SyncError(SyncErrorCode.VALIDATION_ERROR, 'fileId parameter is required');
  }

  try {
    const { buffer, metadata } = await withTimeout(
      syncOrchestrator.downloadBackupFromDrive(userId, fileId),
      OPERATION_TIMEOUTS.DOWNLOAD,
      'Download backup from Drive'
    );

    logger.info('Backup downloaded from Drive', { userId, fileId, fileName: metadata.name });

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${metadata.name || 'backup.zip'}"`,
        'Content-Length': buffer.length.toString(),
      },
    });
  } catch (error) {
    return handleSyncError(c, error, 'download backup from Drive', 'DOWNLOAD_BACKUP_FAILED');
  }
});

/**
 * DELETE /api/sync/backups/:fileId
 * Delete a specific backup from Google Drive
 */
backupRoutes.delete('/:fileId', async (c) => {
  const user = c.get('user');
  const userId = user.id;
  const fileId = c.req.param('fileId');

  if (!fileId || fileId.trim() === '') {
    throw new SyncError(SyncErrorCode.VALIDATION_ERROR, 'fileId parameter is required');
  }

  try {
    await syncOrchestrator.deleteBackupFromDrive(userId, fileId);

    logger.info('Backup deleted from Drive', { userId, fileId });

    return c.json(createSuccessResponse(undefined, 'Backup deleted successfully'));
  } catch (error) {
    return handleSyncError(c, error, 'delete backup from Drive', 'DELETE_BACKUP_FAILED');
  }
});

/**
 * POST /api/sync/backups/initialize-drive
 * Initialize Google Drive folder structure and check for existing backups
 */
backupRoutes.post('/initialize-drive', driveInitRateLimiter, async (c) => {
  const user = c.get('user');
  const userId = user.id;

  try {
    const result = await withTimeout(
      syncOrchestrator.initializeDrive(userId),
      OPERATION_TIMEOUTS.DRIVE_INIT,
      'Initialize Google Drive'
    );

    return c.json(
      createSuccessResponse(
        {
          folderStructure: result.folderStructure,
          existingBackups: result.existingBackups,
        },
        result.existingBackups.length > 0
          ? `Found ${result.existingBackups.length} existing backup(s)`
          : 'No existing backups found'
      )
    );
  } catch (error) {
    return handleSyncError(c, error, 'initialize Google Drive', 'INITIALIZE_FAILED');
  }
});

export { backupRoutes };
