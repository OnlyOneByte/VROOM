/**
 * Consolidated Middleware Module
 *
 * This file consolidates all middleware from:
 * - lib/middleware/auth.ts
 * - lib/middleware/body-limit.ts
 * - lib/middleware/rate-limiter.ts
 * - lib/middleware/error-handler.ts
 * - lib/middleware/idempotency.ts
 * - lib/middleware/activity-tracker.ts
 * - lib/middleware/change-tracker.ts
 * - lib/middleware/checkpoint.ts
 *
 * Single source for all middleware functions.
 */

import type { Context, ErrorHandler, MiddlewareHandler, Next } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import type { AuthUser } from './auth/lucia';
import { getLucia } from './auth/lucia';
import { CONFIG } from './config';
import { checkpointWAL } from './db/connection';
import {
  createErrorResponse,
  formatErrorResponse,
  handleDatabaseError,
  isAppError,
  SyncError,
  SyncErrorCode,
  ValidationError,
} from './errors';
import { settingsRepository } from './settings/repository';
import { activityTracker as userActivityTracker } from './sync/activity-tracker';
import { logger } from './utils/logger';

// ============================================================================
// CONTEXT TYPE EXTENSIONS
// ============================================================================

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser;
    session: {
      id: string;
      expiresAt: Date;
    };
  }
}

// ============================================================================
// AUTHENTICATION MIDDLEWARE
// ============================================================================

/**
 * Authentication middleware - requires valid session
 */
export const requireAuth: MiddlewareHandler = async (c, next) => {
  try {
    const lucia = getLucia();
    const sessionId = getCookie(c, lucia.sessionCookieName);

    if (!sessionId) {
      throw new HTTPException(401, { message: 'Authentication required' });
    }

    const { session, user } = await lucia.validateSession(sessionId);

    if (!session || !user) {
      // Invalid session, clear cookie
      deleteCookie(c, lucia.sessionCookieName, {
        path: '/',
        secure: CONFIG.env === 'production',
        httpOnly: true,
        maxAge: 60 * 60 * 24 * 30,
        sameSite: 'Lax',
      });
      throw new HTTPException(401, { message: 'Invalid or expired session' });
    }

    // If session is close to expiry, refresh it
    const now = new Date();
    const sessionExpiry = new Date(session.expiresAt);
    const timeUntilExpiry = sessionExpiry.getTime() - now.getTime();
    const oneDay = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

    if (timeUntilExpiry < oneDay) {
      // Refresh session - create new one first to avoid losing session if creation fails
      try {
        const newSession = await lucia.createSession(user.id, {});

        setCookie(c, lucia.sessionCookieName, newSession.id, {
          path: '/',
          secure: CONFIG.env === 'production',
          httpOnly: true,
          maxAge: 60 * 60 * 24 * 30, // 30 days
          expires: newSession.expiresAt,
          sameSite: 'Lax',
        });

        // Only invalidate old session after new one is successfully created
        await lucia.invalidateSession(session.id);

        // Update session in context
        c.set('session', {
          id: newSession.id,
          expiresAt: newSession.expiresAt,
        });
      } catch (error) {
        logger.warn('Session refresh failed, keeping existing session', { error });
        // Keep existing session if refresh fails
        c.set('session', {
          id: session.id,
          expiresAt: session.expiresAt,
        });
      }
    } else {
      c.set('session', {
        id: session.id,
        expiresAt: session.expiresAt,
      });
    }

    // Set user in context
    c.set('user', user);

    return next();
  } catch (error) {
    logger.error('Auth middleware error', { error });

    if (error instanceof HTTPException) {
      throw error;
    }

    throw new HTTPException(500, { message: 'Authentication error' });
  }
};

/**
 * Optional authentication middleware - sets user if session exists but doesn't require it
 */
export const optionalAuth: MiddlewareHandler = async (c, next) => {
  try {
    const lucia = getLucia();
    const sessionId = getCookie(c, lucia.sessionCookieName);

    if (sessionId) {
      const { session, user } = await lucia.validateSession(sessionId);

      if (session && user) {
        c.set('user', user);
        c.set('session', {
          id: session.id,
          expiresAt: session.expiresAt,
        });
      }
    }

    return next();
  } catch (error) {
    logger.error('Optional auth middleware error', { error });
    // Don't throw error for optional auth, just continue without user
    return next();
  }
};

