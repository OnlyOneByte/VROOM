import type { Context, Next } from 'hono';
import { recordUserActivity } from '../activity-tracker';

/**
 * Middleware to automatically track user activity for authenticated requests
 */
export const activityTrackerMiddleware = async (c: Context, next: Next) => {
  // Continue with the request
  await next();

  // Record activity after successful request (only for authenticated users)
  const user = c.get('user');
  if (user) {
    // Only track activity for certain endpoints (not for status checks, etc.)
    const path = c.req.path;
    const method = c.req.method;

    // Track activity for data-modifying operations and main app usage
    const shouldTrack =
      // API endpoints that modify data
      (path.startsWith('/api/') && ['POST', 'PUT', 'DELETE'].includes(method)) ||
      // Getting user data (indicates active usage)
      (path.startsWith('/api/') && method === 'GET' && !path.includes('/status')) ||
      // Auth endpoints (login, refresh)
      path.startsWith('/auth/');

    if (shouldTrack) {
      recordUserActivity(user.id, {
        enabled: true,
        inactivityDelayMinutes: 5, // Default 5 minutes
        autoSyncEnabled: true,
      });
    }
  }
};
