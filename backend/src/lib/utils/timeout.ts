/**
 * Timeout utility for long-running operations
 */

import { SyncError, SyncErrorCode } from '../services/sync/sync-errors';

/**
 * Wrap a promise with a timeout
 * @param promise The promise to wrap
 * @param timeoutMs Timeout in milliseconds
 * @param operation Operation name for error message
 * @returns The promise result or throws timeout error
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string
): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () =>
        reject(
          new SyncError(SyncErrorCode.NETWORK_ERROR, `${operation} timed out after ${timeoutMs}ms`)
        ),
      timeoutMs
    )
  );

  return Promise.race([promise, timeout]);
}

/**
 * Timeout configurations for different operations
 */
export const OPERATION_TIMEOUTS = {
  SYNC: 5 * 60 * 1000, // 5 minutes
  BACKUP: 10 * 60 * 1000, // 10 minutes
  RESTORE: 10 * 60 * 1000, // 10 minutes
  DRIVE_INIT: 2 * 60 * 1000, // 2 minutes
  DOWNLOAD: 5 * 60 * 1000, // 5 minutes
} as const;
