/**
 * Restore Routes - Data restoration operations
 */

import { Hono } from 'hono';
import { BACKUP_CONFIG, RATE_LIMITS } from '../../lib/constants';
import {
  createSuccessResponse,
  handleSyncError,
  SyncError,
  SyncErrorCode,
} from '../../lib/core/errors';
import { bodyLimit } from '../../lib/middleware/body-limit';
import { idempotencyMiddleware } from '../../lib/middleware/idempotency';
import { rateLimiter } from '../../lib/middleware/rate-limiter';
import { backupService, syncOrchestrator } from '../../lib/services/sync';
import { logger } from '../../lib/utils/logger';
import { OPERATION_TIMEOUTS, withTimeout } from '../../lib/utils/timeout';

const restoreRoutes = new Hono();

// Rate limiter for restore operations
const restoreRateLimiter = rateLimiter({
  ...RATE_LIMITS.RESTORE,
  keyGenerator: (c) => c.get('user').id,
});

// Apply body size limit to restore endpoints
restoreRoutes.use(
  '/from-backup',
  bodyLimit({
    maxSize: BACKUP_CONFIG.MAX_FILE_SIZE,
  })
);

/**
 * POST /api/sync/restore/from-backup
 * Restore data from an uploaded backup file
 */
restoreRoutes.post(
  '/from-backup',
  restoreRateLimiter,
  idempotencyMiddleware({ required: true }),
  async (c) => {
    const user = c.get('user');
    const userId = user.id;

    try {
      const body = await c.req.parseBody();
      const file = body.file;
      const mode = typeof body.mode === 'string' ? body.mode : 'preview';

      logger.info('Restore from backup request received', { userId, mode, hasFile: !!file });

      if (!file || !(file instanceof File)) {
        throw new SyncError(
          SyncErrorCode.VALIDATION_ERROR,
          'No file uploaded or invalid file format'
        );
      }

      // Validate MIME type
      const validMimeTypes = [
        'application/zip',
        'application/x-zip-compressed',
        'application/octet-stream',
      ];
      if (file.type && !validMimeTypes.includes(file.type)) {
        throw new SyncError(
          SyncErrorCode.VALIDATION_ERROR,
          'Invalid file type. Only ZIP files are supported.'
        );
      }

      // Validate file size
      const sizeValidation = backupService.validateFileSize(file.size);
      if (!sizeValidation.valid) {
        throw new SyncError(
          SyncErrorCode.VALIDATION_ERROR,
          sizeValidation.errors[0] || 'File too large'
        );
      }

      // Validate restore mode
      // biome-ignore lint/suspicious/noExplicitAny: Type assertion needed for const array includes check
      if (!BACKUP_CONFIG.SUPPORTED_MODES.includes(mode as any)) {
        throw new SyncError(
          SyncErrorCode.VALIDATION_ERROR,
          `Invalid restore mode. Must be one of: ${BACKUP_CONFIG.SUPPORTED_MODES.join(', ')}`
        );
      }

      const arrayBuffer = await file.arrayBuffer();
      const fileBuffer = Buffer.from(arrayBuffer);

      const result = await withTimeout(
        syncOrchestrator.restoreFromBackup(
          userId,
          fileBuffer,
          mode as 'preview' | 'replace' | 'merge'
        ),
        OPERATION_TIMEOUTS.RESTORE,
        'Restore from backup'
      );

      logger.info('Restore from backup completed', { userId, mode, success: result.success });

      return c.json(result);
    } catch (error) {
      return handleSyncError(c, error, 'restore from backup', 'RESTORE_FAILED');
    }
  }
);

/**
 * POST /api/sync/restore/from-sheets
 * Restore data from Google Sheets
 */
restoreRoutes.post(
  '/from-sheets',
  restoreRateLimiter,
  idempotencyMiddleware({ required: true }),
  async (c) => {
    const user = c.get('user');
    const userId = user.id;

    try {
      const body = await c.req.json();
      const mode = typeof body.mode === 'string' ? body.mode : 'preview';

      // Validate restore mode
      // biome-ignore lint/suspicious/noExplicitAny: Type assertion needed for const array includes check
      if (!BACKUP_CONFIG.SUPPORTED_MODES.includes(mode as any)) {
        throw new SyncError(
          SyncErrorCode.VALIDATION_ERROR,
          `Invalid restore mode. Must be one of: ${BACKUP_CONFIG.SUPPORTED_MODES.join(', ')}`
        );
      }

      const result = await withTimeout(
        syncOrchestrator.restoreFromSheets(userId, mode as 'preview' | 'replace' | 'merge'),
        OPERATION_TIMEOUTS.RESTORE,
        'Restore from sheets'
      );

      logger.info('Restore from sheets completed', { userId, mode, success: result.success });

      return c.json(result);
    } catch (error) {
      return handleSyncError(c, error, 'restore from Google Sheets', 'RESTORE_FAILED');
    }
  }
);

/**
 * POST /api/sync/restore/auto
 * Automatically restore from the latest Google Drive backup
 */
restoreRoutes.post(
  '/auto',
  restoreRateLimiter,
  idempotencyMiddleware({ required: true }),
  async (c) => {
    const user = c.get('user');
    const userId = user.id;

    try {
      const result = await withTimeout(
        syncOrchestrator.autoRestoreFromLatestBackup(userId),
        OPERATION_TIMEOUTS.RESTORE,
        'Auto-restore from backup'
      );

      if (result.restored) {
        logger.info('Auto-restore successful', { userId, backupInfo: result.backupInfo });

        return c.json(
          createSuccessResponse(
            {
              restored: true,
              backupInfo: result.backupInfo,
              summary: result.summary,
            },
            'Successfully restored data from latest backup'
          )
        );
      }

      return c.json(
        createSuccessResponse(
          {
            restored: false,
          },
          result.error || 'Failed to restore from backup'
        )
      );
    } catch (error) {
      return handleSyncError(c, error, 'auto-restore from backup', 'AUTO_RESTORE_FAILED');
    }
  }
);

export { restoreRoutes };
