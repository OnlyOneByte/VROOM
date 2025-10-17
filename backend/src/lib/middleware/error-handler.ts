import type { ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { config } from '../config';
import { formatErrorResponse, handleDatabaseError, isAppError, ValidationError } from '../errors';

export const errorHandler: ErrorHandler = (err, c) => {
  // Log error with appropriate level
  const isDevelopment = config.env === 'development';

  if (isAppError(err) && err.statusCode < 500) {
    console.warn('⚠️  Client error:', err.message);
  } else {
    console.error('❌ Server error:', err);
  }

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    const validationError = new ValidationError('Invalid request data', err.issues);
    const response = formatErrorResponse(validationError, isDevelopment);
    return c.json(response, 400);
  }

  // Handle HTTP exceptions from Hono
  if (err instanceof HTTPException) {
    const response: {
      error: string;
      message: string;
      statusCode: number;
      details?: unknown;
    } = {
      error: 'HTTPException',
      message: err.message,
      statusCode: err.status,
    };

    if (err.cause) {
      response.details = err.cause;
    }

    return c.json(response, err.status);
  }

  // Handle custom app errors
  if (isAppError(err)) {
    const response = formatErrorResponse(err, isDevelopment);
    return c.json(response, err.statusCode as 200 | 201 | 400 | 401 | 403 | 404 | 409 | 422 | 500);
  }

  // Handle database errors
  if (err instanceof Error && err.message.includes('SQLITE_')) {
    const dbError = handleDatabaseError(err);
    const response = formatErrorResponse(dbError, isDevelopment);
    return c.json(
      response,
      dbError.statusCode as 200 | 201 | 400 | 401 | 403 | 404 | 409 | 422 | 500
    );
  }

  // Handle authentication/OAuth errors
  if (
    err instanceof Error &&
    (err.message.includes('OAUTH_') ||
      err.message.includes('Unauthorized') ||
      err.message.includes('Invalid session'))
  ) {
    return c.json(
      {
        error: 'AuthenticationError',
        message: 'Authentication failed',
        statusCode: 401,
        details: isDevelopment ? err.message : undefined,
      },
      401
    );
  }

  // Generic error handler for unknown errors
  const response = formatErrorResponse(err, isDevelopment);
  return c.json(
    response,
    response.statusCode as 200 | 201 | 400 | 401 | 403 | 404 | 409 | 422 | 500
  );
};
