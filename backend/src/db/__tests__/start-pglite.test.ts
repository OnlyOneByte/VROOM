import { describe, expect, test } from 'bun:test';
import type { PGlite } from '@electric-sql/pglite';
import { STARTUP_ATTEMPTS, startPglite } from './start-pglite';

const engine = {} as PGlite;
const crash = () => new WebAssembly.RuntimeError('access to a null reference');

function failingThen(failures: Error[]) {
  let calls = 0;
  const create = async () => {
    const error = failures[calls++];
    if (error) throw error;
    return engine;
  };
  return { create, calls: () => calls };
}

describe('startPglite', () => {
  test('starts again after an engine crash during startup', async () => {
    const attempt = failingThen([crash()]);
    const retries: number[] = [];
    expect(await startPglite(attempt.create, (n) => retries.push(n))).toBe(engine);
    expect(attempt.calls()).toBe(2);
    expect(retries).toEqual([1]);
  });

  test(`gives up after ${STARTUP_ATTEMPTS} crashes`, async () => {
    const attempt = failingThen(Array.from({ length: STARTUP_ATTEMPTS }, crash));
    await expect(startPglite(attempt.create)).rejects.toThrow('access to a null reference');
    expect(attempt.calls()).toBe(STARTUP_ATTEMPTS);
  });

  test('does not retry any other startup error', async () => {
    const attempt = failingThen([new Error('could not create data directory')]);
    await expect(startPglite(attempt.create)).rejects.toThrow('could not create data directory');
    expect(attempt.calls()).toBe(1);
  });
});
