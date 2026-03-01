/**
 * Activity Tracking Middleware
 *
 * Tracks user activity for auto-sync and data change detection.
 */

import type { Context, MiddlewareHandler, Next } from 'hono';
import { settingsRepository } from '../api/settings/repository';
import { activityTracker as userActivityTracker } from '../api/sync/activity-tracker';
import { logger } from '../utils/logger';

/**
 * Activity tracker middleware
 * Records user activity for auto-sync timing
 */
export const activityTracker: MiddlewareHandler = async (c, next) => {
  await next();

  const user = c.get('user');
  if (!user) return;

  try {
    const path = c.req.path;
    const method = c.req.method;
    const shouldTrack =
      (path.startsWith('/api/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) ||
      path.startsWith('/auth/');

    if (!shouldTrack) return;

    const settings = await settingsRepository.getOrCreate(user.id);
    const hasSyncEnabled = settings.googleSheetsSyncEnabled || settings.googleDriveBackupEnabled;
    if (settings.syncOnInactivity && hasSyncEnabled) {
      userActivityTracker.recordActivity(user.id, settings.syncInactivityMinutes);
    }
  } catch (error) {
    logger.error('Activity tracking failed', { userId: user.id, error });
  }
};

/**
 * Change tracker middleware
 * Marks when data has been modified for sync purposes
 */
export async function changeTracker(c: Context, next: Next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method)) {
    return next();
  }

  await next();

  if (c.res.status >= 200 && c.res.status < 300) {
    const user = c.get('user');
    if (user?.id) {
      // Fire-and-forget: We don't want to block the response for activity tracking
      // If this fails, it only affects sync timing, not data integrity
      userActivityTracker.markDataChanged(user.id).catch((error) => {
        logger.error('Failed to mark data changed', { userId: user.id, error });
      });
    }
  }
}
