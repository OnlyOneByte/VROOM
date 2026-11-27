import type { ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { CONFIG } from '../config';
import { looksLikeDriverError } from '../db/dialect';
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

const HTTP_FALLBACK_MESSAGES: Partial<Record<number, string>> = {
  403: 'This request was refused because it did not come from the VROOM app',
};

const isBodyParseFailure = (err: HTTPException): boolean =>
  err.status === 400 &&
  (err.message === 'Malformed JSON in request body' ||
    err.message.startsWith('Malformed FormData request'));

export const errorHandler: ErrorHandler = (err, c) => {
  const isDevelopment = CONFIG.env === 'development';

  if (isAppError(err) && err.statusCode < 500) {
    logger.warn('Client error', { message: err.message, statusCode: err.statusCode });
  } else {
    logger.error('Server error', {
      error: err,
      details: isAppError(err) ? err.details : undefined,
    });
  }

  if (err instanceof ZodError) {
    const validationError = new ValidationError('Invalid request data', err.issues);
    return c.json(formatErrorResponse(validationError, isDevelopment), 400);
  }

  if (err instanceof HTTPException) {
    if (isBodyParseFailure(err)) {
      return c.json(createErrorResponse('ValidationError', 'Malformed request body'), 400);
    }
    const message = err.message || HTTP_FALLBACK_MESSAGES[err.status] || 'Request failed';
    return c.json(createErrorResponse('HTTPException', message, err.cause), err.status);
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

  if (looksLikeDriverError(err)) {
    const dbError = handleDatabaseError(err);
    return c.json(
      formatErrorResponse(dbError, isDevelopment),
      dbError.statusCode as 200 | 201 | 400 | 401 | 403 | 404 | 409 | 422 | 500
    );
  }

  const response = formatErrorResponse(err, isDevelopment);
  return c.json(response, 500);
};
