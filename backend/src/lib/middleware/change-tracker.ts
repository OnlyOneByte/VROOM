import type { Context, Next } from 'hono';
import { markDataChanged } from '../change-tracker';

/**
 * Middleware to track data changes after successful mutations
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

  // If the response was successful (2xx status), mark data as changed
  const status = c.res.status;
  if (status >= 200 && status < 300) {
    const user = c.get('user');
    if (user?.id) {
      markDataChanged(user.id);
    }
  }
}
