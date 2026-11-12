import { and, eq, getTableColumns, inArray, type Table } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { CONFIG, TABLE_SCHEMA_MAP } from '../../config';
import type { AppDatabase } from '../../db/connection';
import { getDb } from '../../db/connection';
import {
  expenses,
  insuranceClaims,
  insurancePolicies,
  insuranceTerms,
  insuranceTermVehicles,
  odometerEntries,
  photoRefs,
  photos,
  reminderNotifications,
  reminders,
  reminderVehicles,
  syncState,
  trips,
  userPreferences,
  userProviders,
  users,
  vehicleFinancing,
  vehicleShares,
  vehicles,
} from '../../db/schema';
import { AppError, SyncError, SyncErrorCode, ValidationError } from '../../errors';
import type { BackupConfig, ParsedBackupData } from '../../types';
import { chunk, rowsPerInsert } from '../../utils/chunk';
import { logger } from '../../utils/logger';
import { preferencesRepository } from '../settings/repository';
import { backupService, coerceRow } from './backup';

type DrizzleTransaction = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];

export interface Conflict {
  table: string;
  id: string;
  localData: unknown;
  remoteData: unknown;
}

export interface ImportSummary {
  vehicles: number;
  expenses: number;
  financing: number;
  insurance: number;
  insuranceTerms: number;
  insuranceTermVehicles: number;
  insuranceClaims: number;
  reminders: number;
  reminderVehicles: number;
  reminderNotifications: number;
  odometer: number;
  photos: number;
  photoRefs: number;
  userPreferences: number;
  syncState: number;
  trips: number;
  vehicleShares: number;
}

export interface RestoreResponse {
  success: boolean;
  preview?: ImportSummary;
  imported?: ImportSummary;
  conflicts?: Conflict[];
}

const shareConsentKey = (vehicleId: string, sharedWithId: string): string =>
  `${vehicleId}\u0000${sharedWithId}`;

const clampShareLevel = (level: unknown): string => (level === 'editor' ? 'editor' : 'viewer');

type RestoreMode = 'replace' | 'merge' | 'preview';

function summarizeBackup(data: ParsedBackupData): ImportSummary {
  return {
    vehicles: data.vehicles.length,
    expenses: data.expenses.length,
    financing: data.financing.length,
    insurance: data.insurance.length,
    insuranceTerms: data.insuranceTerms?.length ?? 0,
    insuranceTermVehicles: data.insuranceTermVehicles?.length ?? 0,
    insuranceClaims: data.insuranceClaims?.length ?? 0,
    reminders: data.reminders?.length ?? 0,
    reminderVehicles: data.reminderVehicles?.length ?? 0,
    reminderNotifications: data.reminderNotifications?.length ?? 0,
    odometer: data.odometer?.length ?? 0,
    photos: data.photos?.length ?? 0,
    photoRefs: data.photoRefs?.length ?? 0,
    userPreferences: data.userPreferences?.length ?? 0,
    syncState: data.syncState?.length ?? 0,
    trips: data.trips?.length ?? 0,
    vehicleShares: data.vehicleShares?.length ?? 0,
  };
}

function coerceRows(rows: Record<string, unknown>[], table: Table): Record<string, unknown>[] {
  return rows.map((row) => coerceRow(row, table));
}

class RestoreService {
  private db = getDb();

  async restoreFromBackup(
    userId: string,
    file: Buffer,
    mode: RestoreMode
  ): Promise<RestoreResponse> {
    const parsedBackup = await this.parseOrReject(file);

    const userIdValidation = backupService.validateUserId(parsedBackup.metadata.userId, userId);
    if (!userIdValidation.valid) {
      throw new SyncError(
        SyncErrorCode.VALIDATION_ERROR,
        userIdValidation.errors[0] || 'User ID mismatch'
      );
    }

    const validation = backupService.validateBackupData(parsedBackup);
    if (!validation.valid) {
      throw new SyncError(
        SyncErrorCode.VALIDATION_ERROR,
        'Backup validation failed',
        validation.errors
      );
    }

    return this.applyRestore(userId, parsedBackup, mode);
  }