// ============================================================================
// BODY LIMIT MIDDLEWARE
// ============================================================================

interface BodyLimitConfig {
  maxSize: number; // Maximum size in bytes
  message?: string;
}

/**
 * Create a body size limit middleware
 */
export function bodyLimit(config: BodyLimitConfig) {
  return async (c: Context, next: Next) => {
    const contentLength = c.req.header('content-length');

    if (contentLength) {
      const size = Number.parseInt(contentLength, 10);

      if (size > config.maxSize) {
        const sizeMB = (size / 1024 / 1024).toFixed(2);
        const maxSizeMB = (config.maxSize / 1024 / 1024).toFixed(2);

        return c.json(
          createErrorResponse(
            'PAYLOAD_TOO_LARGE',
            config.message ||
              `Request body exceeds maximum size of ${maxSizeMB}MB (received: ${sizeMB}MB)`
          ),
          413
        );
      }
    }

    return next();
  };
}

// ============================================================================
// RATE LIMITER MIDDLEWARE
// ============================================================================

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  limit: number; // Max requests per window
  keyGenerator: (c: Context) => string; // Function to generate rate limit key
  message?: string;
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Clean up expired entries periodically
 */
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetTime < now) {
      rateLimitStore.delete(key);
    }
  }
}, CONFIG.rateLimit.cleanupInterval);

/**
 * Create a rate limiter middleware
 */
export function rateLimiter(config: RateLimitConfig) {
  return async (c: Context, next: Next) => {
    const key = config.keyGenerator(c);
    const now = Date.now();

    let entry = rateLimitStore.get(key);

    if (!entry || entry.resetTime < now) {
      // Create new entry or reset expired entry
      entry = {
        count: 1,
        resetTime: now + config.windowMs,
      };
      rateLimitStore.set(key, entry);
      return next();
    }

    if (entry.count >= config.limit) {
      const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
      return c.json(
        createErrorResponse(
          'RATE_LIMIT_EXCEEDED',
          config.message || 'Too many requests. Please try again later.',
          { retryAfter }
        ),
        429,
        {
          'Retry-After': retryAfter.toString(),
          'X-RateLimit-Limit': config.limit.toString(),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': entry.resetTime.toString(),
        }
      );
    }

    entry.count++;
    rateLimitStore.set(key, entry);

    return next();
  };
}

// ============================================================================
// IDEMPOTENCY MIDDLEWARE
// ============================================================================

interface IdempotencyRecord {
  response: unknown;
  timestamp: number;
  status: number;
}

/**
 * In-memory idempotency store
 *
 * ⚠️ PRODUCTION WARNING:
 * This is an in-memory implementation that will NOT work correctly in:
 * - Multi-instance deployments (each instance has its own cache)
 * - Serverless environments (cache is lost between invocations)
 * - Load-balanced setups (requests may hit different instances)
 *
 * For production, replace with:
 * - Redis (recommended): Fast, distributed, with TTL support
 * - Database table: Persistent but slower
 * - Memcached: Fast but no persistence
 */
class IdempotencyStore {
  private store = new Map<string, IdempotencyRecord>();
  private readonly TTL = 24 * 60 * 60 * 1000; // 24 hours

  set(key: string, response: unknown, status: number): void {
    this.store.set(key, {
      response,
      timestamp: Date.now(),
      status,
    });

    // Clean up old entries
    this.cleanup();
  }

