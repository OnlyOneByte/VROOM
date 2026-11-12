import { eq, sql } from 'drizzle-orm';
import type { AppDatabase } from '../../db/connection';
import { getDb } from '../../db/connection';
import type { NewUserPreferences, SyncState, UserPreferences } from '../../db/schema';
import { syncState, userPreferences } from '../../db/schema';
import { DatabaseError } from '../../errors';
import { DEFAULT_UNIT_PREFERENCES } from '../../types';

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
      const inserted = await this.db
        .insert(userPreferences)
        .values(newPrefs)
        .onConflictDoNothing()
        .returning();
      if (inserted[0]) return inserted[0];

      const concurrent = await this.getByUserId(userId);
      if (concurrent) return concurrent;
      throw new DatabaseError('User preferences row vanished after an upsert');
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
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

  // One UPDATE statement: a read-modify-write here would lose concurrent patches.
  async mergeJsonField(
    userId: string,
    column: 'storageConfig' | 'backupConfig',
    patch: Record<string, unknown>
  ): Promise<UserPreferences | null> {
    // Column names come from a closed map; never interpolate user input into SQL.
    const sqlColumn = column === 'storageConfig' ? 'storage_config' : 'backup_config';
    try {
      const result = await this.db
        .update(userPreferences)
        .set({
          [column]: sql`json_patch(coalesce(${sql.raw(sqlColumn)}, '{}'), ${JSON.stringify(patch)})`,
          updatedAt: new Date(),
        })
        .where(eq(userPreferences.userId, userId))
        .returning();
      return result[0] ?? null;
    } catch (error) {
      throw new DatabaseError('Failed to merge user preferences JSON field', error);
    }
  }
}

export class SyncStateRepository {
  constructor(private db: AppDatabase) {}

  async getOrCreate(userId: string): Promise<SyncState> {
    try {
      const existing = await this.read(userId);
      if (existing) return existing;

      const inserted = await this.db
        .insert(syncState)
        .values({
          userId,
          lastSyncDate: null,
          lastDataChangeDate: null,
          lastBackupDate: null,
        })
        .onConflictDoNothing()
        .returning();
      if (inserted[0]) return inserted[0];

      const concurrent = await this.read(userId);
      if (concurrent) return concurrent;
      throw new DatabaseError('Sync state row vanished after an upsert');
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw new DatabaseError('Failed to get or create sync state', error);
    }
  }

  private async read(userId: string): Promise<SyncState | null> {
    const rows = await this.db
      .select()
      .from(syncState)
      .where(eq(syncState.userId, userId))
      .limit(1);
    return rows[0] ?? null;
  }

  async markDataChanged(userId: string): Promise<void> {
    try {
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

  // syncedAt must be the snapshot time: a mid-run change stamped as synced would be dropped from every future backup.
  async updateSyncDate(userId: string, syncedAt: Date = new Date()): Promise<void> {
    try {
      await this.getOrCreate(userId);
      await this.db
        .update(syncState)
        .set({ lastSyncDate: syncedAt })
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

export const preferencesRepository = new PreferencesRepository(getDb());
export const syncStateRepository = new SyncStateRepository(getDb());
