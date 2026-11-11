import { and, eq, getTableColumns, inArray } from 'drizzle-orm';
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

/** Narrows an untrusted share level to a value the routes could have written. */
const clampShareLevel = (level: unknown): string => (level === 'editor' ? 'editor' : 'viewer');

class RestoreService {
  private db = getDb();

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Restore orchestration requires sequential validation and data insertion steps
  async restoreFromBackup(
    userId: string,
    file: Buffer,
    mode: 'replace' | 'merge' | 'preview'
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

    const summary: ImportSummary = {
      vehicles: parsedBackup.vehicles.length,
      expenses: parsedBackup.expenses.length,
      financing: parsedBackup.financing.length,
      insurance: parsedBackup.insurance.length,
      insuranceTerms: parsedBackup.insuranceTerms?.length ?? 0,
      insuranceTermVehicles: parsedBackup.insuranceTermVehicles?.length ?? 0,
      insuranceClaims: parsedBackup.insuranceClaims?.length ?? 0,
      reminders: parsedBackup.reminders?.length ?? 0,
      reminderVehicles: parsedBackup.reminderVehicles?.length ?? 0,
      reminderNotifications: parsedBackup.reminderNotifications?.length ?? 0,
      odometer: parsedBackup.odometer?.length ?? 0,
      photos: parsedBackup.photos?.length ?? 0,
      photoRefs: parsedBackup.photoRefs?.length ?? 0,
      userPreferences: parsedBackup.userPreferences?.length ?? 0,
      syncState: parsedBackup.syncState?.length ?? 0,
      trips: parsedBackup.trips?.length ?? 0,
      vehicleShares: parsedBackup.vehicleShares?.length ?? 0,
    };

    if (mode === 'preview') {
      return { success: true, preview: summary };
    }

    if (mode === 'merge') {
      const conflicts = await this.detectConflicts(parsedBackup, userId);
      if (conflicts.length > 0) {
        return { success: false, conflicts };
      }
    }

    this.assertReplaceNotEmpty(summary, mode);

    // Must stay synchronous: bun-sqlite runs this callback inside client.transaction(), which only
    // wraps work that completes synchronously. An async callback autocommits each statement, so a
    // throw mid-insert would leave the wipe committed.
    this.db.transaction((tx) => {
      // Must be read before the wipe, which cascades vehicle_shares.
      const consented = this.consentedShareKeys(tx, userId);
      if (mode === 'replace') {
        this.deleteUserData(tx, userId);
      }
      this.insertBackupData(tx, parsedBackup, userId, consented);
    });

    return { success: true, imported: summary };
  }

  /**
   * Reports unreadable bytes as a client error rather than a 500. A ValidationError, not a SyncError,
   * so the global handler logs it at client-error level.
   */
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

  /**
   * Replace mode deletes all data first, so a backup with zero rows across every table would wipe
   * the account and restore nothing. Preview and merge never delete, so they are not affected.
   */
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

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Restore orchestration requires sequential validation and data insertion steps
  async restoreFromSheets(
    userId: string,
    providerId: string,
    mode: 'replace' | 'merge' | 'preview'
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
    const sheetData = await sheetsService.readSpreadsheetData(sheetsSpreadsheetId);

    // The sheet mirrors the DB, so its money cells are already in cents and need no shim. Sheets
    // carries no real metadata version, so stamp the current one for validation.
    for (const [key, table] of Object.entries(TABLE_SCHEMA_MAP)) {
      const data = sheetData[key as keyof typeof sheetData];
      if (Array.isArray(data)) {
        // biome-ignore lint/suspicious/noExplicitAny: Dynamic key assignment on parsed backup data
        (sheetData as Record<string, any>)[key] = data.map((row: Record<string, unknown>) =>
          coerceRow(row, table)
        );
      }
    }
    sheetData.metadata = { ...sheetData.metadata, version: CONFIG.backup.currentVersion };

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

    const summary: ImportSummary = {
      vehicles: sheetData.vehicles.length,
      expenses: sheetData.expenses.length,
      financing: sheetData.financing.length,
      insurance: sheetData.insurance.length,
      insuranceTerms: sheetData.insuranceTerms?.length ?? 0,
      insuranceTermVehicles: sheetData.insuranceTermVehicles?.length ?? 0,
      insuranceClaims: (sheetData as ParsedBackupData).insuranceClaims?.length ?? 0,
      reminders: (sheetData as ParsedBackupData).reminders?.length ?? 0,
      reminderVehicles: (sheetData as ParsedBackupData).reminderVehicles?.length ?? 0,
      reminderNotifications: (sheetData as ParsedBackupData).reminderNotifications?.length ?? 0,
      odometer: sheetData.odometer?.length ?? 0,
      photos: sheetData.photos?.length ?? 0,
      photoRefs: sheetData.photoRefs?.length ?? 0,
      userPreferences: sheetData.userPreferences?.length ?? 0,
      syncState: sheetData.syncState?.length ?? 0,
      trips: (sheetData as ParsedBackupData).trips?.length ?? 0,
      vehicleShares: (sheetData as ParsedBackupData).vehicleShares?.length ?? 0,
    };

    if (mode === 'preview') {
      return { success: true, preview: summary };
    }

    if (mode === 'merge') {
      const conflicts = await this.detectConflicts(sheetData, userId);
      if (conflicts.length > 0) {
        return { success: false, conflicts };
      }
    }

    this.assertReplaceNotEmpty(summary, mode);

    // Synchronous for the same reason as restoreFromBackup.
    this.db.transaction((tx) => {
      const consented = this.consentedShareKeys(tx, userId);
      if (mode === 'replace') {
        this.deleteUserData(tx, userId);
      }
      this.insertBackupData(tx, sheetData, userId, consented);
    });

    return { success: true, imported: summary };
  }

