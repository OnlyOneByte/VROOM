/**
 * Middleware Module - Re-exports for cleaner imports
 *
 * This file provides a single entry point for all middleware,
 * making imports cleaner throughout the application.
 *
 * Usage:
 *   import { requireAuth, rateLimiter, bodyLimit } from './middleware';
 *
 * Available Middleware:
 * - requireAuth: Requires authentication, throws 401 if not authenticated
 * - optionalAuth: Sets user context if authenticated, doesn't throw if not
 * - bodyLimit: Limits request body size to prevent DoS attacks
 * - rateLimiter: Rate limits requests per user/IP
 * - idempotency: Prevents duplicate operations via idempotency keys
 * - errorHandler: Global error handler for consistent error responses
 * - activityTracker: Tracks user activity for auto-sync
 * - changeTracker: Marks data changes for sync purposes
 */

export { activityTracker, changeTracker } from './activity';
export { optionalAuth, requireAuth } from './auth';
export { bodyLimit } from './body-limit';
export { errorHandler } from './error-handler';
export { idempotency } from './idempotency';
export { rateLimiter } from './rate-limit';
