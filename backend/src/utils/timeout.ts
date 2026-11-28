import type { Server } from 'bun';
import type { Context } from 'hono';
import { SyncError, SyncErrorCode } from '../errors';

export const SERVER_IDLE_TIMEOUT_SECONDS = 10;

export async function withoutIdleTimeout<T>(c: Context, run: () => Promise<T>): Promise<T> {
  const server = c.env as Pick<Server<unknown>, 'timeout'> | undefined;
  server?.timeout?.(c.req.raw, 0);
  try {
    return await run();
  } finally {
    server?.timeout?.(c.req.raw, SERVER_IDLE_TIMEOUT_SECONDS);
  }
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string
): Promise<T> {
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

export async function withDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  operation: string
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(
    () =>
      controller.abort(
        new SyncError(SyncErrorCode.NETWORK_ERROR, `${operation} timed out after ${timeoutMs}ms`)
      ),
    timeoutMs
  );
  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
      once: true,
    });
  });
  try {
    return await Promise.race([run(controller.signal), aborted]);
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
