import { describe, expect, test } from 'bun:test';
import { STARTUP_ATTEMPTS, startPglite } from './start-pglite';

const crash = () => new WebAssembly.RuntimeError('access to a null reference');

function engines(failures: Error[]) {
  const made: { closed: boolean; waitReady: Promise<void>; close: () => Promise<void> }[] = [];
  const create = () => {
    const error = failures[made.length];
    const engine = {
      closed: false,
      waitReady: error ? Promise.reject(error) : Promise.resolve(),
      close: async () => {
        engine.closed = true;
      },
    };
    made.push(engine);
    return engine;
  };
  return { create, made };
}

describe('startPglite', () => {
  test('closes a crashed engine, records the retry, then starts a new one', async () => {
    const attempt = engines([crash()]);
    const retries: number[] = [];
    const started = await startPglite(attempt.create, (n) => retries.push(n));
    expect(started).toBe(attempt.made[1]);
    expect(attempt.made.map((e) => e.closed)).toEqual([true, false]);
    expect(retries).toEqual([1]);
  });

  test(`records each retry as it happens and gives up after ${STARTUP_ATTEMPTS} crashes`, async () => {
    const attempt = engines(Array.from({ length: STARTUP_ATTEMPTS }, crash));
    const retries: number[] = [];
    await expect(startPglite(attempt.create, (n) => retries.push(n))).rejects.toThrow(
      'access to a null reference'
    );
    expect(retries).toEqual([1, 2]);
    expect(attempt.made.every((e) => e.closed)).toBe(true);
  });

  test('does not retry a different WASM error', async () => {
    const attempt = engines([new WebAssembly.RuntimeError('unreachable')]);
    await expect(startPglite(attempt.create)).rejects.toThrow('unreachable');
    expect(attempt.made).toHaveLength(1);
    expect(attempt.made[0]?.closed).toBe(true);
  });

  test('does not retry any other startup error', async () => {
    const attempt = engines([new Error('could not create data directory')]);
    await expect(startPglite(attempt.create)).rejects.toThrow('could not create data directory');
    expect(attempt.made).toHaveLength(1);
  });

  test('a close that hangs does not stop the retry', async () => {
    let made = 0;
    const create = () => {
      made++;
      return {
        waitReady: made === 1 ? Promise.reject(crash()) : Promise.resolve(),
        close: () => new Promise<void>(() => {}),
      };
    };
    await startPglite(create);
    expect(made).toBe(2);
  });
});
