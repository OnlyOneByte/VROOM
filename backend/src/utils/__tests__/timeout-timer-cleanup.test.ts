/**
 * Guard: `withTimeout` must clear its timer on EVERY exit path.
 *
 * `Promise.race([work, timeout])` settles as soon as the work does, so the losing `setTimeout` is
 * left behind: uncleared it runs for the whole budget — 10 minutes for a backup/restore — holding
 * its reject closure and an event-loop reference. The visible symptom is a process that cannot
 * exit, because a script that calls this idles for the full timeout after its work is done.
 * Companion to `timeout.test.ts`, which pins the race OUTCOMES; this pins the cleanup.
 *
 * Pure: swaps the global timer functions for recorders, no DB and no real waiting.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { withTimeout } from '../timeout';

const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;

interface TimerLog {
  created: unknown[];
  cleared: unknown[];
}

/** Record every timer `withTimeout` creates and clears while `run` executes. */
async function recordTimers(run: () => Promise<unknown>): Promise<TimerLog> {
  const log: TimerLog = { created: [], cleared: [] };

  globalThis.setTimeout = ((
    handler: Parameters<typeof globalThis.setTimeout>[0],
    ms?: number,
    ...args: unknown[]
  ) => {
    const handle = realSetTimeout(handler, ms, ...args);
    log.created.push(handle);
    return handle;
  }) as typeof globalThis.setTimeout;

  globalThis.clearTimeout = ((handle?: Parameters<typeof globalThis.clearTimeout>[0]) => {
    log.cleared.push(handle);
    realClearTimeout(handle);
  }) as typeof globalThis.clearTimeout;

  try {
    await run().catch(() => undefined);
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  }

  return log;
}

afterEach(() => {
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
});

describe('withTimeout timer cleanup', () => {
  test('clears the timeout timer when the wrapped promise wins', async () => {
    const log = await recordTimers(() =>
      withTimeout(Promise.resolve('fast'), 10 * 60 * 1000, 'backup')
    );

    // One timer created (the budget), and it is the one cleared — nothing left pending for 10 min.
    expect(log.created).toHaveLength(1);
    expect(log.cleared).toEqual(log.created);
  });

  test('clears the timeout timer when the wrapped promise rejects', async () => {
    const log = await recordTimers(() =>
      withTimeout(Promise.reject(new Error('upstream failure')), 10 * 60 * 1000, 'restore')
    );

    expect(log.created).toHaveLength(1);
    expect(log.cleared).toEqual(log.created);
  });

  test('a cleared timer never fires, so the resolved value still wins', async () => {
    // The losing branch must not reject later either: a late reject on an already-settled race is
    // invisible today, but clearing the timer is what keeps it that way.
    const slowWork = new Promise<string>((resolve) => realSetTimeout(() => resolve('done'), 5));
    expect(await withTimeout(slowWork, 1000, 'op')).toBe('done');
  });
});
