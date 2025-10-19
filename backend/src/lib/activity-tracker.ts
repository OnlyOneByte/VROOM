import { databaseService } from './database';
import { logger } from './utils/logger';

export interface UserActivity {
  userId: string;
  lastActivity: Date;
  inactivityTimer?: NodeJS.Timeout;
  syncInProgress: boolean;
}

export interface SyncConfig {
  enabled: boolean;
  inactivityDelayMinutes: number;
  autoSyncEnabled: boolean;
}

export class ActivityTracker {
  private static instance: ActivityTracker;
  private userActivities: Map<string, UserActivity> = new Map();
  private defaultConfig: SyncConfig = {
    enabled: true,
    inactivityDelayMinutes: 5,
    autoSyncEnabled: true,
  };

  private constructor() {}

  static getInstance(): ActivityTracker {
    if (!ActivityTracker.instance) {
      ActivityTracker.instance = new ActivityTracker();
    }
    return ActivityTracker.instance;
  }

  /**
   * Record user activity and reset inactivity timer
   */
  recordActivity(userId: string, config?: Partial<SyncConfig>): void {
    const userConfig = { ...this.defaultConfig, ...config };

    if (!userConfig.enabled || !userConfig.autoSyncEnabled) {
      return;
    }

    const now = new Date();
    const existingActivity = this.userActivities.get(userId);

    // Clear existing timer if any
    if (existingActivity?.inactivityTimer) {
      clearTimeout(existingActivity.inactivityTimer);
    }

    // Set new inactivity timer
    const inactivityTimer = setTimeout(
      () => {
        this.handleInactivity(userId);
      },
      userConfig.inactivityDelayMinutes * 60 * 1000
    );

    // Update user activity
    this.userActivities.set(userId, {
      userId,
      lastActivity: now,
      inactivityTimer,
      syncInProgress: existingActivity?.syncInProgress || false,
    });

    logger.debug('Activity recorded for user', {
      userId,
      inactivityDelayMinutes: userConfig.inactivityDelayMinutes,
    });
  }

  /**
   * Handle user inactivity - trigger auto-sync
   */
  private async handleInactivity(userId: string): Promise<void> {
    const activity = this.userActivities.get(userId);

    if (!activity || activity.syncInProgress) {
      return;
    }

    logger.info('User inactive, triggering auto-sync', { userId });

    try {
      // Mark sync as in progress
      activity.syncInProgress = true;
      this.userActivities.set(userId, activity);

      // Perform the sync
      await this.performAutoSync(userId);

      logger.info('Auto-sync completed successfully', { userId });
    } catch (error) {
      logger.error('Auto-sync failed', { userId, error });
    } finally {
      // Mark sync as complete
      if (activity) {
        activity.syncInProgress = false;
        this.userActivities.set(userId, activity);
      }
    }
  }

  /**
   * Perform the actual auto-sync operation
   */
  private async performAutoSync(userId: string): Promise<void> {
    try {
      // Check if there are changes since last sync
      const { changeTracker } = await import('./change-tracker');
      const hasChanges = await changeTracker.hasChangesSinceLastSync(userId);

      if (!hasChanges) {
        logger.debug('Auto-sync skipped: No changes since last sync', { userId });
        return;
      }

      // Get user settings to determine enabled sync types
      const db = databaseService.getDatabase();
      const { eq } = await import('drizzle-orm');
      const { userSettings } = await import('../db/schema');

      const settings = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, userId))
        .limit(1);

      if (!settings.length) {
        logger.debug('Auto-sync skipped: No settings found', { userId });
        return;
      }

      const userSetting = settings[0];

      // Build syncTypes array based on enabled sync types
      const syncTypes: string[] = [];
      if (userSetting.googleSheetsSyncEnabled) {
        syncTypes.push('sheets');
      }
      if (userSetting.googleDriveBackupEnabled) {
        syncTypes.push('backup');
      }

      // Skip if no sync types are enabled
      if (syncTypes.length === 0) {
        logger.debug('Auto-sync skipped: No sync types enabled', { userId });
        return;
      }

      logger.info('Auto-sync starting (changes detected)', { userId });

      // Call syncOrchestrator.executeSync with syncTypes array
      const { syncOrchestrator } = await import('./services/sync/sync-orchestrator');
      const results = await syncOrchestrator.executeSync(userId, syncTypes);

