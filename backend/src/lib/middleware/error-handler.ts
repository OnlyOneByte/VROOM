import type { ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { config } from '../config';

export const errorHandler: ErrorHandler = (err, c) => {
  console.error('❌ Error occurred:', err);

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    return c.json({
      error: 'Validation Error',
      message: 'Invalid request data',
      details: config.env === 'development' ? err.errors : undefined,
    }, 400);
  }

  // Handle HTTP exceptions
  if (err instanceof HTTPException) {
    return c.json({
      error: err.message,
      message: err.message,
    }, err.status);
  }

  // Handle database errors
  if (err.message?.includes('SQLITE_')) {
    return c.json({
      error: 'Database Error',
      message: 'A database error occurred',
      details: config.env === 'development' ? err.message : undefined,
    }, 500);
  }

  // Handle authentication errors
  if (err.message?.includes('OAUTH_') || err.message?.includes('Unauthorized')) {
    return c.json({
      error: 'Authentication Error',
      message: 'Authentication failed',
      details: config.env === 'development' ? err.message : undefined,
    }, 401);
  }

  // Generic error handler
  return c.json({
    error: 'Internal Server Error',
    message: config.env === 'development' 
      ? err.message 
      : 'An unexpected error occurred',
    stack: config.env === 'development' ? err.stack : undefined,
  }, 500);
};