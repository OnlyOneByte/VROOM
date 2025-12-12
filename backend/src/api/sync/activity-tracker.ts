/**
 * User Activity Tracker - Activity and change tracking for auto-sync
 */

import { getDb } from '../../db/connection';
import { logger } from '../../utils/logger';

export interface UserActivity {
  userId: string;
  lastActivity: Date;
  inactivityTimer?: NodeJS.Timeout;
  syncInProgress: boolean;
}

/**
 * User Activity Tracker
 *
 * IMPORTANT: Activity data is stored in-memory and will be lost on server restart.
 *
 * For production deployments:
 * - Consider persisting activity timestamps to database
 * - Use Redis for distributed systems
 * - Implement graceful degradation on restart
 *
 * Current implementation is suitable for:
 * - Development environments
 * - Single-instance deployments
 * - Applications where activity tracking reset on restart is acceptable
 *
 * Note: lastDataChangeDate is persisted to database via userSettings table
 */
export class UserActivityTracker {
  private static instance: UserActivityTracker;
  private userActivities: Map<string, UserActivity> = new Map();

  private constructor() {}

  static getInstance(): UserActivityTracker {
    if (!UserActivityTracker.instance) {
      UserActivityTracker.instance = new UserActivityTracker();
    }
    return UserActivityTracker.instance;
  }

  recordActivity(userId: string, inactivityDelayMinutes: number = 5): void {
    const existingActivity = this.userActivities.get(userId);
    if (existingActivity?.inactivityTimer) {
      clearTimeout(existingActivity.inactivityTimer);
    }

    const inactivityTimer = setTimeout(
      () => this.handleInactivity(userId),
      inactivityDelayMinutes * 60 * 1000
    );

    this.userActivities.set(userId, {
      userId,
      lastActivity: new Date(),
      inactivityTimer,
      syncInProgress: existingActivity?.syncInProgress || false,
    });
  }

  private async handleInactivity(userId: string): Promise<void> {
    const activity = this.userActivities.get(userId);
    if (!activity || activity.syncInProgress) return;

    try {
      activity.syncInProgress = true;
      this.userActivities.set(userId, activity);
      await this.performAutoSync(userId);
    } catch (error) {
      logger.error('Auto-sync failed', { userId, error });
    } finally {
      if (activity) {
        activity.syncInProgress = false;
        this.userActivities.set(userId, activity);
      }
    }
  }

  private async performAutoSync(userId: string): Promise<void> {
    const hasChanges = await this.hasChangesSinceLastSync(userId);
    if (!hasChanges) return;

    const db = getDb();
    const { eq } = await import('drizzle-orm');
    const { userSettings } = await import('../../db/schema');

    const settings = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .limit(1);
    if (!settings.length) return;

    const syncTypes: string[] = [];
    if (settings[0].googleSheetsSyncEnabled) syncTypes.push('sheets');
    if (settings[0].googleDriveBackupEnabled) syncTypes.push('backup');

    if (syncTypes.length === 0) return;

    logger.info('Auto-sync would trigger', { userId, syncTypes });
  }

  getSyncStatus(userId: string): { lastActivity?: Date; syncInProgress: boolean } {
    const activity = this.userActivities.get(userId);
    return activity
      ? { lastActivity: activity.lastActivity, syncInProgress: activity.syncInProgress }
      : { syncInProgress: false };
  }

  stopTracking(userId: string): void {
    const activity = this.userActivities.get(userId);
    if (activity?.inactivityTimer) {
      clearTimeout(activity.inactivityTimer);
    }
    this.userActivities.delete(userId);
  }

  cleanupInactiveUsers(maxInactiveHours: number = 24): void {
    const cutoffTime = new Date(Date.now() - maxInactiveHours * 60 * 60 * 1000);
    for (const [userId, activity] of this.userActivities.entries()) {
      if (activity.lastActivity < cutoffTime && !activity.syncInProgress) {
        this.stopTracking(userId);
      }
    }
  }

  async markDataChanged(userId: string): Promise<void> {
    try {
      const db = getDb();
      const { eq } = await import('drizzle-orm');
      const { userSettings } = await import('../../db/schema');
      await db
        .update(userSettings)
        .set({ lastDataChangeDate: new Date(), updatedAt: new Date() })
        .where(eq(userSettings.userId, userId));
    } catch (error) {
      logger.error('Failed to mark data change', { userId, error });
    }
  }

  async hasChangesSinceLastSync(userId: string): Promise<boolean> {
    try {
      const db = getDb();
      const { eq } = await import('drizzle-orm');
      const { userSettings } = await import('../../db/schema');
      const settings = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, userId))
        .limit(1);

      if (!settings.length) return true;

      const { lastDataChangeDate, lastSyncDate } = settings[0];
      if (!lastSyncDate || !lastDataChangeDate) return true;
      return lastDataChangeDate > lastSyncDate;
    } catch (error) {
      logger.error('Failed to check changes', { userId, error });
      return true;
    }
  }
}

export const activityTracker = UserActivityTracker.getInstance();

setInterval(() => activityTracker.cleanupInactiveUsers(), 60 * 60 * 1000);
