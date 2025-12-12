/**
 * Error Handlers - Centralized error handling logic
 */

import type { Context } from 'hono';
import { logger } from '../../utils/logger';
import {
  AppError,
  ConflictError,
  DatabaseError,
  isSyncError,
  SyncErrorCode,
  ValidationError,
} from './classes';
import { createErrorResponse, type ErrorResponse } from './responses';

/**
 * HTTP status code mapping for all error types
 */
const ERROR_STATUS_MAP: Record<string, number> = {
  // AppError types
  ValidationError: 400,
  AuthenticationError: 401,
  AuthorizationError: 403,
  ForbiddenError: 403,
  NotFoundError: 404,
  ConflictError: 409,
  RateLimitError: 429,
  DatabaseError: 500,
  ExternalServiceError: 502,
  AppError: 500,

  // SyncError codes
  [SyncErrorCode.AUTH_INVALID]: 401,
  [SyncErrorCode.VALIDATION_ERROR]: 400,
  [SyncErrorCode.CONFLICT_DETECTED]: 409,
  [SyncErrorCode.PERMISSION_DENIED]: 403,
  [SyncErrorCode.QUOTA_EXCEEDED]: 429,
  [SyncErrorCode.NETWORK_ERROR]: 503,
  [SyncErrorCode.SYNC_IN_PROGRESS]: 409,
};

/**
 * Get HTTP status code for an error
 */
export function getErrorStatusCode(error: unknown): number {
  if (error instanceof AppError) {
    return error.statusCode;
  }

  if (isSyncError(error)) {
    return ERROR_STATUS_MAP[error.code] || 500;
  }

  if (error && typeof error === 'object' && 'constructor' in error) {
    const constructorName = error.constructor.name;
    return ERROR_STATUS_MAP[constructorName] || 500;
  }

  return 500;
}

/**
 * Handle database errors and convert to AppError
 */
export const handleDatabaseError = (error: unknown): AppError => {
  if (error instanceof Error) {
    // SQLite specific errors
    if (error.message.includes('UNIQUE constraint failed')) {
      return new ConflictError('Resource already exists');
    }

    if (error.message.includes('FOREIGN KEY constraint failed')) {
      return new ValidationError('Invalid reference to related resource');
    }

    if (error.message.includes('NOT NULL constraint failed')) {
      return new ValidationError('Required field is missing');
    }

    return new DatabaseError(error.message);
  }

  return new DatabaseError('Unknown database error');
};

/**
 * Handle sync-related errors and return appropriate HTTP response
 */
export function handleSyncError(
  c: Context,
  error: unknown,
  operation: string,
  defaultErrorCode = 'OPERATION_FAILED'
): Response {
  const userId = c.get('user')?.id || 'unknown';

  // Log the error
  logger.error(`${operation} failed`, {
    userId,
    error: error instanceof Error ? error.message : 'Unknown error',
    stack: error instanceof Error ? error.stack : undefined,
  });

  // Handle SyncError instances
  if (isSyncError(error)) {
    const status = ERROR_STATUS_MAP[error.code] || 500;
    return c.json(createErrorResponse(error.code, error.message, error.details), status as never);
  }

  // Handle standard errors with code property
  if (error && typeof error === 'object' && 'code' in error) {
    const syncError = error as { code: string; message: string; details?: unknown };
    const status = ERROR_STATUS_MAP[syncError.code as SyncErrorCode] || 500;
    return c.json(
      createErrorResponse(syncError.code, syncError.message, syncError.details),
      status as never
    );
  }

  // Handle generic errors
  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
  return c.json(createErrorResponse(defaultErrorCode, `Failed to ${operation}`, errorMessage), 500);
}

/**
 * Wrap async route handlers with error handling
 */
export function withErrorHandling(handler: (c: Context) => Promise<Response>, operation: string) {
  return async (c: Context): Promise<Response> => {
    try {
      return await handler(c);
    } catch (error) {
      return handleSyncError(c, error, operation);
    }
  };
}

/**
 * Create a typed error response for specific error codes
 */
export function createTypedError(
  code: SyncErrorCode,
  message: string,
  details?: unknown
): ErrorResponse {
  return createErrorResponse(code, message, details);
}
