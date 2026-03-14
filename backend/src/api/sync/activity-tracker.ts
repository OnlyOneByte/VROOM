/**
 * User Activity Tracker - Activity and change tracking for auto-sync
 */

import { eq } from 'drizzle-orm';
import { getDb } from '../../db/connection';
import { users as usersTable } from '../../db/schema';
import { logger } from '../../utils/logger';
import { syncStateRepository } from '../settings/repository';

import { backupOrchestrator } from './backup-orchestrator';

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
 * Note: lastDataChangeDate is persisted to database via sync_state table
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

    logger.info('Auto-sync triggered', { userId });
    await this.performAutoBackup(userId);
  }

  private async performAutoBackup(userId: string): Promise<void> {
    try {
      const db = getDb();

      const userResult = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);
      if (userResult.length > 0) {
        await backupOrchestrator.execute(userId, userResult[0].displayName, false);
        logger.info('Auto-sync backup completed', { userId });
      }
    } catch (error) {
      logger.error('Auto-sync backup failed', { userId, error });
    }
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
      await syncStateRepository.markDataChanged(userId);
    } catch (error) {
      logger.error('Failed to mark data change', { userId, error });
    }
  }

  async hasChangesSinceLastSync(userId: string): Promise<boolean> {
    try {
      return await syncStateRepository.hasChangesSinceLastSync(userId);
    } catch (error) {
      logger.error('Failed to check changes', { userId, error });
      return true;
    }
  }
}

export const activityTracker = UserActivityTracker.getInstance();
