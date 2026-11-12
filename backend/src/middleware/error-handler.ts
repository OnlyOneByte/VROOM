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
    return c.json(createErrorResponse('HTTPException', err.message, err.cause), err.status);
  }

  if (isSyncError(err)) {
    const { body, status } = syncErrorResponse(err);
    return c.json(body, status as 400 | 401 | 403 | 409 | 429 | 500 | 503);
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
  return c.json(response, 500);
};
