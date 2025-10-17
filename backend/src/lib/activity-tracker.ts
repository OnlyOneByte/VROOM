import { databaseService } from './database';

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

    console.log(
      `Activity recorded for user ${userId}, auto-sync will trigger in ${userConfig.inactivityDelayMinutes} minutes`
    );
  }

  /**
   * Handle user inactivity - trigger auto-sync
   */
  private async handleInactivity(userId: string): Promise<void> {
    const activity = this.userActivities.get(userId);

    if (!activity || activity.syncInProgress) {
      return;
    }

    console.log(`User ${userId} has been inactive, triggering auto-sync...`);

    try {
      // Mark sync as in progress
      activity.syncInProgress = true;
      this.userActivities.set(userId, activity);

      // Perform the sync
      await this.performAutoSync(userId);

      console.log(`Auto-sync completed successfully for user ${userId}`);
    } catch (error) {
      console.error(`Auto-sync failed for user ${userId}:`, error);
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
        console.log(`Auto-sync skipped for user ${userId}: No changes since last sync`);
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
        console.log(`Auto-sync skipped for user ${userId}: No settings found`);
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
        console.log(`Auto-sync skipped for user ${userId}: No sync types enabled`);
        return;
      }

      console.log(`Auto-sync starting for user ${userId} (changes detected)`);

      // Call SyncService.executeSync with syncTypes array
      const { SyncService } = await import('./sync-service');
      const syncService = new SyncService();
      const results = await syncService.executeSync(userId, syncTypes);

      // Log results
      if (results.sheets) {
        console.log(`Auto-sync to sheets completed for user ${userId}`);
      }
      if (results.backup) {
        console.log(`Auto-sync backup to Drive completed for user ${userId}`);
      }
      if (results.errors) {
        console.error(`Auto-sync errors for user ${userId}:`, results.errors);
      }

      console.log(`Auto-sync completed for user ${userId}`);
    } catch (error) {
      // Handle errors gracefully (log but don't crash)
      console.error(`Auto-sync operation failed for user ${userId}:`, error);
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
    console.log(`Stopped activity tracking for user ${userId}`);
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
