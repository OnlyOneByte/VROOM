/**
 * Timeout utility for long-running operations
 */

import { SyncError, SyncErrorCode } from '../errors';

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
  // The handle is captured and always cleared: an uncleared timer keeps the event loop
  // referenced for the FULL budget (10 minutes for a backup) after the work has already
  // finished, so a script or test that calls this cannot exit until the timer drains.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new SyncError(SyncErrorCode.NETWORK_ERROR, `${operation} timed out after ${timeoutMs}ms`)
        ),
      timeoutMs
    );
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
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
