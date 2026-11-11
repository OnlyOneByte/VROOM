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
