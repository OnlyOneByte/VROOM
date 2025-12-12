import { eq } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type { NewUserSettings, UserSettings } from '../../db/schema';
import { userSettings } from '../../db/schema';

export class SettingsRepository {
  constructor(private db: BunSQLiteDatabase<Record<string, unknown>>) {}

  async getByUserId(userId: string): Promise<UserSettings | null> {
    const result = await this.db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .limit(1);

    return result[0] || null;
  }

  // Alias for getByUserId for backward compatibility
  async getUserSettings(userId: string): Promise<UserSettings | null> {
    return this.getByUserId(userId);
  }

  async getOrCreate(userId: string): Promise<UserSettings> {
    const existing = await this.getByUserId(userId);
    if (existing) return existing;

    // Create default settings
    const newSettings: NewUserSettings = {
      userId,
      distanceUnit: 'miles',
      volumeUnit: 'gallons_us',
      chargeUnit: 'kwh',
      currencyUnit: 'USD',
      autoBackupEnabled: false,
      backupFrequency: 'weekly',
      googleDriveBackupEnabled: false,
    };

    const result = await this.db.insert(userSettings).values(newSettings).returning();
    return result[0];
  }

  async update(userId: string, updates: Partial<NewUserSettings>): Promise<UserSettings> {
    const result = await this.db
      .update(userSettings)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(userSettings.userId, userId))
      .returning();

    return result[0];
  }

  async updateBackupDate(userId: string, backupFolderId?: string): Promise<void> {
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

  async updateBackupDateWithTime(userId: string, backupDate: Date): Promise<void> {
    await this.db
      .update(userSettings)
      .set({
        lastBackupDate: backupDate,
        updatedAt: new Date(),
      })
      .where(eq(userSettings.userId, userId));
  }

  async updateSyncDate(userId: string, spreadsheetId?: string): Promise<void> {
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
