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

  async getOrCreate(userId: string): Promise<UserSettings> {
    const existing = await this.getByUserId(userId);
    if (existing) return existing;

    // Create default settings
    const newSettings: NewUserSettings = {
      userId,
      distanceUnit: 'miles',
      fuelUnit: 'gallons',
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

  async updateBackupDate(userId: string): Promise<void> {
    await this.db
      .update(userSettings)
      .set({
        lastBackupDate: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(userSettings.userId, userId));
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
}
