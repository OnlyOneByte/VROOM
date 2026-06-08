/**
 * Global Error Handler
 *
 * Catches and formats all errors thrown in the application.
 */

import type { ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { CONFIG } from '../config';
import {
  createErrorResponse,
  formatErrorResponse,
  handleDatabaseError,
  isAppError,
  isSyncError,
  syncErrorResponse,
  ValidationError,
} from '../errors';
import { logger } from '../utils/logger';

/**
 * Global error handler
 * Formats errors consistently and logs appropriately
 */
export const errorHandler: ErrorHandler = (err, c) => {
  const isDevelopment = CONFIG.env === 'development';

  // Log errors appropriately
  if (isAppError(err) && err.statusCode < 500) {
    logger.warn('Client error', { message: err.message, statusCode: err.statusCode });
  } else {
    logger.error('Server error', { error: err });
  }

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    const validationError = new ValidationError('Invalid request data', err.issues);
    return c.json(formatErrorResponse(validationError, isDevelopment), 400);
  }

  // Handle Hono HTTP exceptions
  if (err instanceof HTTPException) {
    return c.json(createErrorResponse('HTTPException', err.message, err.cause), err.status);
  }

  // Handle sync/provider errors. SyncError extends Error (not AppError), so without this branch it
  // would fall through to the generic 500 path below, losing its code→status mapping (a
  // VALIDATION_ERROR would 500 instead of 400). syncErrorResponse is the SAME shaping the local
  // handleSyncError uses, so a SyncError yields an identical envelope whether caught in a route
  // catch block or here — letting route handlers safely drop their hand-rolled try/catch.
  if (isSyncError(err)) {
    const { body, status } = syncErrorResponse(err);
    return c.json(body, status as 400 | 401 | 403 | 409 | 429 | 500 | 503);
  }

  // Handle application errors
  if (isAppError(err)) {
    return c.json(
      formatErrorResponse(err, isDevelopment),
      err.statusCode as 200 | 201 | 400 | 401 | 403 | 404 | 409 | 422 | 500
    );
  }

  // Handle database errors
  if (err instanceof Error && err.message.includes('SQLITE_')) {
    const dbError = handleDatabaseError(err);
    return c.json(
      formatErrorResponse(dbError, isDevelopment),
      dbError.statusCode as 200 | 201 | 400 | 401 | 403 | 404 | 409 | 422 | 500
    );
  }

  // Handle unknown errors
  const response = formatErrorResponse(err, isDevelopment);
  return c.json(response, 500);
};
