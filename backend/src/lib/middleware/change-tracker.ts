import type { Context, Next } from 'hono';
import { userActivityTracker } from '../services/sync/tracking/user-activity-tracker';
import { logger } from '../utils/logger';

/**
 * Middleware to track data changes after successful mutations
 * This is a thin wrapper that delegates all logic to the UserActivityTracker service
 * Should be applied to routes that modify user data (POST, PUT, PATCH, DELETE)
 */
export async function trackDataChanges(c: Context, next: Next) {
  // Only track changes for mutation methods
  const method = c.req.method;
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return next();
  }

  // Execute the route handler
  await next();

  // If the response was successful (2xx status), delegate to service to mark data as changed
  const status = c.res.status;
  if (status >= 200 && status < 300) {
    const user = c.get('user');
    if (user?.id) {
      try {
        // Delegate to service (fire and forget)
        userActivityTracker.markDataChanged(user.id).catch((error) => {
          logger.error('Failed to mark data changed', { userId: user.id, error });
        });
      } catch (error) {
        // Log error but don't fail the request
        logger.error('Change tracking failed', { userId: user.id, error });
      }
    }
  }
}
