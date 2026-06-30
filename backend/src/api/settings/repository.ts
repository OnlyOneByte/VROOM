import { eq, sql } from 'drizzle-orm';
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

  /**
   * ATOMIC deep-merge of a partial JSON patch into one JSON column, in a SINGLE UPDATE (#100,
   * Angelo-decided 2026-06-23). The legacy read-modify-write pattern — `getOrCreate()` → JS-merge →
   * `update()` — has a lost-update race: a concurrent request's merge, computed from the same stale read,
   * clobbers ours (last-writer-wins). SQLite's `json_patch(target, patch)` applies an RFC-7386 merge-patch
   * RECURSIVELY inside the DB engine with no JS read-then-write gap, so two concurrent delta-merges BOTH
   * survive.
   *
   * RFC-7386 semantics (verified firsthand): nested objects deep-merge; a scalar/array replaces; and a
   * `null` value in the patch DELETES that key. So this method serves two shapes: (a) a partial deep-merge
   * of nested settings, and (b) a key-deletion (patch `{ [k]: null }`) — e.g. removing a deleted provider
   * from `backupConfig.providers`. Callers needing conditional/read-dependent edits (e.g. "null a default
   * only if it points at this provider") still can't be a static patch — those stay read-modify-write.
   *
   * `column` is constrained to the JSON-typed preference columns; `coalesce(col,'{}')` lets a NULL/unset
   * column merge cleanly from empty. Returns the updated row (or null if the user has no prefs row — callers
   * ensure the row exists, e.g. via getOrCreate, before patching).
   */
  async mergeJsonField(
    userId: string,
    column: 'storageConfig' | 'backupConfig',
    patch: Record<string, unknown>
  ): Promise<UserPreferences | null> {
    // Closed, literal map camelCase field → snake_case SQL column (no user input reaches the column name).
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

  /**
   * Stamp `lastSyncDate` — the watermark `hasChangesSinceLastSync` compares `lastDataChangeDate`
   * against. `syncedAt` MUST be the moment the synced data was SNAPSHOTTED (when the backup ZIP was
   * generated), NOT the moment the run finished: a long run can take minutes, and any data change made
   * AFTER the snapshot but BEFORE completion would otherwise be stamped as "already synced" (its
   * lastDataChangeDate < a fresh end-of-run lastSyncDate) and silently dropped from all future backups
   * (C144 #42). Defaults to now for callers with no snapshot semantics.
   */
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

// Export singleton instances
export const preferencesRepository = new PreferencesRepository(getDb());
export const syncStateRepository = new SyncStateRepository(getDb());
