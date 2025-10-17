import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { ActivityTracker } from '../../lib/activity-tracker';

describe('Auto-Sync Integration Tests', () => {
  let activityTracker: ActivityTracker;
  let originalConsoleLog: typeof console.log;
  let originalConsoleError: typeof console.error;

  beforeEach(() => {
    activityTracker = ActivityTracker.getInstance();
    // Suppress console logs during tests
    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    console.log = mock(() => {});
    console.error = mock(() => {});
  });

  afterEach(() => {
    // Restore console
    console.log = originalConsoleLog;
    console.error = originalConsoleError;

    // Clean up any active timers
    const activeUsers = activityTracker.getActiveUsers();
    for (const userId of activeUsers) {
      activityTracker.stopTracking(userId);
    }
  });

  describe('Activity Recording', () => {
    it('should record user activity and set inactivity timer', () => {
      const userId = 'test-user-1';

      activityTracker.recordActivity(userId, {
        enabled: true,
        inactivityDelayMinutes: 5,
        autoSyncEnabled: true,
      });

      const status = activityTracker.getSyncStatus(userId);

      expect(status.lastActivity).toBeDefined();
      expect(status.syncInProgress).toBe(false);
      expect(status.nextSyncIn).toBeDefined();
      expect(status.nextSyncIn).toBeGreaterThan(0);
    });

    it('should reset inactivity timer on subsequent activity', async () => {
      const userId = 'test-user-2';

      // Record first activity
      activityTracker.recordActivity(userId, {
        enabled: true,
        inactivityDelayMinutes: 5,
        autoSyncEnabled: true,
      });

      const firstStatus = activityTracker.getSyncStatus(userId);
      const firstActivity = firstStatus.lastActivity;

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Record second activity
      activityTracker.recordActivity(userId, {
        enabled: true,
        inactivityDelayMinutes: 5,
        autoSyncEnabled: true,
      });

      const secondStatus = activityTracker.getSyncStatus(userId);
      const secondActivity = secondStatus.lastActivity;

      expect(secondActivity).not.toEqual(firstActivity);
    });

    it('should not record activity when disabled', () => {
      const userId = 'test-user-3';

      activityTracker.recordActivity(userId, {
        enabled: false,
        inactivityDelayMinutes: 5,
        autoSyncEnabled: true,
      });

      const status = activityTracker.getSyncStatus(userId);

      expect(status.lastActivity).toBeUndefined();
      expect(status.syncInProgress).toBe(false);
    });

    it('should not record activity when auto-sync is disabled', () => {
      const userId = 'test-user-4';

      activityTracker.recordActivity(userId, {
        enabled: true,
        inactivityDelayMinutes: 5,
        autoSyncEnabled: false,
      });

      const status = activityTracker.getSyncStatus(userId);

      expect(status.lastActivity).toBeUndefined();
      expect(status.syncInProgress).toBe(false);
    });
  });

  describe('Inactivity Timer', () => {
    it('should set up timer that will trigger after inactivity period', () => {
      const userId = 'test-user-5';

      activityTracker.recordActivity(userId, {
        enabled: true,
        inactivityDelayMinutes: 5,
        autoSyncEnabled: true,
      });

      const status = activityTracker.getSyncStatus(userId);

      // Verify timer is set up (nextSyncIn should be defined and positive)
      expect(status.nextSyncIn).toBeDefined();
      expect(status.nextSyncIn).toBeGreaterThan(0);
      expect(status.nextSyncIn).toBeLessThanOrEqual(5);
    });

    it('should reset timer when activity is recorded again', async () => {
      const userId = 'test-user-6';

      activityTracker.recordActivity(userId, {
        enabled: true,
        inactivityDelayMinutes: 5,
        autoSyncEnabled: true,
      });

      const firstStatus = activityTracker.getSyncStatus(userId);
      const firstNextSync = firstStatus.nextSyncIn;

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Record activity again (resets timer)
      activityTracker.recordActivity(userId, {
        enabled: true,
        inactivityDelayMinutes: 5,
        autoSyncEnabled: true,
      });

      const secondStatus = activityTracker.getSyncStatus(userId);
      const secondNextSync = secondStatus.nextSyncIn;

      // Timer should be reset (nextSyncIn should be close to the full duration again)
      expect(secondNextSync).toBeGreaterThanOrEqual(firstNextSync || 0);
    });
  });

  describe('Sync Status', () => {
    it('should return correct sync status', () => {
      const userId = 'test-user-7';

      activityTracker.recordActivity(userId, {
        enabled: true,
        inactivityDelayMinutes: 5,
        autoSyncEnabled: true,
      });

      const status = activityTracker.getSyncStatus(userId);

      expect(status).toHaveProperty('lastActivity');
      expect(status).toHaveProperty('syncInProgress');
      expect(status).toHaveProperty('nextSyncIn');
      expect(status.syncInProgress).toBe(false);
    });

    it('should return empty status for non-tracked user', () => {
      const status = activityTracker.getSyncStatus('non-existent-user');

      expect(status.lastActivity).toBeUndefined();
      expect(status.syncInProgress).toBe(false);
      expect(status.nextSyncIn).toBeUndefined();
    });
  });

  describe('Stop Tracking', () => {
    it('should stop tracking user and clear timer', () => {
      const userId = 'test-user-8';

      activityTracker.recordActivity(userId, {
        enabled: true,
        inactivityDelayMinutes: 5,
        autoSyncEnabled: true,
      });

      expect(activityTracker.getSyncStatus(userId).lastActivity).toBeDefined();

      activityTracker.stopTracking(userId);

      const status = activityTracker.getSyncStatus(userId);
      expect(status.lastActivity).toBeUndefined();
      expect(status.syncInProgress).toBe(false);
    });
  });
});
