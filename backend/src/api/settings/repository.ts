import { eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import type { AsyncAppDatabase } from '../../db/async-sqlite';
import type { AppDatabase } from '../../db/connection';
import { jsonMergePatch } from '../../db/dialect';
import type { NewUserPreferences, SyncState, UserPreferences } from '../../db/schema';
import {
  expenses,
  insuranceClaims,
  insurancePolicies,
  insuranceTerms,
  reminders,
  syncState,
  userPreferences,
  vehicleFinancing,
  vehicles,
} from '../../db/schema';
import type { DrizzleTransaction } from '../../db/types';
import { DatabaseError } from '../../errors';
import { DEFAULT_UNIT_PREFERENCES } from '../../types';
import { minorUnitScale } from '../../utils/money';
import { type BackupTables, MONEY_CENTS_FIELDS, rescaleMoneyTables } from '../sync/backup';

const DEFAULT_CURRENCY = 'USD';

const JSON_FIELD_COLUMNS = {
  storageConfig: 'storage_config',
  backupConfig: 'backup_config',
  providerDefaults: 'provider_defaults',
} as const;

export class PreferencesRepository {
  constructor(private db: AsyncAppDatabase) {}

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

  async moneyScale(userId: string): Promise<number> {
    const prefs = await this.getByUserId(userId);
    return minorUnitScale(prefs?.currencyUnit ?? DEFAULT_CURRENCY);
  }

  async moneyScales(userIds: Iterable<string>): Promise<(userId: string) => number> {
    const ids = [...new Set(userIds)];
    const rows = ids.length
      ? await this.db
          .select({ userId: userPreferences.userId, currency: userPreferences.currencyUnit })
          .from(userPreferences)
          .where(inArray(userPreferences.userId, ids))
      : [];
    const currencies = new Map(rows.map((row) => [row.userId, row.currency]));
    return (userId) => minorUnitScale(currencies.get(userId) ?? DEFAULT_CURRENCY);
  }

  async getOrCreate(userId: string): Promise<UserPreferences> {
    const existing = await this.getByUserId(userId);
    if (existing) return existing;

    try {
      const newPrefs: NewUserPreferences = {
        userId,
        unitPreferences: DEFAULT_UNIT_PREFERENCES,
        currencyUnit: DEFAULT_CURRENCY,
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
    column: keyof typeof JSON_FIELD_COLUMNS,
    patch: Record<string, unknown>
  ): Promise<UserPreferences | null> {
    // Column names come from a closed map; never interpolate user input into SQL.
    const sqlColumn = JSON_FIELD_COLUMNS[column];
    try {
      const result = await this.db
        .update(userPreferences)
        .set({
          [column]: jsonMergePatch(sql.raw(sqlColumn), patch),
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

const OWNED_MONEY_TABLES = {
  vehicles,
  expenses,
  financing: vehicleFinancing,
  insuranceTerms,
  insuranceClaims,
  reminders,
} as const;

function ownedMoneyRows(tx: DrizzleTransaction, userId: string): BackupTables {
  const ids = (rows: { id: string }[]) => rows.map((row) => row.id);
  const vehicleIds = ids(
    tx.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.userId, userId)).all()
  );
  const policyIds = ids(
    tx
      .select({ id: insurancePolicies.id })
      .from(insurancePolicies)
      .where(eq(insurancePolicies.userId, userId))
      .all()
  );
  return {
    vehicles: tx.select().from(vehicles).where(eq(vehicles.userId, userId)).all(),
    expenses: tx.select().from(expenses).where(eq(expenses.userId, userId)).all(),
    financing: tx
      .select()
      .from(vehicleFinancing)
      .where(inArray(vehicleFinancing.vehicleId, vehicleIds))
      .all(),
    insuranceTerms: tx
      .select()
      .from(insuranceTerms)
      .where(inArray(insuranceTerms.policyId, policyIds))
      .all(),
    insuranceClaims: tx
      .select()
      .from(insuranceClaims)
      .where(inArray(insuranceClaims.policyId, policyIds))
      .all(),
    reminders: tx.select().from(reminders).where(eq(reminders.userId, userId)).all(),
  };
}

function rescaleOwnedMoney(tx: DrizzleTransaction, userId: string, from: number, to: number): void {
  const rescaled = rescaleMoneyTables(ownedMoneyRows(tx, userId), from, to);
  for (const [key, table] of Object.entries(OWNED_MONEY_TABLES)) {
    const columns = Object.keys(getTableColumns(table)).filter(
      (name) => MONEY_CENTS_FIELDS.has(name) || name === 'expenseSplitConfig'
    );
    for (const row of rescaled[key] ?? []) {
      const set = Object.fromEntries(columns.map((name) => [name, row[name]]));
      tx.update(table)
        .set(set)
        .where(eq(table.id, String(row.id)))
        .run();
    }
  }
}

export function updatePreferencesWithCurrency(
  db: AppDatabase,
  userId: string,
  updates: Partial<NewUserPreferences> & { currencyUnit: string }
): UserPreferences {
  return db.transaction((tx) => {
    const current = tx
      .select({ currency: userPreferences.currencyUnit })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .get();
    const from = minorUnitScale(current?.currency ?? DEFAULT_CURRENCY);
    const to = minorUnitScale(updates.currencyUnit);
    if (from !== to) rescaleOwnedMoney(tx, userId, from, to);
    const updated = tx
      .update(userPreferences)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(userPreferences.userId, userId))
      .returning()
      .get();
    if (!updated) throw new DatabaseError('User preferences row vanished during a currency change');
    return updated;
  });
}

export class SyncStateRepository {
  constructor(private db: AsyncAppDatabase) {}

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
