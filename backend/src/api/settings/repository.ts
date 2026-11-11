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

  /**
   * Read the user's preferences row, lazily creating the defaults row on first use.
   *
   * The create is an UPSERT, not a conditional insert: `user_preferences` is PK'd by userId and this
   * row is created lazily, so a brand-new account whose first session fires several
   * preference-touching requests at once (two tabs, a reload mid-load, the activity middleware
   * overlapping a settings fetch) has every one of them miss the pre-select. `onConflictDoNothing`
   * makes the losers no-ops that then read the winner's row, instead of raising
   * SQLITE_CONSTRAINT_PRIMARYKEY and 500-ing a brand-new user's first page load. The pre-select
   * stays as the fast path for the overwhelmingly common already-exists case.
   */
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

      // Conflict: a concurrent caller created the row between our select and our insert. Its row is
      // the one source of truth — read it rather than reporting a failure.
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

  /**
   * ATOMIC deep-merge of a partial JSON patch into one JSON column, in a SINGLE UPDATE.
   * The legacy read-modify-write pattern — `getOrCreate()` → JS-merge →
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

  /**
   * Read the user's sync-state row, lazily creating it on first use.
   *
   * Same upsert shape as PreferencesRepository.getOrCreate and for the same reason: sync_state is
   * PK'd by userId and created lazily, so concurrent first-time callers all miss the pre-select.
   * `onConflictDoNothing` + re-read makes the losers no-ops instead of PRIMARY KEY failures (here
   * they would surface as a swallowed activity/change-tracking error and a noisy log). Note
   * sync_state has no createdAt/updatedAt columns, so there is nothing to touch on conflict.
   */
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

  /** The user's sync-state row, or null when it has not been created yet. */
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
   *  Defaults to now for callers with no snapshot semantics.
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
