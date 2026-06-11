/**
 * Characterization tests for `withTimeout` + `OPERATION_TIMEOUTS` (C82 deep-review). This
 * utility was at 0% coverage (surfaced by the C81 coverage baseline) yet is live in the sync
 * backup path (backup-orchestrator.ts, sync/routes.ts), where a hung Drive/Sheets call must
 * fail as a typed SyncError rather than hang forever. Pins the three race outcomes + the error
 * shape so a future edit can't silently change them. Pure → no DB, no server; uses small REAL
 * timeouts (no fake-timer dependency) with a comfortable margin so it stays deterministic + fast.
 */

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
    // resolves at ~5ms, timeout at 200ms → the value wins.
    const result = await withTimeout(resolveAfter(5, 'done'), 200, 'fast op');
    expect(result).toBe('done');
  });

  test('throws a SyncError(NETWORK_ERROR) with the operation + ms in the message when it times out', async () => {
    // promise would take 200ms, timeout fires at 10ms → the timeout wins.
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
    // The promise rejects at ~5ms with its own error; timeout is 200ms → its rejection propagates,
    // NOT a timeout SyncError. (A genuine error must not be masked as a timeout.)
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
