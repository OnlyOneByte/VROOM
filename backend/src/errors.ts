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
    // Raw messages can contain internal details, so they are shown only in development.
    const message = includeStack ? error.message : 'An internal error occurred';
    return createErrorResponse(
      'InternalServerError',
      message,
      includeStack ? { stack: error.stack } : undefined
    );
  }

  return createErrorResponse('UnknownError', 'An unknown error occurred');
}

const ERROR_STATUS_MAP: Record<string, number> = {
  ValidationError: 400,
  AuthenticationError: 401,
  NotFoundError: 404,
  ConflictError: 409,
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

// bun:sqlite sets `code`; drizzle may wrap the driver error, so the cause chain is walked too.
// A primary-key collision is reported as its own code but is the same violation.
const UNIQUE_VIOLATION_CODES = new Set([
  'SQLITE_CONSTRAINT_UNIQUE',
  'SQLITE_CONSTRAINT_PRIMARYKEY',
]);

export function isUniqueConstraintError(err: unknown): boolean {
  for (let e: unknown = err; e instanceof Error; e = e.cause) {
    const code = (e as Error & { code?: unknown }).code;
    if (typeof code === 'string' && UNIQUE_VIOLATION_CODES.has(code)) return true;
  }
  return false;
}

export const handleDatabaseError = (error: unknown): AppError => {
  if (isUniqueConstraintError(error)) return new ConflictError('Resource already exists');
  if (error instanceof Error) {
    if (error.message.includes('FOREIGN KEY constraint failed'))
      return new ValidationError('Invalid reference to related resource');
    if (error.message.includes('NOT NULL constraint failed'))
      return new ValidationError('Required field is missing');
    return new DatabaseError('A database error occurred');
  }
  return new DatabaseError('A database error occurred');
};

// The errorHandler middleware is the only place a thrown SyncError becomes a response.
export function syncErrorResponse(error: SyncError): { body: ErrorResponse; status: number } {
  const status = ERROR_STATUS_MAP[error.code] || 500;
  return { body: createErrorResponse(error.code, error.message, error.details), status };
}
