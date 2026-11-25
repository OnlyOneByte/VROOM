import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { CONFIG } from '../../config';
import { startWalCheckpoints } from '../connection';

const database = CONFIG.database as { appCheckpoints: boolean };
const enabled = database.appCheckpoints;

afterEach(() => {
  database.appCheckpoints = enabled;
});

describe('the app-side WAL checkpoints', () => {
  test('WAL_CHECKPOINTS=off starts no timer, so Litestream owns checkpointing', () => {
    database.appCheckpoints = false;
    const timers = spyOn(globalThis, 'setInterval');
    try {
      expect(startWalCheckpoints(60_000)).toBeNull();
      expect(timers).not.toHaveBeenCalled();
    } finally {
      timers.mockRestore();
    }
  });

  test('on by default: a timer runs and stopping it clears the timer', () => {
    database.appCheckpoints = true;
    const timers = spyOn(globalThis, 'setInterval');
    const cleared = spyOn(globalThis, 'clearInterval');
    try {
      const stop = startWalCheckpoints(60_000);
      expect(timers).toHaveBeenCalledTimes(1);
      expect(stop).toBeFunction();
      stop?.();
      expect(cleared).toHaveBeenCalledTimes(1);
    } finally {
      timers.mockRestore();
      cleared.mockRestore();
    }
  });
});
