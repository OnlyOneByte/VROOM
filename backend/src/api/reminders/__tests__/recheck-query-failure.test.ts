import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { reminderRepository } from '../repository';
import { reminderTriggerService } from '../trigger-service';

afterEach(() => {
  spyOn(reminderRepository, 'findMileageTracking').mockRestore?.();
});

describe('recheckMileageReminders on a query failure', () => {
  test('a findMileageTracking failure resolves to a skip', async () => {
    const spy = spyOn(reminderRepository, 'findMileageTracking').mockRejectedValue(
      new Error('connection lost')
    );

    const result = await reminderTriggerService.recheckMileageReminders('u1', 'v1');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.notifications).toEqual([]);
    expect(result.createdExpenses).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toBe('recheck_query_failed');
    expect(result.skipped[0].message).toContain('connection lost');

    spy.mockRestore();
  });
});
