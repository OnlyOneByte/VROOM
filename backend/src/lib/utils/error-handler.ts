/**
 * Centralized error handling for sync, backup, and restore operations
 */

import type { Context } from 'hono';
import { SyncError, SyncErrorCode } from '../services/sync/sync-errors';
import { createErrorResponse, type ErrorResponse } from './error-response';
import { logger } from './logger';

/**
 * HTTP status code mapping for sync errors
 */
const ERROR_STATUS_MAP: Record<SyncErrorCode, number> = {
  [SyncErrorCode.AUTH_INVALID]: 401,
  [SyncErrorCode.VALIDATION_ERROR]: 400,
  [SyncErrorCode.CONFLICT_DETECTED]: 409,
  [SyncErrorCode.PERMISSION_DENIED]: 403,
  [SyncErrorCode.QUOTA_EXCEEDED]: 429,
  [SyncErrorCode.NETWORK_ERROR]: 503,
  [SyncErrorCode.SYNC_IN_PROGRESS]: 409,
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
  if (error instanceof SyncError) {
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
