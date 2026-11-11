import { SyncError, SyncErrorCode } from '../errors';

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string
): Promise<T> {
  // The timer is always cleared. A pending timer holds the event loop open for the full budget, so
  // a script or test cannot exit.
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

export const OPERATION_TIMEOUTS = {
  SYNC: 5 * 60 * 1000,
  BACKUP: 10 * 60 * 1000,
  RESTORE: 10 * 60 * 1000,
  DRIVE_INIT: 2 * 60 * 1000,
  DOWNLOAD: 5 * 60 * 1000,
} as const;
