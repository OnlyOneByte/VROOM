import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import fc from 'fast-check';
import { applyMigration, loadMigrations } from '../../../db/__tests__/migration-helpers';
import type { AppDatabase } from '../../../db/connection';
import * as schema from '../../../db/schema';
import { PreferencesRepository, SyncStateRepository } from '../repository';

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

const currencyArb = fc.constantFrom('USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY');
const backupFrequencyArb = fc.constantFrom('daily', 'weekly', 'monthly');
const syncInactivityMinutesArb = fc.integer({ min: 1, max: 60 });

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
    const prefsBefore = await prefsRepo.getOrCreate(USER_ID);

    await syncRepo.markDataChanged(USER_ID);

    const prefsAfter = await prefsRepo.getByUserId(USER_ID);
    expect(prefsAfter?.currencyUnit).toBe(prefsBefore.currencyUnit);
    expect(prefsAfter?.autoBackupEnabled).toBe(prefsBefore.autoBackupEnabled);
    expect(prefsAfter?.backupFrequency).toBe(prefsBefore.backupFrequency);

    const state = await syncRepo.getOrCreate(USER_ID);
    expect(state.lastDataChangeDate).not.toBeNull();
  });

  test('markDataChanged creates the sync_state row when it is missing', async () => {
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

describe('Independence: preferences and sync state', () => {
  test('updating preferences does not create or modify sync_state', async () => {
    await fc.assert(
      fc.asyncProperty(currencyArb, async (currency) => {
        await prefsRepo.getOrCreate(USER_ID);
        await prefsRepo.update(USER_ID, { currencyUnit: currency });

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

describe('SyncStateRepository.updateSyncDate snapshot-time semantics', () => {
  test('a change made after the snapshot but before the run finishes stays unsynced', async () => {
    const tSnap = new Date('2026-01-01T10:00:00.000Z');
    const tEdit = new Date('2026-01-01T10:02:00.000Z');
    const tEnd = new Date('2026-01-01T10:05:00.000Z');

    await syncRepo.getOrCreate(USER_ID);
    await db
      .update(schema.syncState)
      .set({ lastDataChangeDate: tEdit })
      .where(eq(schema.syncState.userId, USER_ID));
    await syncRepo.updateSyncDate(USER_ID, tSnap);
    expect(await syncRepo.hasChangesSinceLastSync(USER_ID)).toBe(true);

    await syncRepo.updateSyncDate(USER_ID, tEnd);
    expect(await syncRepo.hasChangesSinceLastSync(USER_ID)).toBe(false);
  });

  test('updateSyncDate persists the exact timestamp passed', async () => {
    const t = new Date('2026-03-15T08:30:00.000Z');
    await syncRepo.updateSyncDate(USER_ID, t);
    const row = await syncRepo.getOrCreate(USER_ID);
    expect(row.lastSyncDate?.getTime()).toBe(t.getTime());
  });

  test('updateSyncDate defaults to about now when no timestamp is given', async () => {
    const before = Date.now();
    await syncRepo.updateSyncDate(USER_ID);
    const row = await syncRepo.getOrCreate(USER_ID);
    const stamped = row.lastSyncDate?.getTime() ?? 0;
    expect(stamped).toBeGreaterThanOrEqual(before - 1000);
    expect(stamped).toBeLessThanOrEqual(Date.now() + 1000);
  });
});
