import { describe, expect, spyOn, test } from 'bun:test';
import { openAsyncDatabase } from '../async-sqlite';
import { checkpointWAL, forceCheckpointWAL, getDb } from '../connection';

describe('WAL checkpoints', () => {
  test('skip while an async transaction is open and run once it closes', async () => {
    const handle = openAsyncDatabase(getDb().$client);
    const upkeep = spyOn(handle, 'upkeep');
    try {
      await handle.transaction(async () => {
        checkpointWAL();
        forceCheckpointWAL();
        expect(upkeep).not.toHaveBeenCalled();
      });
      checkpointWAL();
      forceCheckpointWAL();
      expect(upkeep.mock.calls).toEqual([['checkpoint'], ['forceCheckpoint']]);
    } finally {
      upkeep.mockRestore();
    }
  });
});
