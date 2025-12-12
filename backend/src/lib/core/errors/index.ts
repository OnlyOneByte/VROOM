/**
 * Error Module - Centralized error handling exports
 *
 * This module provides a unified interface for all error-related functionality:
 * - Error classes (AppError, ValidationError, SyncError, etc.)
 * - Error handlers (handleDatabaseError, handleSyncError, etc.)
 * - Response formatters (createErrorResponse, createSuccessResponse, etc.)
 * - Type guards (isAppError, isOperationalError, isSyncError)
 */

// Export all error classes
export {
  AppError,
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  DatabaseError,
  ExternalServiceError,
  ForbiddenError,
  isAppError,
  isOperationalError,
  isSyncError,
  NotFoundError,
  RateLimitError,
  SyncError,
  SyncErrorCode,
  ValidationError,
} from './classes';

// Export all error handlers
export {
  createTypedError,
  getErrorStatusCode,
  handleDatabaseError,
  handleSyncError,
  withErrorHandling,
} from './handlers';

// Export all response types and formatters
export {
  type ApiResponse,
  createErrorResponse,
  createSuccessResponse,
  type ErrorResponse,
  formatErrorResponse,
  type LegacyErrorResponse,
  type SuccessResponse,
} from './responses';
