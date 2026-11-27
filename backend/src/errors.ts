import { classifyDbError } from './db/dialect';

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

  get code(): string {
    return this.constructor.name;
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

export class DemoReadOnlyError extends AppError {
  constructor() {
    super("This is a demo garage, so changes aren't saved", 403, true);
  }

  override get code(): string {
    return 'DEMO_READ_ONLY';
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = "You don't have permission to do that") {
    super(message, 403, true);
  }
}

export class AccountPendingError extends AppError {
  constructor() {
    super('Your account is waiting for an admin to approve it', 403, true);
  }

  override get code(): string {
    return 'ACCOUNT_PENDING';
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

export class PayloadTooLargeError extends AppError {
  constructor(message: string) {
    super(message, 413, true);
  }

  override get code(): string {
    return 'PAYLOAD_TOO_LARGE';
  }
}

export class NoProviderError extends AppError {
  constructor(capability: string, message: string) {
    super(message, 400, true, { capability });
  }

  override get code(): string {
    return 'NO_PROVIDER';
  }
}

export class UnprocessableEntityError extends AppError {
  constructor(message: string) {
    super(message, 422, true);
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 500, true, details);
  }
}

export class ScopeNotLoadedError extends AppError {
  constructor(scope: string) {
    super(`Permission scope not loaded before it was checked: ${scope}`, 500, false);
  }
}

export enum SyncErrorCode {
  AUTH_INVALID = 'AUTH_INVALID',
  NETWORK_ERROR = 'NETWORK_ERROR',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
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

interface ErrorResponse {
  success: false;
  error: { code: string; message: string; details?: unknown; stack?: string };
}

interface SuccessResponse<T = unknown> {
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

function withStack(response: ErrorResponse, error: Error, includeStack: boolean): ErrorResponse {
  if (includeStack && error.stack) response.error.stack = error.stack;
  return response;
}

export function formatErrorResponse(error: unknown, includeStack: boolean = false): ErrorResponse {
  if (isAppError(error)) {
    const details = includeStack || error.statusCode < 500 ? error.details : undefined;
    return withStack(createErrorResponse(error.code, error.message, details), error, includeStack);
  }

  if (error instanceof Error) {
    // Raw messages can contain internal details, so they are shown only in development.
    const message = includeStack ? error.message : 'An internal error occurred';
    return withStack(createErrorResponse('InternalServerError', message), error, includeStack);
  }

  return createErrorResponse('UnknownError', 'An unknown error occurred');
}

const ERROR_STATUS_MAP: Record<string, number> = {
  ValidationError: 400,
  AuthenticationError: 401,
  NotFoundError: 404,
  ConflictError: 409,
  UnprocessableEntityError: 422,
  DatabaseError: 500,
  AppError: 500,
  [SyncErrorCode.AUTH_INVALID]: 401,
  [SyncErrorCode.CONFLICT_DETECTED]: 409,
  [SyncErrorCode.PERMISSION_DENIED]: 403,
  [SyncErrorCode.QUOTA_EXCEEDED]: 429,
  [SyncErrorCode.NETWORK_ERROR]: 503,
  [SyncErrorCode.SYNC_IN_PROGRESS]: 409,
};

export function isUniqueConstraintError(err: unknown): boolean {
  return classifyDbError(err) === 'unique';
}

export const handleDatabaseError = (error: unknown): AppError => {
  switch (classifyDbError(error)) {
    case 'unique':
      return new ConflictError('Resource already exists');
    case 'foreign_key':
      return new ValidationError('Invalid reference to related resource');
    case 'not_null':
      return new ValidationError('Required field is missing');
    default:
      return new DatabaseError('A database error occurred');
  }
};

export function syncErrorResponse(error: SyncError): { body: ErrorResponse; status: number } {
  const status = ERROR_STATUS_MAP[error.code] || 500;
  return { body: createErrorResponse(error.code, error.message, error.details), status };
}