  get(key: string): IdempotencyRecord | undefined {
    const record = this.store.get(key);

    if (!record) {
      return undefined;
    }

    // Check if expired
    if (Date.now() - record.timestamp > this.TTL) {
      this.store.delete(key);
      return undefined;
    }

    return record;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.store.entries()) {
      if (now - record.timestamp > this.TTL) {
        this.store.delete(key);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }
}

const idempotencyStore = new IdempotencyStore();

/**
 * Idempotency middleware
 * Requires an Idempotency-Key header for POST/PUT/DELETE requests
 */
export function idempotency(options: { required?: boolean } = {}) {
  return async (c: Context, next: Next) => {
    const method = c.req.method;

    // Only apply to mutating operations
    if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
      return next();
    }

    const idempotencyKey = c.req.header('Idempotency-Key');

    // If idempotency key is not provided
    if (!idempotencyKey) {
      if (options.required) {
        throw new SyncError(
          SyncErrorCode.VALIDATION_ERROR,
          'Idempotency-Key header is required for this operation'
        );
      }
      // If not required, proceed without idempotency
      return next();
    }

    const userId = c.get('user')?.id || 'anonymous';
    const storeKey = `${userId}:${idempotencyKey}`;

    // Check if we've seen this key before
    const cached = idempotencyStore.get(storeKey);
    if (cached) {
      logger.info('Idempotent request detected, returning cached response', {
        userId,
        idempotencyKey,
        age: Date.now() - cached.timestamp,
      });

      return c.json(cached.response, cached.status as never);
    }

    // Execute the request
    await next();

    // Cache the response
    const response = c.res.clone();
    const responseBody = await response.json();
    const status = response.status;

    // Only cache successful responses (2xx)
    if (status >= 200 && status < 300) {
      idempotencyStore.set(storeKey, responseBody, status);

      logger.info('Cached idempotent response', {
        userId,
        idempotencyKey,
        status,
      });
    }
  };
}

/**
 * Clear idempotency cache (useful for testing)
 */
export function clearIdempotencyCache(): void {
  idempotencyStore.clear();
}

// ============================================================================
// ERROR HANDLER MIDDLEWARE
// ============================================================================

export const errorHandler: ErrorHandler = (err, c) => {
  const isDevelopment = CONFIG.env === 'development';

  // Log error with appropriate level
  if (isAppError(err) && err.statusCode < 500) {
    logger.warn('Client error', { message: err.message, statusCode: err.statusCode });
  } else {
    logger.error('Server error', { error: err });
  }

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    const validationError = new ValidationError('Invalid request data', err.issues);
    const response = formatErrorResponse(validationError, isDevelopment);
    return c.json(response, 400);
  }

  // Handle HTTP exceptions from Hono
  if (err instanceof HTTPException) {
    return c.json(
      {
        error: 'HTTPException',
        message: err.message,
        statusCode: err.status,
        details: err.cause,
      },
      err.status
    );
  }

  // Handle custom app errors
  if (isAppError(err)) {
    const response = formatErrorResponse(err, isDevelopment);
    return c.json(response, err.statusCode as 200 | 201 | 400 | 401 | 403 | 404 | 409 | 422 | 500);
  }

  // Handle database errors (SQLite specific)
  if (err instanceof Error && err.message.includes('SQLITE_')) {
    const dbError = handleDatabaseError(err);
    const response = formatErrorResponse(dbError, isDevelopment);
    return c.json(
      response,
      dbError.statusCode as 200 | 201 | 400 | 401 | 403 | 404 | 409 | 422 | 500
    );
  }

  // Generic error handler for unknown errors
  const response = formatErrorResponse(err, isDevelopment);
  return c.json(
    response,
    response.statusCode as 200 | 201 | 400 | 401 | 403 | 404 | 409 | 422 | 500
  );
};

// ============================================================================
// ACTIVITY TRACKER MIDDLEWARE
// ============================================================================

/**
 * Middleware to automatically track user activity for authenticated requests
 * This is a thin wrapper that delegates all logic to the UserActivityTracker service
 */
export const activityTracker: MiddlewareHandler = async (c, next) => {
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

// ============================================================================
// CHANGE TRACKER MIDDLEWARE
// ============================================================================

/**
 * Middleware to track data changes after successful mutations
 * This is a thin wrapper that delegates all logic to the UserActivityTracker service
 * Should be applied to routes that modify user data (POST, PUT, PATCH, DELETE)
 */
export async function changeTracker(c: Context, next: Next) {
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

// ============================================================================
// CHECKPOINT MIDDLEWARE
// ============================================================================

/**
 * Middleware to checkpoint WAL after write operations
 * This ensures data is persisted to the main database file
 */
export const checkpointAfterWrite: MiddlewareHandler = async (c, next) => {
  await next();

  // Only checkpoint after successful write operations (POST, PUT, DELETE)
  const method = c.req.method;
  const isWriteOperation = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method);

  if (isWriteOperation && c.res.status >= 200 && c.res.status < 300) {
    // Checkpoint in the background to avoid blocking the response
    setImmediate(() => {
      checkpointWAL();
    });
  }
};
