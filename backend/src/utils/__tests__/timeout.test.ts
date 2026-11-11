// withTimeout returns the work's result or rejects with a typed SyncError on timeout. Uses short
// real timers with a wide margin.

import { describe, expect, test } from 'bun:test';
import { SyncError, SyncErrorCode } from '../../errors';
import { OPERATION_TIMEOUTS, withTimeout } from '../timeout';

/** A promise that resolves with `value` after `ms`. */
function resolveAfter<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}
/** A promise that rejects with `err` after `ms`. */
function rejectAfter(ms: number, err: Error): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(err), ms));
}

describe('withTimeout', () => {
  test('returns the promise value when it resolves before the timeout', async () => {
    const result = await withTimeout(resolveAfter(5, 'done'), 200, 'fast op');
    expect(result).toBe('done');
  });

  test('throws a SyncError(NETWORK_ERROR) with the operation + ms in the message when it times out', async () => {
    let thrown: unknown;
    try {
      await withTimeout(resolveAfter(200, 'too-slow'), 10, 'slow op');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(SyncError);
    expect((thrown as SyncError).code).toBe(SyncErrorCode.NETWORK_ERROR);
    expect((thrown as Error).message).toBe('slow op timed out after 10ms');
  });

  test("the underlying promise's OWN rejection wins when it rejects before the timeout", async () => {
    // A genuine error must not be masked as a timeout.
    const ownError = new Error('upstream failure');
    let thrown: unknown;
    try {
      await withTimeout(rejectAfter(5, ownError), 200, 'op');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBe(ownError);
    expect(thrown).not.toBeInstanceOf(SyncError);
  });

  test('an already-resolved promise returns immediately (no spurious timeout)', async () => {
    expect(await withTimeout(Promise.resolve(42), 50, 'instant')).toBe(42);
  });
});

describe('OPERATION_TIMEOUTS', () => {
  test('exposes the documented per-operation budgets in milliseconds', () => {
    expect(OPERATION_TIMEOUTS.SYNC).toBe(5 * 60 * 1000);
    expect(OPERATION_TIMEOUTS.BACKUP).toBe(10 * 60 * 1000);
    expect(OPERATION_TIMEOUTS.RESTORE).toBe(10 * 60 * 1000);
    expect(OPERATION_TIMEOUTS.DRIVE_INIT).toBe(2 * 60 * 1000);
    expect(OPERATION_TIMEOUTS.DOWNLOAD).toBe(5 * 60 * 1000);
  });
});
