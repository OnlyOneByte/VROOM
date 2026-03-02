/**
 * Error Module - Error classes, handlers, and response formatters
 */

import type { Context } from 'hono';
import { logger } from './utils/logger';

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
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, true, details);
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication required') {
    super(message, 401, true);
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Insufficient permissions') {
    super(message, 403, true);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string = 'Resource') {
    super(`${resource} not found`, 404, true);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, true);
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 500, true, details);
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = 'Too many requests') {
    super(message, 429, true);
  }
}

export enum SyncErrorCode {
  AUTH_INVALID = 'AUTH_INVALID',
  NETWORK_ERROR = 'NETWORK_ERROR',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  CONFLICT_DETECTED = 'CONFLICT_DETECTED',
  SYNC_IN_PROGRESS = 'SYNC_IN_PROGRESS',
}

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

export const isAppError = (error: unknown): error is AppError => error instanceof AppError;
export const isOperationalError = (error: unknown): boolean =>
  isAppError(error) && error.isOperational;
export const isSyncError = (error: unknown): error is SyncError => error instanceof SyncError;

export interface ErrorResponse {
  success: false;
  error: { code: string; message: string; details?: unknown };
}

export interface SuccessResponse<T = unknown> {
  success: true;
  data?: T;
  message?: string;
}

export type ApiResponse<T = unknown> = SuccessResponse<T> | ErrorResponse;

export function createErrorResponse(
  code: string,
  message: string,
  details?: unknown
): ErrorResponse {
  return { success: false, error: { code, message, details } };
}

export function createSuccessResponse<T>(data?: T, message?: string): SuccessResponse<T> {
  const response: SuccessResponse<T> = { success: true };
  if (data !== undefined) response.data = data;
  if (message) response.message = message;
  return response;
}

export function formatErrorResponse(error: unknown, includeStack: boolean = false): ErrorResponse {
  if (isAppError(error)) {
    const details = includeStack
      ? {
          ...(typeof error.details === 'object' && error.details !== null ? error.details : {}),
          stack: error.stack,
        }
      : error.details;

    return createErrorResponse(error.constructor.name, error.message, details);
  }

  if (error instanceof Error) {
    return createErrorResponse(
      'InternalServerError',
      error.message,
      includeStack ? { stack: error.stack } : undefined
    );
  }

  return createErrorResponse('UnknownError', 'An unknown error occurred');
}

const ERROR_STATUS_MAP: Record<string, number> = {
  ValidationError: 400,
  AuthenticationError: 401,
  AuthorizationError: 403,
  NotFoundError: 404,
  ConflictError: 409,
  RateLimitError: 429,
  DatabaseError: 500,
  AppError: 500,
  [SyncErrorCode.AUTH_INVALID]: 401,
  [SyncErrorCode.VALIDATION_ERROR]: 400,
  [SyncErrorCode.CONFLICT_DETECTED]: 409,
  [SyncErrorCode.PERMISSION_DENIED]: 403,
  [SyncErrorCode.QUOTA_EXCEEDED]: 429,
  [SyncErrorCode.NETWORK_ERROR]: 503,
  [SyncErrorCode.SYNC_IN_PROGRESS]: 409,
};

export function getErrorStatusCode(error: unknown): number {
  if (error instanceof AppError) return error.statusCode;
  if (isSyncError(error)) return ERROR_STATUS_MAP[error.code] || 500;
  if (error && typeof error === 'object' && 'constructor' in error) {
    return ERROR_STATUS_MAP[error.constructor.name] || 500;
  }
  return 500;
}

export const handleDatabaseError = (error: unknown): AppError => {
  if (error instanceof Error) {
    if (error.message.includes('UNIQUE constraint failed'))
      return new ConflictError('Resource already exists');
    if (error.message.includes('FOREIGN KEY constraint failed'))
      return new ValidationError('Invalid reference to related resource');
    if (error.message.includes('NOT NULL constraint failed'))
      return new ValidationError('Required field is missing');
    return new DatabaseError(error.message);
  }
  return new DatabaseError('Unknown database error');
};

export function handleSyncError(
  c: Context,
  error: unknown,
  operation: string,
  defaultErrorCode = 'OPERATION_FAILED'
): Response {
  const userId = c.get('user')?.id || 'unknown';

  if (isSyncError(error)) {
    logger.error(`${operation} failed`, {
      userId,
      error: error.message,
      code: error.code,
      details: error.details,
    });
    const status = ERROR_STATUS_MAP[error.code] || 500;
    return c.json(createErrorResponse(error.code, error.message, error.details), status as never);
  }

  logger.error(`${operation} failed`, {
    userId,
    error: error instanceof Error ? error.message : 'Unknown error',
  });

  if (error && typeof error === 'object' && 'code' in error) {
    const syncError = error as { code: string; message: string; details?: unknown };
    const status = ERROR_STATUS_MAP[syncError.code as SyncErrorCode] || 500;
    return c.json(
      createErrorResponse(syncError.code, syncError.message, syncError.details),
      status as never
    );
  }

  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
  return c.json(createErrorResponse(defaultErrorCode, `Failed to ${operation}`, errorMessage), 500);
}
