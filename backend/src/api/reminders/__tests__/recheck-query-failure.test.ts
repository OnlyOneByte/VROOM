import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { repos } from '../../../app-context';
import type { ReminderWithVehicles } from '../repository';
import { reminderTriggerService } from '../trigger-service';

afterEach(() => {
  spyOn(repos().reminders, 'findMileageTracking').mockRestore?.();
});

describe('recheckMileageReminders on a query failure', () => {
  test('a findMileageTracking failure resolves to a skip', async () => {
    const spy = spyOn(repos().reminders, 'findMileageTracking').mockRejectedValue(
      new Error('connection lost')
    );

    const result = await reminderTriggerService.recheckMileageReminders('u1', 'v1');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.notifications).toEqual([]);
    expect(result.createdExpenses).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toBe('recheck_query_failed');
    expect(result.skipped[0].message).toBe(
      'This reminder could not be processed. Try again later.'
    );
    expect(JSON.stringify(result)).not.toContain('connection lost');

    spy.mockRestore();
  });
});

describe('a reminder that fails mid-trigger', () => {
  test('is skipped with a generic message and the raw error stays on the server', async () => {
    const reminder = {
      id: 'r1',
      userId: 'u1',
      nextDueOdometer: 1000,
    } as ReminderWithVehicles['reminder'];
    const list = spyOn(repos().reminders, 'findMileageTracking').mockResolvedValue([
      { reminder, vehicleIds: ['v1'] },
    ]);
    const odometer = spyOn(repos().odometer, 'getCurrentOdometer').mockRejectedValue(
      new Error('SQLITE_BUSY: database is locked')
    );

    const result = await reminderTriggerService.recheckMileageReminders('u1', 'v1');

    expect(result.skipped).toEqual([
      {
        reminderId: 'r1',
        reason: 'error',
        message: 'This reminder could not be processed. Try again later.',
      },
    ]);
    list.mockRestore();
    odometer.mockRestore();
  });
});
