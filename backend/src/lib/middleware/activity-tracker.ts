import type { Context, Next } from 'hono';
import { settingsRepository } from '../repositories';
import { userActivityTracker } from '../services/sync/tracking/user-activity-tracker';
import { logger } from '../utils/logger';

/**
 * Middleware to automatically track user activity for authenticated requests
 * This is a thin wrapper that delegates all logic to the UserActivityTracker service
 */
export const activityTrackerMiddleware = async (c: Context, next: Next) => {
  // Continue with the request
  await next();

  // Delegate to service for activity tracking
  const user = c.get('user');
  if (!user) {
    return;
  }

  try {
    // Determine if this request should be tracked
    const path = c.req.path;
    const method = c.req.method;

    const shouldTrack =
      // API endpoints that modify data
      (path.startsWith('/api/') && ['POST', 'PUT', 'DELETE'].includes(method)) ||
      // Getting user data (indicates active usage)
      (path.startsWith('/api/') && method === 'GET' && !path.includes('/status')) ||
      // Auth endpoints (login, refresh)
      path.startsWith('/auth/');

    if (!shouldTrack) {
      return;
    }

    // Fetch user settings and delegate to service
    const settings = await settingsRepository.getOrCreate(user.id);

    // Only record activity if sync on inactivity is enabled and at least one sync type is enabled
    const hasSyncEnabled = settings.googleSheetsSyncEnabled || settings.googleDriveBackupEnabled;
    if (settings.syncOnInactivity && hasSyncEnabled) {
      userActivityTracker.recordActivity(user.id, {
        enabled: true,
        inactivityDelayMinutes: settings.syncInactivityMinutes,
        autoSyncEnabled: true,
      });
    }
  } catch (error) {
    // Log error but don't fail the request
    logger.error('Activity tracking failed', { userId: user.id, error });
  }
};
