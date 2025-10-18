/**
 * Sync Error Types - Centralized error handling for sync operations
 */

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
