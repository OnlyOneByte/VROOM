import { afterEach, describe, expect, test } from 'bun:test';
import { withTimeout } from '../timeout';

const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;

interface TimerLog {
  created: unknown[];
  cleared: unknown[];
}

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
    const slowWork = new Promise<string>((resolve) => realSetTimeout(() => resolve('done'), 5));
    expect(await withTimeout(slowWork, 1000, 'op')).toBe('done');
  });
});
