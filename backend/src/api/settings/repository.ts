import { eq } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { getDb } from '../../db/connection';
import type { NewUserSettings, UserSettings } from '../../db/schema';
import { userSettings } from '../../db/schema';
import { DEFAULT_UNIT_PREFERENCES } from '../../types';

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
      unitPreferences: DEFAULT_UNIT_PREFERENCES,
      currencyUnit: 'USD',
      autoBackupEnabled: false,
      backupFrequency: 'weekly',
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

  async updateSyncDate(userId: string): Promise<void> {
    await this.db
      .update(userSettings)
      .set({
        lastSyncDate: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(userSettings.userId, userId));
  }

  async updateBackupConfig(
    userId: string,
    config: import('../../types').BackupConfig
  ): Promise<void> {
    await this.db
      .update(userSettings)
      .set({
        backupConfig: config,
        updatedAt: new Date(),
      })
      .where(eq(userSettings.userId, userId));
  }
}

// Export singleton instance
export const settingsRepository = new SettingsRepository(getDb());
