/**
 * Error Response Formatting - Standardized API response structures
 */

import { isAppError } from './classes';

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
 */
export const formatErrorResponse = (
  error: unknown,
  includeStack: boolean = false
): LegacyErrorResponse => {
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
};