  private async detectConflicts(data: ParsedBackupData, userId: string): Promise<Conflict[]> {
    const conflicts: Conflict[] = [];

    // Scope every probe to the importer's rows. Unscoped, a merge whose ids collide with another
    // user's rows would return that user's data in localData.
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

    // Every owned table is probed, so an id collision is reported as a conflict instead of a raw
    // UNIQUE error that aborts the restore. idField is the row property matching idColumn.
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
        // Reminders are userId-owned and can exist with no vehicles.
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
      // Keyed by userId; the conflict id is the userId.
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
        // Scoped by ownerId, the same ownership restore re-stamps onto the importer.
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
      // Chunked to stay under SQLite's bind-parameter limit.
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

  // Synchronous so the whole wipe stays inside the caller's transaction.
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

    // Children before vehicles (FK). Chunked to stay under SQLite's bind-parameter limit.
    for (const idBatch of chunk(vehicleIds)) {
      tx.delete(odometerEntries).where(inArray(odometerEntries.vehicleId, idBatch)).run();
      tx.delete(vehicleFinancing).where(inArray(vehicleFinancing.vehicleId, idBatch)).run();
    }

    // Terms, junction rows and claims cascade from policies.
    tx.delete(insurancePolicies).where(eq(insurancePolicies.userId, userId)).run();

    // Cascades to reminder_vehicles and reminder_notifications.
    tx.delete(reminders).where(eq(reminders.userId, userId)).run();

    tx.delete(userPreferences).where(eq(userPreferences.userId, userId)).run();
    tx.delete(syncState).where(eq(syncState.userId, userId)).run();

    tx.delete(vehicles).where(eq(vehicles.userId, userId)).run();
  }

  /**
   * Forces every owned row onto the importer. The backup is untrusted, and this is the single
   * chokepoint preventing cross-tenant writes.
   */
  private stampUserId<T extends Record<string, unknown>>(
    rows: T[] | undefined,
    userId: string
  ): T[] {
    return (rows ?? []).map((row) => ({ ...row, userId }));
  }

  /**
   * Clears createdBy when the named author is not a user on this instance. Users are not backed up,
   * so an absent author would fail the FK and abort the restore.
   */
  private dropUnknownAuthors<T extends Record<string, unknown>>(
    rows: T[],
    knownUserIds: Set<string>
  ): T[] {
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

  /**
   * Batched to stay under SQLite's bind-parameter limit. Synchronous, so every batch shares the
   * caller's transaction.
   */
  private insertRows<TTable extends SQLiteTable>(
    tx: DrizzleTransaction,
    table: TTable,
    rows: Record<string, unknown>[]
  ): void {
    if (rows.length === 0) return;
    const columnCount = Object.keys(getTableColumns(table)).length;
    for (const batch of chunk(rows, rowsPerInsert(columnCount))) {
      // The rows are coerced Record maps — coerceRow walked this very table's columns to build them,
      // which is the only thing that can vouch for their shape; the cast just restates that.
      tx.insert(table)
        .values(batch as unknown as TTable['$inferInsert'][])
        .run();
    }
  }

  // Synchronous, like insertRows, so the whole FK-ordered sequence shares the caller's transaction.
  private insertBackupData(
    tx: DrizzleTransaction,
    data: ParsedBackupData,
    userId: string,
    consentedShares: Set<string>
  ): void {
    // Users are not backed up, so a cross-instance restore may name users absent here.
    const knownUserIds = new Set(
      tx
        .select({ id: users.id })
        .from(users)
        .all()
        .map((u) => u.id)
    );

    this.insertRows(tx, vehicles, this.stampUserId(data.vehicles, userId));
    this.insertRows(tx, vehicleFinancing, data.financing ?? []);
    this.insertRows(tx, insurancePolicies, this.stampUserId(data.insurance, userId));
    // FK order: terms after policies, junction after terms, claims last.
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
    // Grants to invitees absent from this instance are skipped, since their FK would fail.
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
    // After all entity tables, so entityId references resolve.
    this.insertRows(tx, photos, this.stampUserId(data.photos, userId));
    // Refs to providers absent from this instance are dropped, since providers are not backed up.
    const refRows = (data.photoRefs ?? []) as Record<string, unknown>[];
    const knownProviders = this.knownProviderIds(tx, refRows, userId);
    this.insertRows(
      tx,
      photoRefs,
      refRows.filter((ref) => knownProviders.has(String(ref.providerId)))
    );
  }

  /**
   * The (vehicle, invitee) pairs the invitee has accepted, read before the restore writes anything.
   * Share status is another user's consent, so it is re-derived from this snapshot rather than
   * trusted from the backup file. Must run before deleteUserData, which cascades vehicle_shares.
   */
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

  /** Keeps 'accepted' only for pairs the invitee accepted; anything else becomes 'pending'. */
  private resolveShareStatus(share: Record<string, unknown>, consented: Set<string>): string {
    const key = shareConsentKey(String(share.vehicleId), String(share.sharedWithId));
    return consented.has(key) ? 'accepted' : 'pending';
  }

  /**
   * Providers named by refRows that exist here and belong to the importer. Ownership matters: the
   * sync worker resolves a ref's provider by id alone.
   */
  private knownProviderIds(
    tx: DrizzleTransaction,
    refRows: Record<string, unknown>[],
    userId: string
  ): Set<string> {
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
