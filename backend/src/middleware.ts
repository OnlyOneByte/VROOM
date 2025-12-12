/**
 * Middleware Module - Authentication, rate limiting, error handling, and activity tracking
 */

import type { Context, ErrorHandler, MiddlewareHandler, Next } from 'hono';
import { deleteCookie, getCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import type { AuthUser } from './auth/lucia';
import { getLucia } from './auth/lucia';
import { validateAndRefreshSession } from './auth/utils';
import { CONFIG } from './config';
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

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser;
    session: { id: string; expiresAt: Date };
  }
}

export const requireAuth: MiddlewareHandler = async (c, next) => {
  const lucia = getLucia();
  const sessionId = getCookie(c, lucia.sessionCookieName);

  if (!sessionId) {
    throw new HTTPException(401, { message: 'Authentication required' });
  }

  const result = await validateAndRefreshSession(sessionId, lucia, c);
  if (!result) {
    deleteCookie(c, lucia.sessionCookieName, {
      path: '/',
      secure: CONFIG.env === 'production',
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 30,
      sameSite: 'Lax',
    });
    throw new HTTPException(401, { message: 'Invalid or expired session' });
  }

  c.set('session', { id: result.session.id, expiresAt: result.session.expiresAt });
  c.set('user', result.user);
  return next();
};

export const optionalAuth: MiddlewareHandler = async (c, next) => {
  try {
    const lucia = getLucia();
    const sessionId = getCookie(c, lucia.sessionCookieName);

    if (sessionId) {
      const { session, user } = await lucia.validateSession(sessionId);
      if (session && user) {
        c.set('user', user);
        c.set('session', { id: session.id, expiresAt: session.expiresAt });
      }
    }
  } catch (error) {
    logger.error('Optional auth error', { error });
  }
  return next();
};

interface BodyLimitConfig {
  maxSize: number;
  message?: string;
}

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

interface RateLimitConfig {
  windowMs: number;
  limit: number;
  keyGenerator: (c: Context) => string;
  message?: string;
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetTime < now) rateLimitStore.delete(key);
  }
}, CONFIG.rateLimit.cleanupInterval);

export function rateLimiter(config: RateLimitConfig) {
  return async (c: Context, next: Next) => {
    const key = config.keyGenerator(c);
    const now = Date.now();
    const entry = rateLimitStore.get(key);

    if (!entry || entry.resetTime < now) {
      rateLimitStore.set(key, { count: 1, resetTime: now + config.windowMs });
      return next();
    }

    if (entry.count >= config.limit) {
      const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
      return c.json(
        createErrorResponse('RATE_LIMIT_EXCEEDED', config.message || 'Too many requests', {
          retryAfter,
        }),
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
    return next();
  };
}

interface IdempotencyRecord {
  response: unknown;
  timestamp: number;
  status: number;
}

class IdempotencyStore {
  private store = new Map<string, IdempotencyRecord>();
  private readonly TTL = 24 * 60 * 60 * 1000;

  set(key: string, response: unknown, status: number): void {
    this.store.set(key, { response, timestamp: Date.now(), status });
    this.cleanup();
  }

  get(key: string): IdempotencyRecord | undefined {
    const record = this.store.get(key);
    if (!record || Date.now() - record.timestamp > this.TTL) {
      this.store.delete(key);
      return undefined;
    }
    return record;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.store.entries()) {
      if (now - record.timestamp > this.TTL) this.store.delete(key);
    }
  }
}

const idempotencyStore = new IdempotencyStore();

export function idempotency(options: { required?: boolean } = {}) {
  return async (c: Context, next: Next) => {
    if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(c.req.method)) {
      return next();
    }

    const idempotencyKey = c.req.header('Idempotency-Key');
    if (!idempotencyKey) {
      if (options.required) {
        throw new SyncError(SyncErrorCode.VALIDATION_ERROR, 'Idempotency-Key header required');
      }
      return next();
    }

    const userId = c.get('user')?.id || 'anonymous';
    const storeKey = `${userId}:${idempotencyKey}`;

    const cached = idempotencyStore.get(storeKey);
    if (cached) {
      return c.json(cached.response, cached.status as never);
    }

    await next();

    const response = c.res.clone();
    const responseBody = await response.json();
    const status = response.status;

    if (status >= 200 && status < 300) {
      idempotencyStore.set(storeKey, responseBody, status);
    }
  };
}

export const errorHandler: ErrorHandler = (err, c) => {
  const isDevelopment = CONFIG.env === 'development';

  if (isAppError(err) && err.statusCode < 500) {
    logger.warn('Client error', { message: err.message, statusCode: err.statusCode });
  } else {
    logger.error('Server error', { error: err });
  }

  if (err instanceof ZodError) {
    const validationError = new ValidationError('Invalid request data', err.issues);
    return c.json(formatErrorResponse(validationError, isDevelopment), 400);
  }

  if (err instanceof HTTPException) {
    return c.json(
      { error: 'HTTPException', message: err.message, statusCode: err.status, details: err.cause },
      err.status
    );
  }

  if (isAppError(err)) {
    return c.json(
      formatErrorResponse(err, isDevelopment),
      err.statusCode as 200 | 201 | 400 | 401 | 403 | 404 | 409 | 422 | 500
    );
  }

  if (err instanceof Error && err.message.includes('SQLITE_')) {
    const dbError = handleDatabaseError(err);
    return c.json(
      formatErrorResponse(dbError, isDevelopment),
      dbError.statusCode as 200 | 201 | 400 | 401 | 403 | 404 | 409 | 422 | 500
    );
  }

  const response = formatErrorResponse(err, isDevelopment);
  return c.json(
    response,
    response.statusCode as 200 | 201 | 400 | 401 | 403 | 404 | 409 | 422 | 500
  );
};

export const activityTracker: MiddlewareHandler = async (c, next) => {
  await next();

  const user = c.get('user');
  if (!user) return;

  try {
    const path = c.req.path;
    const method = c.req.method;
    const shouldTrack =
      (path.startsWith('/api/') && ['POST', 'PUT', 'DELETE'].includes(method)) ||
      (path.startsWith('/api/') && method === 'GET' && !path.includes('/status')) ||
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

export async function changeTracker(c: Context, next: Next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method)) {
    return next();
  }

  await next();

  if (c.res.status >= 200 && c.res.status < 300) {
    const user = c.get('user');
    if (user?.id) {
      userActivityTracker.markDataChanged(user.id).catch((error) => {
        logger.error('Failed to mark data changed', { userId: user.id, error });
      });
    }
  }
}
