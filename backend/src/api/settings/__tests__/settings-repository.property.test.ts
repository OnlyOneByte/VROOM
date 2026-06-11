/**
 * Property-Based Tests for Settings Repository Split
 *
 * **Property 23: Settings repository split — preferences and sync state separate**
 * **Validates: Requirements 27.1, 27.2**
 *
 * Tests that preferences and sync state are stored/retrieved independently,
 * that markDataChanged updates sync_state without affecting user_preferences,
 * and that getOrCreate creates default rows when none exist.
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import fc from 'fast-check';
import { applyMigration, loadMigrations } from '../../../db/__tests__/migration-helpers';
import type { AppDatabase } from '../../../db/connection';
import * as schema from '../../../db/schema';
import { PreferencesRepository, SyncStateRepository } from '../repository';

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

let sqliteDb: Database;
let db: AppDatabase;
let prefsRepo: PreferencesRepository;
let syncRepo: SyncStateRepository;

const USER_ID = 'test-user-1';
const USER_ID_2 = 'test-user-2';

function seedUsers(): void {
  sqliteDb.run(
    `INSERT INTO users (id, email, display_name) VALUES ('${USER_ID}', 'user1@test.com', 'User One')`
  );
  sqliteDb.run(
    `INSERT INTO users (id, email, display_name) VALUES ('${USER_ID_2}', 'user2@test.com', 'User Two')`
  );
}

beforeEach(() => {
  sqliteDb = new Database(':memory:');
  sqliteDb.run('PRAGMA foreign_keys = ON');
  const migrations = loadMigrations();
  for (const m of migrations) {
    applyMigration(sqliteDb, m);
  }
  db = drizzle(sqliteDb, { schema });
  prefsRepo = new PreferencesRepository(db);
  syncRepo = new SyncStateRepository(db);
  seedUsers();
});

afterEach(() => {
  sqliteDb.close();
});

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const currencyArb = fc.constantFrom('USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY');
const backupFrequencyArb = fc.constantFrom('daily', 'weekly', 'monthly');
const syncInactivityMinutesArb = fc.integer({ min: 1, max: 60 });

// ---------------------------------------------------------------------------
// Property: getOrCreate creates default preferences when none exist
// **Validates: Requirements 27.1**
// ---------------------------------------------------------------------------

describe('PreferencesRepository', () => {
  test('getOrCreate creates default preferences for a new user', async () => {
    const prefs = await prefsRepo.getOrCreate(USER_ID);

    expect(prefs).not.toBeNull();
    expect(prefs.userId).toBe(USER_ID);
    expect(prefs.currencyUnit).toBe('USD');
    expect(prefs.autoBackupEnabled).toBe(false);
    expect(prefs.backupFrequency).toBe('weekly');
    expect(prefs.syncOnInactivity).toBe(true);
    expect(prefs.syncInactivityMinutes).toBe(5);
  });

  test('getOrCreate returns existing preferences on second call', async () => {
    const first = await prefsRepo.getOrCreate(USER_ID);
    await prefsRepo.update(USER_ID, { currencyUnit: 'EUR' });
    const second = await prefsRepo.getOrCreate(USER_ID);

    expect(second.currencyUnit).toBe('EUR');
    expect(second.userId).toBe(first.userId);
  });

  test('getByUserId returns null when no preferences exist', async () => {
    const result = await prefsRepo.getByUserId(USER_ID);
    expect(result).toBeNull();
  });

  test('update persists preference changes across reads', async () => {
    await fc.assert(
      fc.asyncProperty(
        currencyArb,
        backupFrequencyArb,
        syncInactivityMinutesArb,
        async (currency, frequency, minutes) => {
          // Ensure row exists
          await prefsRepo.getOrCreate(USER_ID);

          await prefsRepo.update(USER_ID, {
            currencyUnit: currency,
            backupFrequency: frequency,
            syncInactivityMinutes: minutes,
          });

          const read = await prefsRepo.getByUserId(USER_ID);
          expect(read).not.toBeNull();
          expect(read?.currencyUnit).toBe(currency);
          expect(read?.backupFrequency).toBe(frequency);
          expect(read?.syncInactivityMinutes).toBe(minutes);
        }
      ),
      { numRuns: 30 }
    );
  });

  test('preferences are user-scoped — one user does not see another', async () => {
    await prefsRepo.getOrCreate(USER_ID);
    await prefsRepo.update(USER_ID, { currencyUnit: 'GBP' });

    await prefsRepo.getOrCreate(USER_ID_2);
    await prefsRepo.update(USER_ID_2, { currencyUnit: 'JPY' });

    const prefs1 = await prefsRepo.getByUserId(USER_ID);
    const prefs2 = await prefsRepo.getByUserId(USER_ID_2);

    expect(prefs1?.currencyUnit).toBe('GBP');
    expect(prefs2?.currencyUnit).toBe('JPY');
  });
});

// ---------------------------------------------------------------------------
// Property: SyncStateRepository getOrCreate creates row with NULL timestamps
// **Validates: Requirements 27.2**
// ---------------------------------------------------------------------------

describe('SyncStateRepository', () => {
  test('getOrCreate creates sync state with all NULL timestamps', async () => {
    const state = await syncRepo.getOrCreate(USER_ID);

    expect(state).not.toBeNull();
    expect(state.userId).toBe(USER_ID);
    expect(state.lastSyncDate).toBeNull();
    expect(state.lastDataChangeDate).toBeNull();
    expect(state.lastBackupDate).toBeNull();
  });

  test('getOrCreate returns existing row on second call', async () => {
    await syncRepo.getOrCreate(USER_ID);
    await syncRepo.markDataChanged(USER_ID);
    const second = await syncRepo.getOrCreate(USER_ID);

    expect(second.lastDataChangeDate).not.toBeNull();
  });

  test('markDataChanged updates sync_state without affecting user_preferences', async () => {
    // Create both rows
    const prefsBefore = await prefsRepo.getOrCreate(USER_ID);

    await syncRepo.markDataChanged(USER_ID);

    // Preferences unchanged
    const prefsAfter = await prefsRepo.getByUserId(USER_ID);
    expect(prefsAfter?.currencyUnit).toBe(prefsBefore.currencyUnit);
    expect(prefsAfter?.autoBackupEnabled).toBe(prefsBefore.autoBackupEnabled);
    expect(prefsAfter?.backupFrequency).toBe(prefsBefore.backupFrequency);

    // Sync state updated
    const state = await syncRepo.getOrCreate(USER_ID);
    expect(state.lastDataChangeDate).not.toBeNull();
  });

  test('markDataChanged handles missing rows (upsert pattern)', async () => {
    // No sync_state row exists yet — markDataChanged should create one
    await syncRepo.markDataChanged(USER_ID);

    const state = await syncRepo.getOrCreate(USER_ID);
    expect(state.lastDataChangeDate).not.toBeNull();
  });

  test('hasChangesSinceLastSync returns false when no data changes', async () => {
    const result = await syncRepo.hasChangesSinceLastSync(USER_ID);
    expect(result).toBe(false);
  });

  test('hasChangesSinceLastSync returns true after markDataChanged with no sync', async () => {
    await syncRepo.markDataChanged(USER_ID);
    const result = await syncRepo.hasChangesSinceLastSync(USER_ID);
    expect(result).toBe(true);
  });

  test('hasChangesSinceLastSync returns false after sync catches up', async () => {
    await syncRepo.markDataChanged(USER_ID);
    // Small delay to ensure sync date is after data change date
    await new Promise((r) => setTimeout(r, 10));
    await syncRepo.updateSyncDate(USER_ID);

    const result = await syncRepo.hasChangesSinceLastSync(USER_ID);
    expect(result).toBe(false);
  });

  test('updateBackupDate sets lastBackupDate', async () => {
    await syncRepo.updateBackupDate(USER_ID);

    const state = await syncRepo.getOrCreate(USER_ID);
    expect(state.lastBackupDate).not.toBeNull();
  });

  test('sync state is user-scoped', async () => {
    await syncRepo.markDataChanged(USER_ID);

    const state2 = await syncRepo.getOrCreate(USER_ID_2);
    expect(state2.lastDataChangeDate).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Property: Preferences and sync state are fully independent
// **Validates: Requirements 27.1, 27.2**
// ---------------------------------------------------------------------------

describe('Independence: preferences and sync state', () => {
  test('updating preferences does not create or modify sync_state', async () => {
    await fc.assert(
      fc.asyncProperty(currencyArb, async (currency) => {
        await prefsRepo.getOrCreate(USER_ID);
        await prefsRepo.update(USER_ID, { currencyUnit: currency });

        // sync_state row should not exist unless explicitly created
        const rawRow = sqliteDb
          .query(`SELECT * FROM sync_state WHERE user_id = '${USER_ID}'`)
          .get() as Record<string, unknown> | null;
        expect(rawRow).toBeNull();
      }),
      { numRuns: 10 }
    );
  });

  test('markDataChanged does not create or modify user_preferences', async () => {
    await syncRepo.markDataChanged(USER_ID);

    const prefs = await prefsRepo.getByUserId(USER_ID);
    expect(prefs).toBeNull();
  });

  test('sync_state has no createdAt/updatedAt columns', () => {
    const columns = sqliteDb.query("PRAGMA table_info('sync_state')").all() as { name: string }[];
    const colNames = columns.map((c) => c.name);

    expect(colNames).not.toContain('created_at');
    expect(colNames).not.toContain('updated_at');
    expect(colNames).toContain('user_id');
    expect(colNames).toContain('last_sync_date');
    expect(colNames).toContain('last_data_change_date');
    expect(colNames).toContain('last_backup_date');
  });
});

// ---------------------------------------------------------------------------
// Regression (C144 #42): updateSyncDate must stamp lastSyncDate from the SNAPSHOT time, not
// end-of-run — else a data change made DURING a long backup is silently dropped from all future
// backups. A backup snapshots the DB at T_snap; if it finishes at T_end and stamps lastSyncDate=T_end,
// an edit at T_edit (T_snap < T_edit < T_end) gets lastDataChangeDate=T_edit < T_end → marked
// "already synced" forever. Stamping from T_snap keeps that edit "unsynced" for the next run.
// ---------------------------------------------------------------------------

describe('SyncStateRepository.updateSyncDate snapshot-time semantics (#42)', () => {
  test('a change made AFTER the snapshot but BEFORE the run stamps still reports unsynced', async () => {
    const tSnap = new Date('2026-01-01T10:00:00.000Z'); // backup snapshot (ZIP generated)
    const tEdit = new Date('2026-01-01T10:02:00.000Z'); // user edits mid-run
    const tEnd = new Date('2026-01-01T10:05:00.000Z'); // run finishes

    // The mid-run edit lands first (set lastDataChangeDate = tEdit directly — markDataChanged stamps
    // `now`, which isn't injectable; a direct write models "the edit happened at tEdit" deterministically).
    await syncRepo.getOrCreate(USER_ID);
    await db
      .update(schema.syncState)
      .set({ lastDataChangeDate: tEdit })
      .where(eq(schema.syncState.userId, USER_ID));
    // …then the run completes and stamps lastSyncDate from the SNAPSHOT time, not tEnd.
    await syncRepo.updateSyncDate(USER_ID, tSnap);

    // The edit (tEdit > tSnap) must still count as a pending change for the NEXT backup.
    expect(await syncRepo.hasChangesSinceLastSync(USER_ID)).toBe(true);

    // Negative control: had we stamped end-of-run (tEnd > tEdit), the change would be lost.
    await syncRepo.updateSyncDate(USER_ID, tEnd);
    expect(await syncRepo.hasChangesSinceLastSync(USER_ID)).toBe(false);
  });

  test('updateSyncDate persists the exact timestamp passed', async () => {
    const t = new Date('2026-03-15T08:30:00.000Z');
    await syncRepo.updateSyncDate(USER_ID, t);
    const row = await syncRepo.getOrCreate(USER_ID);
    expect(row.lastSyncDate?.getTime()).toBe(t.getTime());
  });

  test('updateSyncDate defaults to ~now when no timestamp is given (backward-compat)', async () => {
    const before = Date.now();
    await syncRepo.updateSyncDate(USER_ID);
    const row = await syncRepo.getOrCreate(USER_ID);
    const stamped = row.lastSyncDate?.getTime() ?? 0;
    expect(stamped).toBeGreaterThanOrEqual(before - 1000);
    expect(stamped).toBeLessThanOrEqual(Date.now() + 1000);
  });
});
