/**
 * Repository for user settings database operations
 */

import { eq } from 'drizzle-orm';
import { type UserSettings, userSettings } from '../../db/schema';
import type { Database } from '../database';

export class SettingsRepository {
  constructor(private db: Database) {}

  /**
   * Get user settings by user ID
   */
  async getUserSettings(userId: string): Promise<UserSettings | null> {
    const results = await this.db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .limit(1);

    return results.length > 0 ? results[0] : null;
  }

  /**
   * Update sync configuration
   */
  async updateSyncConfig(
    userId: string,
    config: {
      googleSheetsSyncEnabled?: boolean;
      googleDriveBackupEnabled?: boolean;
      syncInactivityMinutes?: number;
    }
  ): Promise<void> {
    await this.db
      .update(userSettings)
      .set({
        ...config,
        updatedAt: new Date(),
      })
      .where(eq(userSettings.userId, userId));
  }

  /**
   * Update last sync date
   */
  async updateLastSyncDate(userId: string, spreadsheetId?: string): Promise<void> {
    const updateData: {
      lastSyncDate: Date;
      googleSheetsSpreadsheetId?: string;
      updatedAt: Date;
    } = {
      lastSyncDate: new Date(),
      updatedAt: new Date(),
    };

    if (spreadsheetId) {
      updateData.googleSheetsSpreadsheetId = spreadsheetId;
    }

    await this.db.update(userSettings).set(updateData).where(eq(userSettings.userId, userId));
  }

  /**
   * Update last backup date
   */
  async updateLastBackupDate(userId: string, backupFolderId?: string): Promise<void> {
    const updateData: {
      lastBackupDate: Date;
      googleDriveBackupFolderId?: string;
      updatedAt: Date;
    } = {
      lastBackupDate: new Date(),
      updatedAt: new Date(),
    };

    if (backupFolderId) {
      updateData.googleDriveBackupFolderId = backupFolderId;
    }

    await this.db.update(userSettings).set(updateData).where(eq(userSettings.userId, userId));
  }

  /**
   * Update last backup date with a specific date (for pulling from existing backups)
   */
  async updateLastBackupDateWithTime(userId: string, backupDate: Date): Promise<void> {
    await this.db
      .update(userSettings)
      .set({
        lastBackupDate: backupDate,
        updatedAt: new Date(),
      })
      .where(eq(userSettings.userId, userId));
  }

  /**
   * Update Google Drive backup folder ID
   */
  async updateBackupFolderId(userId: string, folderId: string): Promise<void> {
    await this.db
      .update(userSettings)
      .set({
        googleDriveBackupFolderId: folderId,
        updatedAt: new Date(),
      })
      .where(eq(userSettings.userId, userId));
  }
}
