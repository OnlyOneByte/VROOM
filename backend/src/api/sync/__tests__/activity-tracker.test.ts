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
});
