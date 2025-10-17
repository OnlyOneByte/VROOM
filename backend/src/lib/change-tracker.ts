import { databaseService } from './database';

/**
 * Service to track data changes for sync optimization
 */
export class ChangeTracker {
  private static instance: ChangeTracker;

  private constructor() {}

  static getInstance(): ChangeTracker {
    if (!ChangeTracker.instance) {
      ChangeTracker.instance = new ChangeTracker();
    }
    return ChangeTracker.instance;
  }

  /**
   * Mark that user data has changed
   */
  async markDataChanged(userId: string): Promise<void> {
    try {
      const db = databaseService.getDatabase();
      const { eq } = await import('drizzle-orm');
      const { userSettings } = await import('../db/schema');

      await db
        .update(userSettings)
        .set({
          lastDataChangeDate: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(userSettings.userId, userId));

      console.log(`Data change marked for user ${userId}`);
    } catch (error) {
      console.error(`Failed to mark data change for user ${userId}:`, error);
      // Don't throw - this is a non-critical operation
    }
  }

  /**
   * Check if user has changes since last sync
   */
  async hasChangesSinceLastSync(userId: string): Promise<boolean> {
    try {
      const db = databaseService.getDatabase();
      const { eq } = await import('drizzle-orm');
      const { userSettings } = await import('../db/schema');

      const settings = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, userId))
        .limit(1);

      if (!settings.length) {
        // No settings found, assume changes exist
        return true;
      }

      const { lastDataChangeDate, lastSyncDate } = settings[0];

      // If no sync has ever happened, there are changes
      if (!lastSyncDate) {
        return true;
      }

      // If no data change date is recorded, assume changes exist
      if (!lastDataChangeDate) {
        return true;
      }

      // Compare timestamps
      return lastDataChangeDate > lastSyncDate;
    } catch (error) {
      console.error(`Failed to check changes for user ${userId}:`, error);
      // On error, assume changes exist to be safe
      return true;
    }
  }

  /**
   * Get change status for a user
   */
  async getChangeStatus(userId: string): Promise<{
    hasChanges: boolean;
    lastDataChangeDate?: Date;
    lastSyncDate?: Date;
  }> {
    try {
      const db = databaseService.getDatabase();
      const { eq } = await import('drizzle-orm');
      const { userSettings } = await import('../db/schema');

      const settings = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, userId))
        .limit(1);

      if (!settings.length) {
        return { hasChanges: true };
      }

      const { lastDataChangeDate, lastSyncDate } = settings[0];
      const hasChanges = await this.hasChangesSinceLastSync(userId);

      return {
        hasChanges,
        lastDataChangeDate: lastDataChangeDate || undefined,
        lastSyncDate: lastSyncDate || undefined,
      };
    } catch (error) {
      console.error(`Failed to get change status for user ${userId}:`, error);
      return { hasChanges: true };
    }
  }
}

// Export singleton instance
export const changeTracker = ChangeTracker.getInstance();

/**
 * Helper function to mark data changed
 */
export function markDataChanged(userId: string): void {
  // Fire and forget - don't await
  changeTracker.markDataChanged(userId).catch((error) => {
    console.error('Failed to mark data changed:', error);
  });
}
