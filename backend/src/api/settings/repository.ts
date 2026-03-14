import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../../db/connection';
import { getDb } from '../../db/connection';
import type { NewUserPreferences, SyncState, UserPreferences } from '../../db/schema';
import { syncState, userPreferences } from '../../db/schema';
import { DatabaseError } from '../../errors';
import { DEFAULT_UNIT_PREFERENCES } from '../../types';

// ---------------------------------------------------------------------------
// PreferencesRepository — reads/writes user_preferences (write-rare)
// ---------------------------------------------------------------------------

export class PreferencesRepository {
  constructor(private db: AppDatabase) {}

  async getByUserId(userId: string): Promise<UserPreferences | null> {
    try {
      const result = await this.db
        .select()
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId))
        .limit(1);
      return result[0] || null;
    } catch (error) {
      throw new DatabaseError('Failed to read user preferences', error);
    }
  }

  async getOrCreate(userId: string): Promise<UserPreferences> {
    const existing = await this.getByUserId(userId);
    if (existing) return existing;

    try {
      const newPrefs: NewUserPreferences = {
        userId,
        unitPreferences: DEFAULT_UNIT_PREFERENCES,
        currencyUnit: 'USD',
        autoBackupEnabled: false,
        backupFrequency: 'weekly',
        syncOnInactivity: true,
        syncInactivityMinutes: 5,
      };
      const result = await this.db.insert(userPreferences).values(newPrefs).returning();
      return result[0];
    } catch (error) {
      throw new DatabaseError('Failed to create user preferences', error);
    }
  }

  async update(userId: string, updates: Partial<NewUserPreferences>): Promise<UserPreferences> {
    try {
      const result = await this.db
        .update(userPreferences)
        .set({
          ...updates,
          updatedAt: new Date(),
        })
        .where(eq(userPreferences.userId, userId))
        .returning();
      return result[0];
    } catch (error) {
      throw new DatabaseError('Failed to update user preferences', error);
    }
  }
}

// ---------------------------------------------------------------------------
// SyncStateRepository — reads/writes sync_state (write-heavy)
// NOTE: sync_state has NO createdAt/updatedAt columns
// ---------------------------------------------------------------------------

export class SyncStateRepository {
  constructor(private db: AppDatabase) {}

  async getOrCreate(userId: string): Promise<SyncState> {
    try {
      const existing = await this.db
        .select()
        .from(syncState)
        .where(eq(syncState.userId, userId))
        .limit(1);
      if (existing[0]) return existing[0];

      const result = await this.db
        .insert(syncState)
        .values({
          userId,
          lastSyncDate: null,
          lastDataChangeDate: null,
          lastBackupDate: null,
        })
        .returning();
      return result[0];
    } catch (error) {
      throw new DatabaseError('Failed to get or create sync state', error);
    }
  }

  async markDataChanged(userId: string): Promise<void> {
    try {
      // Ensure row exists first (upsert pattern)
      await this.getOrCreate(userId);
      await this.db
        .update(syncState)
        .set({ lastDataChangeDate: new Date() })
        .where(eq(syncState.userId, userId));
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw new DatabaseError('Failed to mark data changed', error);
    }
  }

  async hasChangesSinceLastSync(userId: string): Promise<boolean> {
    try {
      const row = await this.getOrCreate(userId);
      if (!row.lastDataChangeDate) return false;
      if (!row.lastSyncDate) return true;
      return row.lastDataChangeDate > row.lastSyncDate;
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw new DatabaseError('Failed to check sync changes', error);
    }
  }

  async updateSyncDate(userId: string): Promise<void> {
    try {
      await this.getOrCreate(userId);
      await this.db
        .update(syncState)
        .set({ lastSyncDate: new Date() })
        .where(eq(syncState.userId, userId));
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw new DatabaseError('Failed to update sync date', error);
    }
  }

  async updateBackupDate(userId: string): Promise<void> {
    try {
      await this.getOrCreate(userId);
      await this.db
        .update(syncState)
        .set({ lastBackupDate: new Date() })
        .where(eq(syncState.userId, userId));
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw new DatabaseError('Failed to update backup date', error);
    }
  }
}

// Export singleton instances
export const preferencesRepository = new PreferencesRepository(getDb());
export const syncStateRepository = new SyncStateRepository(getDb());