  private async applyRestore(
    userId: string,
    data: ParsedBackupData,
    mode: RestoreMode
  ): Promise<RestoreResponse> {
    const summary = summarizeBackup(data);

    if (mode === 'preview') {
      return { success: true, preview: summary };
    }

    if (mode === 'merge') {
      const conflicts = await this.detectConflicts(data, userId);
      if (conflicts.length > 0) {
        return { success: false, conflicts };
      }
    }

    this.assertReplaceNotEmpty(summary, mode);

    // bun:sqlite transactions must be synchronous: an async callback autocommits each statement.
    this.db.transaction((tx) => {
      // Read before the wipe: deleteUserData cascades vehicle_shares.
      const consented = this.consentedShareKeys(tx, userId);
      if (mode === 'replace') {
        this.deleteUserData(tx, userId);
      }
      this.insertBackupData(tx, data, userId, consented);
    });

    return { success: true, imported: summary };
  }

  private async parseOrReject(file: Buffer): Promise<ParsedBackupData> {
    try {
      return await backupService.parseZipBackup(file);
    } catch (error) {
      if (error instanceof AppError || error instanceof SyncError) throw error;
      throw new ValidationError(
        'That file is not a readable VROOM backup ZIP — it may be the wrong file, truncated, or edited into a shape the parser cannot read.',
        { parserMessage: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  private assertReplaceNotEmpty(
    summary: ImportSummary,
    mode: 'replace' | 'merge' | 'preview'
  ): void {
    if (mode !== 'replace') return;
    const totalRows = Object.values(summary).reduce((sum, n) => sum + n, 0);
    if (totalRows === 0) {
      throw new SyncError(
        SyncErrorCode.VALIDATION_ERROR,
        'Refusing to replace all data with an empty backup (0 rows): this would delete everything and restore nothing. The backup is likely truncated or corrupt.'
      );
    }
  }

  async restoreFromSheets(
    userId: string,
    providerId: string,
    mode: RestoreMode
  ): Promise<RestoreResponse> {
    const prefs = await preferencesRepository.getOrCreate(userId);
    const backupConfig = prefs?.backupConfig as BackupConfig | null;
    const providerConfig = backupConfig?.providers?.[providerId];
    const sheetsSpreadsheetId = providerConfig?.sheetsSpreadsheetId;

    if (!sheetsSpreadsheetId) {
      throw new SyncError(
        SyncErrorCode.VALIDATION_ERROR,
        'No Google Sheets spreadsheet found for this provider'
      );
    }

    const { createSheetsServiceForProvider } = await import(
      '../providers/services/google-sheets-service'
    );
    const sheetsService = await createSheetsServiceForProvider(providerId, userId);
    const sheet = await sheetsService.readSpreadsheetData(sheetsSpreadsheetId);

    const sheetData: ParsedBackupData = {
      ...sheet,
      metadata: { ...sheet.metadata, version: CONFIG.backup.currentVersion },
      vehicles: coerceRows(sheet.vehicles, TABLE_SCHEMA_MAP.vehicles),
      expenses: coerceRows(sheet.expenses, TABLE_SCHEMA_MAP.expenses),
      financing: coerceRows(sheet.financing, TABLE_SCHEMA_MAP.financing),
      insurance: coerceRows(sheet.insurance, TABLE_SCHEMA_MAP.insurance),
      insuranceTerms: coerceRows(sheet.insuranceTerms, TABLE_SCHEMA_MAP.insuranceTerms),
      insuranceTermVehicles: coerceRows(
        sheet.insuranceTermVehicles,
        TABLE_SCHEMA_MAP.insuranceTermVehicles
      ),
      insuranceClaims: coerceRows(sheet.insuranceClaims, TABLE_SCHEMA_MAP.insuranceClaims),
      photos: coerceRows(sheet.photos, TABLE_SCHEMA_MAP.photos),
      odometer: coerceRows(sheet.odometer, TABLE_SCHEMA_MAP.odometer),
      photoRefs: coerceRows(sheet.photoRefs, TABLE_SCHEMA_MAP.photoRefs),
      userPreferences: coerceRows(sheet.userPreferences, TABLE_SCHEMA_MAP.userPreferences),
      syncState: coerceRows(sheet.syncState, TABLE_SCHEMA_MAP.syncState),
      reminders: coerceRows(sheet.reminders, TABLE_SCHEMA_MAP.reminders),
      reminderVehicles: coerceRows(sheet.reminderVehicles, TABLE_SCHEMA_MAP.reminderVehicles),
      reminderNotifications: coerceRows(
        sheet.reminderNotifications,
        TABLE_SCHEMA_MAP.reminderNotifications
      ),
      trips: coerceRows(sheet.trips, TABLE_SCHEMA_MAP.trips),
      vehicleShares: coerceRows(sheet.vehicleShares, TABLE_SCHEMA_MAP.vehicleShares),
    };

    if (sheetData.metadata.userId !== userId) {
      throw new SyncError(SyncErrorCode.VALIDATION_ERROR, 'Spreadsheet belongs to different user');
    }

    const validation = backupService.validateBackupData(sheetData);
    if (!validation.valid) {
      throw new SyncError(
        SyncErrorCode.VALIDATION_ERROR,
        'Sheet data validation failed',
        validation.errors
      );
    }

    return this.applyRestore(userId, sheetData, mode);
  }

  private async detectConflicts(data: ParsedBackupData, userId: string): Promise<Conflict[]> {
    const conflicts: Conflict[] = [];

    const userVehicleRows = await this.db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(eq(vehicles.userId, userId));
    const userVehicleIds = userVehicleRows.map((v) => v.id);
    const userPhotoRows = await this.db
      .select({ id: photos.id })
      .from(photos)
      .where(eq(photos.userId, userId));
    const userPhotoIds = userPhotoRows.map((p) => p.id);

    // Scoped to the importer: an unscoped probe on an id collision would leak another user's row.
    const tables = [
      {
        data: data.vehicles,
        table: vehicles,
        name: 'vehicles',
        scope: eq(vehicles.userId, userId),
        idColumn: vehicles.id,
        idField: 'id' as const,
      },
      {
        data: data.expenses,
        table: expenses,
        name: 'expenses',
        scope: eq(expenses.userId, userId),
        idColumn: expenses.id,
        idField: 'id' as const,
      },
      {
        data: data.financing,
        table: vehicleFinancing,
        name: 'vehicle_financing',
        scope: inArray(vehicleFinancing.vehicleId, userVehicleIds),
        idColumn: vehicleFinancing.id,
        idField: 'id' as const,
      },
      {
        data: data.insurance,
        table: insurancePolicies,
        name: 'insurance_policies',
        scope: eq(insurancePolicies.userId, userId),
        idColumn: insurancePolicies.id,
        idField: 'id' as const,
      },
      {
        data: data.reminders ?? [],
        table: reminders,
        name: 'reminders',
        scope: eq(reminders.userId, userId),
        idColumn: reminders.id,
        idField: 'id' as const,
      },
      {
        data: data.photos ?? [],
        table: photos,
        name: 'photos',
        scope: eq(photos.userId, userId),
        idColumn: photos.id,
        idField: 'id' as const,
      },
      {
        data: data.photoRefs ?? [],
        table: photoRefs,
        name: 'photo_refs',
        scope: inArray(photoRefs.photoId, userPhotoIds),
        idColumn: photoRefs.id,
        idField: 'id' as const,
      },
      {
        data: (data.userPreferences ?? []).map((r) => ({ ...r, id: String(r.userId) })),
        table: userPreferences,
        name: 'user_preferences',
        scope: eq(userPreferences.userId, userId),
        idColumn: userPreferences.userId,
        idField: 'userId' as const,
      },
      {
        data: (data.syncState ?? []).map((r) => ({ ...r, id: String(r.userId) })),
        table: syncState,
        name: 'sync_state',
        scope: eq(syncState.userId, userId),
        idColumn: syncState.userId,
        idField: 'userId' as const,
      },
      {
        data: data.trips ?? [],
        table: trips,
        name: 'trips',
        scope: eq(trips.userId, userId),
        idColumn: trips.id,
        idField: 'id' as const,
      },
      {
        data: data.vehicleShares ?? [],
        table: vehicleShares,
        name: 'vehicle_shares',
        scope: eq(vehicleShares.ownerId, userId),
        idColumn: vehicleShares.id,
        idField: 'id' as const,
      },
    ];

    for (const { data: items, table, name, scope, idColumn, idField } of tables) {
      if (items.length === 0) continue;
      const idOf = (row: Record<string, unknown>): string => String(row[idField]);
      const existing: Record<string, unknown>[] = [];
      for (const idBatch of chunk(items.map((item) => String(item.id)))) {
        const rows = await this.db
          .select()
          .from(table)
          .where(and(inArray(idColumn, idBatch), scope));
        existing.push(...(rows as Record<string, unknown>[]));
      }
      conflicts.push(
        ...existing.map((e) => {
          const eid = idOf(e);
          return {
            table: name,
            id: eid,
            localData: e,
            remoteData: items.find((item) => String(item.id) === eid),
          };
        })
      );
    }

    return conflicts;
  }

  private deleteUserData(tx: DrizzleTransaction, userId: string): void {
    const userVehicles = tx
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(eq(vehicles.userId, userId))
      .all();
    const vehicleIds = userVehicles.map((v) => v.id);

    tx.delete(photos).where(eq(photos.userId, userId)).run();
    tx.delete(expenses).where(eq(expenses.userId, userId)).run();
    tx.delete(trips).where(eq(trips.userId, userId)).run();

    for (const idBatch of chunk(vehicleIds)) {
      tx.delete(odometerEntries).where(inArray(odometerEntries.vehicleId, idBatch)).run();
      tx.delete(vehicleFinancing).where(inArray(vehicleFinancing.vehicleId, idBatch)).run();
    }

    tx.delete(insurancePolicies).where(eq(insurancePolicies.userId, userId)).run();

    tx.delete(reminders).where(eq(reminders.userId, userId)).run();

    tx.delete(userPreferences).where(eq(userPreferences.userId, userId)).run();
    tx.delete(syncState).where(eq(syncState.userId, userId)).run();

    tx.delete(vehicles).where(eq(vehicles.userId, userId)).run();
  }

  // Backup files are untrusted; this is the chokepoint against cross-tenant writes.
  private stampUserId<T extends Record<string, unknown>>(
    rows: T[] | undefined,
    userId: string
  ): T[] {
    return (rows ?? []).map((row) => ({ ...row, userId }));
  }

  private dropUnknownAuthors<T extends Record<string, unknown>>(
    rows: T[],
    knownUserIds: Set<string>
  ): T[] {
    // Users are not backed up, so an absent author would fail the createdBy foreign key.
    const isAbsent = (row: T): boolean =>
      row.createdBy != null && !knownUserIds.has(String(row.createdBy));
    const absentCount = rows.filter(isAbsent).length;
    if (absentCount > 0) {
      logger.warn('Restore cleared expense authorship naming users absent on this instance', {
        rows: absentCount,
      });
    }
    return rows.map((row) => (isAbsent(row) ? { ...row, createdBy: null } : row));
  }

  private insertRows<TTable extends SQLiteTable>(
    tx: DrizzleTransaction,
    table: TTable,
    rows: Record<string, unknown>[]
  ): void {
    if (rows.length === 0) return;
    const columnCount = Object.keys(getTableColumns(table)).length;
    for (const batch of chunk(rows, rowsPerInsert(columnCount))) {
      tx.insert(table)
        .values(batch as unknown as TTable['$inferInsert'][])
        .run();
    }
  }

  private insertBackupData(
    tx: DrizzleTransaction,
    data: ParsedBackupData,
    userId: string,
    consentedShares: Set<string>
  ): void {
    const knownUserIds = new Set(
      tx
        .select({ id: users.id })
        .from(users)
        .all()
        .map((u) => u.id)
    );

    // SQLite checks foreign keys on insert, so parents must be inserted before children.
    this.insertRows(tx, vehicles, this.stampUserId(data.vehicles, userId));
    this.insertRows(tx, vehicleFinancing, data.financing ?? []);
    this.insertRows(tx, insurancePolicies, this.stampUserId(data.insurance, userId));
    this.insertRows(tx, insuranceTerms, data.insuranceTerms ?? []);
    this.insertRows(tx, insuranceTermVehicles, data.insuranceTermVehicles ?? []);
    this.insertRows(tx, insuranceClaims, data.insuranceClaims ?? []);
    this.insertRows(tx, reminders, this.stampUserId(data.reminders, userId));
    this.insertRows(tx, reminderVehicles, data.reminderVehicles ?? []);
    this.insertRows(
      tx,
      reminderNotifications,
      this.stampUserId(data.reminderNotifications, userId)
    );
    this.insertRows(
      tx,
      expenses,
      this.dropUnknownAuthors(this.stampUserId(data.expenses, userId), knownUserIds)
    );
    this.insertRows(tx, odometerEntries, this.stampUserId(data.odometer, userId));
    this.insertRows(tx, trips, this.stampUserId(data.trips, userId));
    this.insertRows(
      tx,
      vehicleShares,
      (data.vehicleShares ?? [])
        .filter((share) => knownUserIds.has(String(share.sharedWithId)))
        .map((share) => ({
          ...share,
          ownerId: userId,
          level: clampShareLevel(share.level),
          status: this.resolveShareStatus(share, consentedShares),
        }))
    );
    this.insertRows(tx, userPreferences, this.stampUserId(data.userPreferences, userId));
    this.insertRows(tx, syncState, this.stampUserId(data.syncState, userId));
    this.insertRows(tx, photos, this.stampUserId(data.photos, userId));
    const refRows = (data.photoRefs ?? []) as Record<string, unknown>[];
    const knownProviders = this.knownProviderIds(tx, refRows, userId);
    this.insertRows(
      tx,
      photoRefs,
      refRows.filter((ref) => knownProviders.has(String(ref.providerId)))
    );
  }

  private consentedShareKeys(tx: DrizzleTransaction, userId: string): Set<string> {
    return new Set(
      tx
        .select({ vehicleId: vehicleShares.vehicleId, sharedWithId: vehicleShares.sharedWithId })
        .from(vehicleShares)
        .where(and(eq(vehicleShares.ownerId, userId), eq(vehicleShares.status, 'accepted')))
        .all()
        .map((row) => shareConsentKey(row.vehicleId, row.sharedWithId))
    );
  }

  private resolveShareStatus(share: Record<string, unknown>, consented: Set<string>): string {
    const key = shareConsentKey(String(share.vehicleId), String(share.sharedWithId));
    return consented.has(key) ? 'accepted' : 'pending';
  }

  private knownProviderIds(
    tx: DrizzleTransaction,
    refRows: Record<string, unknown>[],
    userId: string
  ): Set<string> {
    // Ownership matters: the sync worker resolves a ref's provider by id alone.
    const providerIds = [...new Set(refRows.map((ref) => String(ref.providerId)))];
    const known = new Set<string>();
    for (const batch of chunk(providerIds)) {
      for (const row of tx
        .select({ id: userProviders.id })
        .from(userProviders)
        .where(and(inArray(userProviders.id, batch), eq(userProviders.userId, userId)))
        .all()) {
        known.add(row.id);
      }
    }
    return known;
  }
}

export const restoreService = new RestoreService();
