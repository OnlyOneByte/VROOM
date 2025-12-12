/**
 * Error Module - Centralized error handling
 *
 * This module provides a unified interface for all error-related functionality:
 * - Error classes (AppError, ValidationError, SyncError, etc.)
 * - Error handlers (handleDatabaseError, handleSyncError, etc.)
 * - Response formatters (createErrorResponse, createSuccessResponse, etc.)
 * - Type guards (isAppError, isOperationalError, isSyncError)
 */

import type { Context } from 'hono';
import { logger } from './utils/logger';

// ============================================================================
// ERROR CLASSES
// ============================================================================

/**
 * Base application error class
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly details?: unknown;

  constructor(
    message: string,
    statusCode: number = 500,
    isOperational: boolean = true,
    details?: unknown
  ) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.details = details;

    // Maintains proper stack trace for where our error was thrown
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Validation error (400)
 */
export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, true, details);
  }
}

/**
 * Authentication error (401)
 */
export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication required') {
    super(message, 401, true);
  }
}

/**
 * Authorization error (403)
 */
export class AuthorizationError extends AppError {
  constructor(message: string = 'Insufficient permissions') {
    super(message, 403, true);
  }
}

/**
 * @deprecated Use AuthorizationError instead
 * Alias for AuthorizationError - kept for backward compatibility
 */
export class ForbiddenError extends AuthorizationError {
  constructor(message: string = 'Access forbidden') {
    super(message);
  }
}

/**
 * Not found error (404)
 */
export class NotFoundError extends AppError {
  constructor(resource: string = 'Resource') {
    super(`${resource} not found`, 404, true);
  }
}

/**
 * Conflict error (409)
 */
export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, true);
  }
}

/**
 * Database error (500)
 */
export class DatabaseError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 500, true, details);
  }
}

/**
 * Rate limit error (429)
 */
export class RateLimitError extends AppError {
  constructor(message: string = 'Too many requests') {
    super(message, 429, true);
  }
}

/**
 * Sync Error Codes
 */
export enum SyncErrorCode {
  AUTH_INVALID = 'AUTH_INVALID',
  NETWORK_ERROR = 'NETWORK_ERROR',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  CONFLICT_DETECTED = 'CONFLICT_DETECTED',
  SYNC_IN_PROGRESS = 'SYNC_IN_PROGRESS',
}

/**
 * Sync-specific error class
 */
export class SyncError extends Error {
  constructor(
    public code: SyncErrorCode,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'SyncError';
  }
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

export const isAppError = (error: unknown): error is AppError => {
  return error instanceof AppError;
};

export const isOperationalError = (error: unknown): boolean => {
  if (isAppError(error)) {
    return error.isOperational;
  }
  return false;
};

export const isSyncError = (error: unknown): error is SyncError => {
  return error instanceof SyncError;
};

// ============================================================================
// RESPONSE TYPES
// ============================================================================

/**
 * Standardized error response structure
 */
export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Standardized success response structure
 */
export interface SuccessResponse<T = unknown> {
  success: true;
  data?: T;
  message?: string;
}

/**
 * Union type for all API responses
 */
export type ApiResponse<T = unknown> = SuccessResponse<T> | ErrorResponse;

/**
 * Legacy error response format (for backward compatibility)
 */
export interface LegacyErrorResponse {
  error: string;
  message: string;
  statusCode: number;
  details?: unknown;
  stack?: string;
}

// ============================================================================
// RESPONSE FORMATTERS
// ============================================================================

/**
 * Create a standardized error response
 */
export function createErrorResponse(
  code: string,
  message: string,
  details?: unknown
): ErrorResponse {
  return {
    success: false,
    error: {
      code,
      message,
      details,
    },
  };
}

/**
 * Create a standardized success response
 */
export function createSuccessResponse<T>(data?: T, message?: string): SuccessResponse<T> {
  const response: SuccessResponse<T> = {
    success: true,
  };

  if (data !== undefined) {
    response.data = data;
  }

  if (message) {
    response.message = message;
  }

  return response;
}

/**
 * Format error for API response (legacy format)
 * Used internally by error handler middleware
 */
function formatErrorResponse(error: unknown, includeStack: boolean = false): LegacyErrorResponse {
  if (isAppError(error)) {
    return {
      error: error.constructor.name,
      message: error.message,
      statusCode: error.statusCode,
      details: error.details,
      stack: includeStack ? error.stack : undefined,
    };
  }

  if (error instanceof Error) {
    return {
      error: 'InternalServerError',
      message: error.message,
      statusCode: 500,
      stack: includeStack ? error.stack : undefined,
    };
  }

  return {
    error: 'UnknownError',
    message: 'An unknown error occurred',
    statusCode: 500,
  };
}

// Export for middleware use only
export { formatErrorResponse };

// ============================================================================
// ERROR HANDLERS
// ============================================================================

/**
 * HTTP status code mapping for all error types
 */
const ERROR_STATUS_MAP: Record<string, number> = {
  // AppError types
  ValidationError: 400,
  AuthenticationError: 401,
  AuthorizationError: 403,
  ForbiddenError: 403, // Deprecated - use AuthorizationError
  NotFoundError: 404,
  ConflictError: 409,
  RateLimitError: 429,
  DatabaseError: 500,
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

// withErrorHandling removed - was unused
// createTypedError removed - was unused (use createErrorResponse directly)
