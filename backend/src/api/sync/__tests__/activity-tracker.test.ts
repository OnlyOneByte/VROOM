import { describe, expect, test } from 'bun:test';
import { UserActivityTracker } from '../activity-tracker';

describe('Activity tracker', () => {
  test('no performAutoSheetsSync method exists', () => {
    const tracker = UserActivityTracker.getInstance();
    expect((tracker as unknown as Record<string, unknown>).performAutoSheetsSync).toBeUndefined();
  });

  test('no deriveSyncTypes method exists', () => {
    const tracker = UserActivityTracker.getInstance();
    expect((tracker as unknown as Record<string, unknown>).deriveSyncTypes).toBeUndefined();
  });

  test('performAutoSync is a private method (not directly callable)', () => {
    const tracker = UserActivityTracker.getInstance();
    const proto = Object.getPrototypeOf(tracker);
    const methodNames = Object.getOwnPropertyNames(proto);
    expect(methodNames).toContain('performAutoSync');
    expect(methodNames).toContain('performAutoBackup');
  });

  test('getSyncStatus returns correct shape', () => {
    const tracker = UserActivityTracker.getInstance();
    const status = tracker.getSyncStatus('nonexistent-user');
    expect(status).toEqual({ syncInProgress: false });
  });

  test('recordActivity and getSyncStatus reflect activity', () => {
    const tracker = UserActivityTracker.getInstance();
    const userId = `test-user-${Date.now()}`;

    tracker.recordActivity(userId, 999);
    const status = tracker.getSyncStatus(userId);

    expect(status.lastActivity).toBeDefined();
    expect(status.syncInProgress).toBe(false);

    tracker.stopTracking(userId);
  });

  test('stopTracking removes user activity', () => {
    const tracker = UserActivityTracker.getInstance();
    const userId = `test-user-stop-${Date.now()}`;

    tracker.recordActivity(userId, 999);
    expect(tracker.getSyncStatus(userId).lastActivity).toBeDefined();

    tracker.stopTracking(userId);
    expect(tracker.getSyncStatus(userId).lastActivity).toBeUndefined();
  });

  // recordActivity uses a long delay so no inactivity timer fires mid-test.
  describe('cleanupInactiveUsers — ages out stale users only', () => {
    test('a user idle past the cutoff is removed (and its timer cleared via stopTracking)', () => {
      const tracker = UserActivityTracker.getInstance();
      const userId = `cleanup-stale-${Date.now()}`;
      tracker.recordActivity(userId, 999);
      expect(tracker.getSyncStatus(userId).lastActivity).toBeDefined();

      // A negative window puts the cutoff in the future, so the just-recorded user is always stale.
      tracker.cleanupInactiveUsers(-1);
      expect(tracker.getSyncStatus(userId).lastActivity).toBeUndefined();
    });

    test('a user active within the window SURVIVES cleanup (the guard is not over-broad)', () => {
      const tracker = UserActivityTracker.getInstance();
      const userId = `cleanup-fresh-${Date.now()}`;
      tracker.recordActivity(userId, 999);

      // A large positive window puts the cutoff in the past, so a just-active user is not stale.
      tracker.cleanupInactiveUsers(24);
      expect(tracker.getSyncStatus(userId).lastActivity).toBeDefined();

      tracker.stopTracking(userId);
    });

    test('cleanup over an empty tracker is a no-op (no throw)', () => {
      const tracker = UserActivityTracker.getInstance();
      expect(() => tracker.cleanupInactiveUsers(24)).not.toThrow();
    });

    test('a STALE user that is mid-sync is NOT evicted (the syncInProgress guard)', () => {
      // A user with a backup in flight must not be evicted, or its tracking is dropped mid-sync.
      const tracker = UserActivityTracker.getInstance();
      const userId = `cleanup-midsync-${Date.now()}`;
      tracker.recordActivity(userId, 999);

      const activities = (
        tracker as unknown as { userActivities: Map<string, { syncInProgress: boolean }> }
      ).userActivities;
      const activity = activities.get(userId);
      expect(activity, 'the just-recorded activity should exist').toBeDefined();
      if (!activity) throw new Error('unreachable');
      activity.syncInProgress = true;

      tracker.cleanupInactiveUsers(-1);
      expect(
        tracker.getSyncStatus(userId).lastActivity,
        'a mid-sync user must survive cleanup even when stale'
      ).toBeDefined();
      expect(tracker.getSyncStatus(userId).syncInProgress).toBe(true);

      // Once the sync finishes, the same user is evicted, so the flag alone is the guard.
      activity.syncInProgress = false;
      tracker.cleanupInactiveUsers(-1);
      expect(
        tracker.getSyncStatus(userId).lastActivity,
        'after sync completes, the stale user ages out normally'
      ).toBeUndefined();
    });
  });

  // On a repo error the check returns true, so a backup runs rather than being silently skipped.
  describe('hasChangesSinceLastSync — fails open on a repo error', () => {
    test('a throwing syncStateRepository.hasChangesSinceLastSync returns true', async () => {
      const tracker = UserActivityTracker.getInstance();
      const repoModule = await import('../../settings/repository');
      const original = repoModule.syncStateRepository.hasChangesSinceLastSync;
      (
        repoModule.syncStateRepository as unknown as {
          hasChangesSinceLastSync: (userId: string) => Promise<boolean>;
        }
      ).hasChangesSinceLastSync = () => Promise.reject(new Error('db down'));
      try {
        const result = await tracker.hasChangesSinceLastSync(`fail-open-${Date.now()}`);
        expect(result, 'a check failure must fail OPEN (true → back up), never silently skip').toBe(
          true
        );
      } finally {
        (
          repoModule.syncStateRepository as unknown as {
            hasChangesSinceLastSync: typeof original;
          }
        ).hasChangesSinceLastSync = original;
      }
    });
  });
});
