/**
 * Custom Error Classes
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

// Alias for AuthorizationError
export class ForbiddenError extends AuthorizationError {
  constructor(message: string = 'Access forbidden') {
    super(message);
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

export class ExternalServiceError extends AppError {
  constructor(service: string, message: string, details?: unknown) {
    super(`${service} service error: ${message}`, 502, true, details);
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = 'Too many requests') {
    super(message, 429, true);
  }
}

/**
 * Error Utilities
 */

export const isAppError = (error: unknown): error is AppError => {
  return error instanceof AppError;
};

export const isOperationalError = (error: unknown): boolean => {
  if (isAppError(error)) {
    return error.isOperational;
  }
  return false;
};

/**
 * Error Response Formatters
 */

export interface ErrorResponse {
  error: string;
  message: string;
  statusCode: number;
  details?: unknown;
  stack?: string;
}

export const formatErrorResponse = (
  error: unknown,
  includeStack: boolean = false
): ErrorResponse => {
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

/**
 * Database Error Handlers
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
