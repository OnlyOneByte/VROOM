/**
 * C42 deep-review regression: recheckMileageReminders must NOT throw when its candidate query fails.
 *
 * recheck runs AFTER an odometer/expense write has already persisted (D5). The per-reminder loop has
 * a try/catch, but the `findMileageTracking` fetch was OUTSIDE it — and that query throws
 * DatabaseError on failure. So a DB hiccup between the (successful) write and the recheck would
 * propagate and 500 the write, contradicting the "best-effort, never throws" contract the route
 * relies on (it doesn't wrap the recheck call). This pins the fix: a fetch failure is swallowed into
 * a skip and the method resolves.
 *
 * Uses spyOn on the repository singleton (no DB needed) — the failure path is pure control flow.
 */

import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { reminderRepository } from '../repository';
import { reminderTriggerService } from '../trigger-service';

afterEach(() => {
  // Restore any spies between tests.
  spyOn(reminderRepository, 'findMileageTracking').mockRestore?.();
});

describe('recheckMileageReminders is best-effort on a query failure (C42)', () => {
  test('a findMileageTracking failure resolves to a skip, does not throw', async () => {
    const spy = spyOn(reminderRepository, 'findMileageTracking').mockRejectedValue(
      new Error('connection lost')
    );

    // Must RESOLVE (not reject) — the write that triggered this recheck already succeeded.
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
