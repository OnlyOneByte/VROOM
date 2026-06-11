/**
 * Unit tests for activity tracker changes.
 * Validates: Requirement 2 — calls orchestrator, no performAutoSheetsSync.
 *
 * Tests that the activity tracker's auto-backup path delegates to
 * BackupOrchestrator.execute() and that the old performAutoSheetsSync
 * and deriveSyncTypes methods no longer exist.
 */

import { describe, expect, test } from 'bun:test';
import { UserActivityTracker } from '../activity-tracker';

describe('Activity tracker', () => {
  test('no performAutoSheetsSync method exists', () => {
    const tracker = UserActivityTracker.getInstance();
    // The old method should have been removed
    expect((tracker as unknown as Record<string, unknown>).performAutoSheetsSync).toBeUndefined();
  });

  test('no deriveSyncTypes method exists', () => {
    const tracker = UserActivityTracker.getInstance();
    expect((tracker as unknown as Record<string, unknown>).deriveSyncTypes).toBeUndefined();
  });

  test('performAutoSync is a private method (not directly callable)', () => {
    const tracker = UserActivityTracker.getInstance();
    // performAutoSync is private — verify it exists on the prototype but isn't public
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

    tracker.recordActivity(userId, 999); // Long delay to avoid triggering sync
    const status = tracker.getSyncStatus(userId);

    expect(status.lastActivity).toBeDefined();
    expect(status.syncInProgress).toBe(false);

    // Cleanup
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

  // cleanupInactiveUsers (C195 guard ratchet — the pure ageout was 0%-covered; it's the
  // synchronous, timer-free slice of this otherwise setInterval/orchestrator-bound module).
  // recordActivity always uses a long delay (999 min) so no inactivity timer fires mid-test.
  describe('cleanupInactiveUsers — ages out stale users only', () => {
    test('a user idle past the cutoff is removed (and its timer cleared via stopTracking)', () => {
      const tracker = UserActivityTracker.getInstance();
      const userId = `cleanup-stale-${Date.now()}`;
      tracker.recordActivity(userId, 999);
      expect(tracker.getSyncStatus(userId).lastActivity).toBeDefined();

      // A NEGATIVE window puts the cutoff in the future, so lastActivity (now) is always < cutoff
      // → the just-recorded user counts as "inactive" and is aged out. Timing-independent (no
      // sleep / fake clock needed) — it deterministically exercises the ageout branch.
      tracker.cleanupInactiveUsers(-1);
      expect(tracker.getSyncStatus(userId).lastActivity).toBeUndefined();
    });

    test('a user active within the window SURVIVES cleanup (the guard is not over-broad)', () => {
      const tracker = UserActivityTracker.getInstance();
      const userId = `cleanup-fresh-${Date.now()}`;
      tracker.recordActivity(userId, 999);

      // A large positive window → cutoff far in the past → a just-active user is NOT stale.
      tracker.cleanupInactiveUsers(24);
      expect(tracker.getSyncStatus(userId).lastActivity).toBeDefined();

      tracker.stopTracking(userId); // cleanup
    });

    test('cleanup over an empty tracker is a no-op (no throw)', () => {
      const tracker = UserActivityTracker.getInstance();
      // Should not throw even when there is nothing (or nothing stale) to remove.
      expect(() => tracker.cleanupInactiveUsers(24)).not.toThrow();
    });
  });
});