      // Log results
      if (results.sheets) {
        logger.info('Auto-sync to sheets completed', { userId });
      }
      if (results.backup) {
        logger.info('Auto-sync backup to Drive completed', { userId });
      }
      if (results.errors) {
        logger.error('Auto-sync errors', { userId, errors: results.errors });
      }

      logger.info('Auto-sync completed', { userId });
    } catch (error) {
      // Handle errors gracefully (log but don't crash)
      logger.error('Auto-sync operation failed', { userId, error });
      // Don't re-throw - we want to handle errors gracefully
    }
  }

  /**
   * Manually trigger sync for a user
   */
  async triggerManualSync(userId: string): Promise<{ success: boolean; message: string }> {
    const activity = this.userActivities.get(userId);

    if (activity?.syncInProgress) {
      return {
        success: false,
        message: 'Sync already in progress',
      };
    }

    try {
      // Clear any existing inactivity timer
      if (activity?.inactivityTimer) {
        clearTimeout(activity.inactivityTimer);
      }

      // Mark sync as in progress
      this.userActivities.set(userId, {
        userId,
        lastActivity: new Date(),
        syncInProgress: true,
      });

      await this.performAutoSync(userId);

      return {
        success: true,
        message: 'Manual sync completed successfully',
      };
    } catch (error) {
      return {
        success: false,
        message: `Manual sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    } finally {
      // Mark sync as complete
      const currentActivity = this.userActivities.get(userId);
      if (currentActivity) {
        currentActivity.syncInProgress = false;
        this.userActivities.set(userId, currentActivity);
      }
    }
  }

  /**
   * Get sync status for a user
   */
  getSyncStatus(userId: string): {
    lastActivity?: Date;
    syncInProgress: boolean;
    nextSyncIn?: number; // minutes until next auto-sync
  } {
    const activity = this.userActivities.get(userId);

    if (!activity) {
      return { syncInProgress: false };
    }

    let nextSyncIn: number | undefined;
    if (activity.inactivityTimer && activity.lastActivity) {
      const timeSinceActivity = Date.now() - activity.lastActivity.getTime();
      const timeUntilSync =
        this.defaultConfig.inactivityDelayMinutes * 60 * 1000 - timeSinceActivity;
      nextSyncIn = Math.max(0, Math.ceil(timeUntilSync / (60 * 1000)));
    }

    return {
      lastActivity: activity.lastActivity,
      syncInProgress: activity.syncInProgress,
      nextSyncIn,
    };
  }

  /**
   * Stop tracking activity for a user (e.g., on logout)
   */
  stopTracking(userId: string): void {
    const activity = this.userActivities.get(userId);

    if (activity?.inactivityTimer) {
      clearTimeout(activity.inactivityTimer);
    }

    this.userActivities.delete(userId);
    logger.debug('Stopped activity tracking', { userId });
  }

  /**
   * Update sync configuration for a user
   */
  updateSyncConfig(userId: string, config: Partial<SyncConfig>): void {
    const activity = this.userActivities.get(userId);

    if (activity && config.inactivityDelayMinutes) {
      // Clear existing timer and set new one with updated delay
      if (activity.inactivityTimer) {
        clearTimeout(activity.inactivityTimer);
      }

      if (config.enabled && config.autoSyncEnabled) {
        const inactivityTimer = setTimeout(
          () => {
            this.handleInactivity(userId);
          },
          config.inactivityDelayMinutes * 60 * 1000
        );

        activity.inactivityTimer = inactivityTimer;
        this.userActivities.set(userId, activity);
      }
    }
  }

  /**
   * Get all active users being tracked
   */
  getActiveUsers(): string[] {
    return Array.from(this.userActivities.keys());
  }

  /**
   * Clean up inactive users (for memory management)
   */
  cleanupInactiveUsers(maxInactiveHours: number = 24): void {
    const cutoffTime = new Date(Date.now() - maxInactiveHours * 60 * 60 * 1000);

    for (const [userId, activity] of this.userActivities.entries()) {
      if (activity.lastActivity < cutoffTime && !activity.syncInProgress) {
        this.stopTracking(userId);
      }
    }
  }
}

// Middleware function to record user activity
export function recordUserActivity(userId: string, config?: Partial<SyncConfig>): void {
  const tracker = ActivityTracker.getInstance();
  tracker.recordActivity(userId, config);
}

// Export singleton instance
export const activityTracker = ActivityTracker.getInstance();

// Clean up inactive users every hour
setInterval(
  () => {
    activityTracker.cleanupInactiveUsers();
  },
  60 * 60 * 1000
);
