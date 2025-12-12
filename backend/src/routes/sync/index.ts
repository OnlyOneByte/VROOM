/**
 * Sync Routes - Main sync orchestration and configuration
 */

import { Hono } from 'hono';
import { RATE_LIMITS } from '../../lib/constants/rate-limits';
import {
  createSuccessResponse,
  handleSyncError,
  SyncError,
  SyncErrorCode,
} from '../../lib/core/errors/';
import { requireAuth } from '../../lib/middleware/auth';
import { idempotencyMiddleware } from '../../lib/middleware/idempotency';
import { rateLimiter } from '../../lib/middleware/rate-limiter';
import { settingsRepository } from '../../lib/repositories';
import { syncOrchestrator } from '../../lib/services/sync/sync-orchestrator';
import { changeTracker } from '../../lib/services/sync/tracking/user-activity-tracker';
import { logger } from '../../lib/utils/logger';
import { OPERATION_TIMEOUTS, withTimeout } from '../../lib/utils/timeout';
import { backupRoutes } from './backups';
import { restoreRoutes } from './restore';

const sync = new Hono();

// Apply authentication to all routes
sync.use('*', requireAuth);

// Mount sub-routes
sync.route('/backups', backupRoutes);
sync.route('/restore', restoreRoutes);

/**
 * GET /api/sync/health
 * Health check endpoint for sync service
 */
sync.get('/health', async (c) => {
  const activeLocks = syncOrchestrator.getActiveLockCount();

  return c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    activeLocks,
    service: 'sync',
  });
});

// Rate limiter for sync operations
const syncRateLimiter = rateLimiter({
  ...RATE_LIMITS.SYNC,
  keyGenerator: (c) => c.get('user').id,
});

/**
 * POST /api/sync
 * Trigger sync operations for specified types
 */
sync.post('/', syncRateLimiter, idempotencyMiddleware({ required: false }), async (c) => {
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
    const invalidTypes = syncTypes.filter((type) => !validSyncTypes.includes(type));

    if (invalidTypes.length > 0) {
      throw new SyncError(
        SyncErrorCode.VALIDATION_ERROR,
        `Invalid sync types: ${invalidTypes.join(', ')}. Valid types are: ${validSyncTypes.join(', ')}`
      );
    }

    logger.info('Sync request received', { userId, syncTypes });

    const hasChanges = await changeTracker.hasChangesSinceLastSync(userId);

    // Acquire lock - single check to prevent race condition
    const acquired = await syncOrchestrator.acquireLock(userId);
    if (!acquired) {
      throw new SyncError(
        SyncErrorCode.SYNC_IN_PROGRESS,
        'A sync operation is already in progress for this user'
      );
    }

    try {
      const result = await withTimeout(
        syncOrchestrator.executeSync(userId, syncTypes),
        OPERATION_TIMEOUTS.SYNC,
        'Sync operation'
      );

      const hasErrors = result.errors && Object.keys(result.errors).length > 0;

      return c.json({
        success: !hasErrors,
        results: result,
        hasChangesSinceLastSync: hasChanges,
        message: hasChanges
          ? 'Sync completed successfully'
          : 'Sync completed - no changes detected since last sync',
      });
    } catch (error) {
      return handleSyncError(c, error, 'execute sync operation', 'SYNC_FAILED');
    } finally {
      syncOrchestrator.releaseLock(userId);
    }
  } catch (error) {
    return handleSyncError(c, error, 'execute sync operation', 'SYNC_FAILED');
  }
});

/**
 * GET /api/sync/status
 * Get sync configuration and status
 */
sync.get('/status', async (c) => {
  const user = c.get('user');
  const userId = user.id;

  try {
    const settings = await settingsRepository.getByUserId(userId);

    if (!settings) {
      throw new SyncError(SyncErrorCode.VALIDATION_ERROR, 'User settings not found');
    }

    const enabledTypes: string[] = [];
    if (settings.googleSheetsSyncEnabled) {
      enabledTypes.push('sheets');
    }
    if (settings.googleDriveBackupEnabled) {
      enabledTypes.push('backup');
    }

    const hasChanges = await changeTracker.hasChangesSinceLastSync(userId);

    return c.json(
      createSuccessResponse({
        googleSheetsSyncEnabled: settings.googleSheetsSyncEnabled,
        googleDriveBackupEnabled: settings.googleDriveBackupEnabled,
        syncInactivityMinutes: settings.syncInactivityMinutes,
        lastSyncDate: settings.lastSyncDate?.toISOString() || null,
        lastBackupDate: settings.lastBackupDate?.toISOString() || null,
        lastDataChangeDate: settings.lastDataChangeDate?.toISOString() || null,
        hasChangesSinceLastSync: hasChanges,
        enabledTypes,
        syncInProgress: syncOrchestrator.isLocked(userId),
      })
    );
  } catch (error) {
    return handleSyncError(c, error, 'get sync status', 'STATUS_FAILED');
  }
});

/**
 * POST /api/sync/configure
 * Update sync settings
 */
sync.post('/configure', async (c) => {
  const user = c.get('user');
  const userId = user.id;

  try {
    const body = await c.req.json();
    const { googleSheetsSyncEnabled, googleDriveBackupEnabled, syncInactivityMinutes } = body;

    // Validate required fields
    if (
      typeof googleSheetsSyncEnabled !== 'boolean' ||
      typeof googleDriveBackupEnabled !== 'boolean'
    ) {
      throw new SyncError(
        SyncErrorCode.VALIDATION_ERROR,
        'googleSheetsSyncEnabled and googleDriveBackupEnabled must be boolean values'
      );
    }

    // Validate optional field
    if (
      syncInactivityMinutes !== undefined &&
      (typeof syncInactivityMinutes !== 'number' || syncInactivityMinutes < 1)
    ) {
      throw new SyncError(
        SyncErrorCode.VALIDATION_ERROR,
        'syncInactivityMinutes must be a positive number'
      );
    }

    await settingsRepository.updateSyncConfig(userId, {
      googleSheetsSyncEnabled,
      googleDriveBackupEnabled,
      syncInactivityMinutes,
    });

    logger.info('Sync settings updated', {
      userId,
      googleSheetsSyncEnabled,
      googleDriveBackupEnabled,
    });

    return c.json(
      createSuccessResponse(
        {
          googleSheetsSyncEnabled,
          googleDriveBackupEnabled,
          syncInactivityMinutes,
        },
        'Sync settings updated successfully'
      )
    );
  } catch (error) {
    return handleSyncError(c, error, 'configure sync settings', 'CONFIGURE_FAILED');
  }
});

export { sync };
