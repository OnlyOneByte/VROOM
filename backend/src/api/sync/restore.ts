/**
 * Restore Service - Handles data restoration from backups and Google Sheets
 */

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

/** NUL-joined composite key for a (vehicle, invitee) share pair — unambiguous for any id text. */
const shareConsentKey = (vehicleId: string, sharedWithId: string): string =>
  `${vehicleId}\u0000${sharedWithId}`;

/**
 * `vehicle_shares.level` is a plain text column whose allowed values are enforced only by the Zod
 * enum on the share routes, so a hand-edited backup can carry anything. Access resolution already
 * fails closed (only the exact string `editor` grants write), so an unknown level reads as a viewer
 * either way — restore narrows it to the real literal so the column cannot hold a value no route
 * could ever have written.
 */
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

    // SYNCHRONOUS transaction: bun-sqlite's dialect is sync — drizzle runs the callback inside
    // bun's `client.transaction(() => …)`, which only wraps work that completes SYNCHRONOUSLY. An ASYNC
    // callback returns a pending promise immediately, so BEGIN/COMMIT close around nothing and each
    // `await tx.delete/insert` then runs as its OWN autocommit statement — the footgun. On the
    // replace path that means a throw mid-insert (FK/IO/anything past the pre-validate) leaves the
    // wipe already committed and the account WIPED (total data loss). Running the
    // wipe+insert SYNCHRONOUSLY (.run()/.all() inline) keeps them in ONE real transaction, so a thrown
    // insert rolls the delete back. Keep this callback non-async + the helpers fully synchronous.
    this.db.transaction((tx) => {
      // Read the invitee-consented grants BEFORE the wipe, which cascades vehicle_shares away with
      // the vehicles (see consentedShareKeys).
      const consented = this.consentedShareKeys(tx, userId);
      if (mode === 'replace') {
        this.deleteUserData(tx, userId);
      }
      this.insertBackupData(tx, parsedBackup, userId, consented);
    });

    return { success: true, imported: summary };
  }

  /**
   * Parse the uploaded bytes, reporting bytes that are not a readable backup as the CLIENT error they
   * are. Every other refusal on this endpoint is a clean 400 naming what is wrong; an unwrapped
   * AdmZip or csv-parse throw instead reached the global handler as 500 "An internal error occurred",
   * which tells the user the server broke and tells a self-hosted operator's monitoring that a server
   * fault occurred — for the single likeliest restore mistake, picking the wrong file in the dialog.
   * parseZipBackup's own refusals (zip-bomb ratio, oversize, missing member file) already carry an
   * actionable 400 message, so they pass straight through; the parser's own message is attached as
   * details because it names the offending CSV line. ValidationError rather than SyncError so the
   * global handler also LOGS it as the client error it is — a SyncError is logged at error level as
   * "Server error", which is the half of this that misleads an operator watching the logs.
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
   * Guard against a silent TOTAL wipe (: no silent loss). Replace-mode deletes ALL of
   * the user's data, then inserts the backup. `validateBackupData` only checks metadata + per-row
   * schema + referential integrity, so an empty-but-valid backup (every data array empty — a
   * truncated/corrupt download) passes clean, and a replace restore would delete everything and
   * insert nothing, atomically committing the empty state. Reject a replace whose payload carries
   * ZERO rows across all tables; preview (read-only) and merge (never deletes) are unaffected. There
   * is no legitimate "replace all my data with nothing" restore — clearing data is a separate,
   * explicit operation. (A partial-shrink guard — rejecting a backup implausibly smaller than the
   * current data — is a separate product decision, filed as bug's threshold half.)
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
    // Load backupConfig and read sheetsSpreadsheetId for this provider
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

    // money-cents-migration data-safety: the Google Sheet is a LIVE mirror of the DB — every backup
    // overwrites it from raw db.select() rows, so its money cells ALWAYS reflect the CURRENT schema
    // (integer cents post-0009). The Sheets format persists NO metadata version (readSpreadsheetData
    // hardcodes a placeholder), so the version-gated ×100 shim used on the versioned ZIP path is BOTH
    // unnecessary AND unsafe here: gating on the placeholder always fired → a current cents sheet got
    // ×100'd to a 100× OVER-value on every restore. Coerce WITHOUT the shim —
    // the sheet is cents-native, identical to the DB — and stamp the in-memory metadata to the current
    // version so validateBackupData (which fail-closes on a version mismatch) accepts it.
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

    // SYNCHRONOUS transaction — see restoreFromBackup for the full rationale. The Sheets path
    // shares the identical wipe+insert structure and the identical async-tx footgun, so it gets
    // the identical synchronous treatment: wipe+insert run inline in ONE real transaction that rolls
    // back atomically if any insert throws.
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

    // Tenant-scope every conflict probe: a conflict is only a conflict against THE IMPORTER'S OWN
    // rows. Without this, a merge-mode restore whose ids collide with another user's rows would
    // return that user's full row contents in `localData` — a cross-tenant read leak (same
    // class as the restore write-stamp). vehicles/expenses/insurancePolicies/photos own via a
    // userId column; vehicleFinancing/photoRefs own indirectly via a FK to an owned parent, so scope
    // those by the importer's owned vehicle/photo ids (fetched once below).
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

    // Each probe declares the column its rows key on (`idColumn`) and the row field that column maps to
    // (`idField`) — `id` for most tables, `userId` for the userId-PK'd userPreferences/syncState. Stating
    // both on every entry keeps the array homogeneous (no `table.id` access on a table that lacks it).
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
        // Owns via vehicleId → an empty owned-vehicle set must match nothing (inArray([]) is false).
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
        // reminders is userId-owned with its OWN id PK (NOT FK'd to vehicles — the vehicle link is the
        // reminder_vehicles junction, onDelete:cascade). So a reminder SURVIVES the deletion of all its
        // vehicles (the vehicle-less-but-active state). Without probing it, a merge restore of a
        // backup carrying that surviving reminder slipped past conflict detection into insert(reminders)
        // against the existing id PK → a raw UNIQUE-constraint throw that aborted the WHOLE restore — the
        // class on a third table that fix never reached. Probe it like any owned id-PK table.
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
        // Owns via photoId → scope to the importer's photos.
        scope: inArray(photoRefs.photoId, userPhotoIds),
        idColumn: photoRefs.id,
        idField: 'id' as const,
      },
      // userPreferences + syncState are PK'd by userId, and the importer ALWAYS has both (the app /
      // getOrCreate create a prefs row on first use), while a backup ALWAYS carries the creator's prefs
      // row. Without probing them, a merge restore whose other tables don't collide slipped past conflict
      // detection straight into insert(userPreferences) against the existing PK → a raw UNIQUE-constraint
      // throw that rolled back the WHOLE restore. Probe them like any other owned table so the
      // collision is reported as a normal conflict; the conflict id is the userId (their PK).
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
        // trips is userId-owned with its OWN id PK (the vehicle link is an FK, cascade-on-delete). Same
        // profile as reminders/expenses — probe it directly so a merge-restore id collision is reported as
        // a clean conflict, not a raw UNIQUE-PK throw that aborts the whole restore.
        data: data.trips ?? [],
        table: trips,
        name: 'trips',
        scope: eq(trips.userId, userId),
        idColumn: trips.id,
        idField: 'id' as const,
      },
      {
        // vehicle_shares is owner-owned (ownerId) with its OWN id PK. Probe it directly so a merge-restore
        // id collision is a clean conflict, not a raw UNIQUE-PK throw. Scoped by ownerId
        // (the importer is the owner — restore re-stamps ownerId to userId, matching this scope).
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
      // The id list comes from the backup, so it is unbounded — chunk the IN-clause per the contract in
      // utils/chunk, or a large backup's probe would blow SQLite's bind-parameter ceiling and merge mode
      // would fail for exactly the accounts most in need of a careful restore.
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

  // SYNCHRONOUS: `.all()` / `.run()` execute inline on the bun-sqlite sync dialect so the whole
  // wipe runs inside the caller's real transaction (no `await` → no autocommit split, no footgun).
  private deleteUserData(tx: DrizzleTransaction, userId: string): void {
    // Collect vehicle IDs for related entity cleanup
    const userVehicles = tx
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(eq(vehicles.userId, userId))
      .all();
    const vehicleIds = userVehicles.map((v) => v.id);

    // Delete photos directly by userId (photos now have user_id column)
    tx.delete(photos).where(eq(photos.userId, userId)).run();

    // Delete expenses directly by userId
    tx.delete(expenses).where(eq(expenses.userId, userId)).run();

    // Delete trips directly by userId (trips carry a user_id column; this also removes them before
    // their vehicle FK would cascade — same direct-by-userId pattern as photos/expenses).
    tx.delete(trips).where(eq(trips.userId, userId)).run();

    // Delete odometer entries before vehicles (FK constraint). Chunked per the IN-clause contract in
    // utils/chunk: the id list is as long as the user's fleet.
    for (const idBatch of chunk(vehicleIds)) {
      tx.delete(odometerEntries).where(inArray(odometerEntries.vehicleId, idBatch)).run();
      tx.delete(vehicleFinancing).where(inArray(vehicleFinancing.vehicleId, idBatch)).run();
    }

    // Delete insurance policies directly by userId (terms, junction rows, and
    // claims all cascade via FK — claims.policy_id is ON DELETE cascade)
    tx.delete(insurancePolicies).where(eq(insurancePolicies.userId, userId)).run();

    // Delete reminders before vehicles (CASCADE handles reminder_vehicles + reminder_notifications)
    tx.delete(reminders).where(eq(reminders.userId, userId)).run();

    // Delete user preferences and sync state
    tx.delete(userPreferences).where(eq(userPreferences.userId, userId)).run();
    tx.delete(syncState).where(eq(syncState.userId, userId)).run();

    tx.delete(vehicles).where(eq(vehicles.userId, userId)).run();
  }

  /**
   * Force `userId` to the importing user on every owned row. The backup file is
   * untrusted input: only metadata.userId is checked against the importer, and
   * referential-integrity validation never covered the root tables (vehicles,
   * insurance, photos, preferences, syncState). Without this, a crafted backup
   * (metadata.userId = me, but vehicles[].userId = someone-else) would insert
   * rows owned by another user. Stamping here is a no-op for legitimate backups
   * (createBackup only ever emits rows owned by the creator = importer) and is
   * the single chokepoint that holds regardless of which validators run.
   */
  private stampUserId<T extends Record<string, unknown>>(
    rows: T[] | undefined,
    userId: string
  ): T[] {
    return (rows ?? []).map((row) => ({ ...row, userId }));
  }

  /**
   * Null out `createdBy` on any row whose named author is not a user on THIS instance. `createdBy` is
   * PROVENANCE — who physically entered a shared-fleet row — and it FKs users, but identity is
   * deliberately excluded from a backup, so a restore onto a different instance legitimately names an
   * author who does not exist here. Inserting that id FK-violates and aborts the WHOLE restore, the one
   * thing the recovery path must never do; NULL is the column's own documented legacy/self sentinel, so
   * the cost row and its ownership survive intact and only the authorship is lost. Same absence-only
   * filter the vehicle_shares invitee and the photo_ref provider already get: a known author is never
   * touched.
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
   * Insert every row of one table, batched so no single statement approaches SQLite's host-parameter
   * ceiling. A multi-row INSERT binds one parameter per column per row, so one `.values(allRows)` call
   * breaks past `floor(SQLITE_MAX_BIND_PARAMS / columns)` rows — 2,978 expenses, 2,621 reminders — which
   * a decade-long account reaches, and the driver reports the count mod 65536 so the failure names
   * neither the table nor a real number. Batching bounds the count at `rowsPerInsert(columns) × columns`
   * however large the backup is.
   *
   * SYNCHRONOUS (`.run()` inline, no await): the batches stay inside the caller's one real transaction,
   * so the wipe and ALL batches still commit or roll back as a unit (see restoreFromBackup).
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

  // SYNCHRONOUS: every insert is `.run()` and the lookups are `.all()` so the entire FK-ordered insert
  // sequence executes inline within the caller's real transaction. With the old `await`, drizzle's
  // bun-sqlite (sync dialect) had already committed the BEGIN before the first await resolved, so each
  // insert autocommitted alone and a later throw could not undo the wipe (the data-loss footgun). Running
  // sync keeps wipe+insert atomic — a thrown insert rolls the whole restore back.
  private insertBackupData(
    tx: DrizzleTransaction,
    data: ParsedBackupData,
    userId: string,
    consentedShares: Set<string>
  ): void {
    // Data is already coerced by coerceRow (ZIP path via parseZipBackup, Sheets path via
    // restoreFromSheets). Every insert goes through insertRows, which batches to stay under SQLite's
    // bind-parameter ceiling and no-ops on an empty array.

    // The users THIS instance knows, read once for the two absence filters below (the expense author and
    // the share invitee). Users are deliberately not part of a backup, so a cross-instance restore
    // legitimately names users who do not exist here.
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
    // Insurance terms after policies (FK), the junction after terms, claims after all three (policy FK
    // plus the optional set-null term_id / vehicle_id FKs).
    this.insertRows(tx, insuranceTerms, data.insuranceTerms ?? []);
    this.insertRows(tx, insuranceTermVehicles, data.insuranceTermVehicles ?? []);
    this.insertRows(tx, insuranceClaims, data.insuranceClaims ?? []);
    // Reminders after vehicles (userId + vehicleId FKs), then the junction, then the notifications.
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
    // Trips AFTER vehicles (trips.vehicle_id FK) — userId-stamped like odometer/expenses.
    this.insertRows(tx, trips, this.stampUserId(data.trips, userId));
    // vehicle_shares AFTER vehicles. Re-stamp ownerId to the importer (the backup's owner IS the
    // importer; same chokepoint as stampUserId). The sharedWithId (invitee) FKs users, who are absent
    // from the backup, so on a cross-instance restore the grant would FK-violate and abort everything —
    // skip a grant whose invitee is unknown here (the owner can re-invite once that user joins). A
    // same-instance restore (the common case) keeps every grant.
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
    // Photos AFTER all entity tables so their entityId references are valid.
    this.insertRows(tx, photos, this.stampUserId(data.photos, userId));
    // photo_refs AFTER photos (photo_id FK). Drop refs naming a provider absent from user_providers:
    // providers hold encrypted credentials and are NOT backed up, so a restored ref may point at a
    // provider that does not exist on this instance.
    const refRows = (data.photoRefs ?? []) as Record<string, unknown>[];
    const knownProviders = this.knownProviderIds(tx, refRows, userId);
    this.insertRows(
      tx,
      photoRefs,
      refRows.filter((ref) => knownProviders.has(String(ref.providerId)))
    );
  }

  /**
   * The (vehicle, invitee) pairs whose invitee has ACTUALLY accepted a grant from this owner, read
   * before the restore writes anything.
   *
   * A backup file is untrusted input, and `status` is the one field on a restorable row that encodes
   * ANOTHER user's decision: `accepted` is only reachable through the invitee's own accept call, which
   * is the consent boundary for the single deliberate cross-user widening in the app. Taking it
   * verbatim from the ZIP let an importer mint an accepted grant on a stranger, and re-mint one the
   * stranger had explicitly declined. Restore therefore re-derives it (see resolveShareStatus) from
   * what the DB says the invitee agreed to, and this snapshot is that evidence.
   *
   * It MUST be read before `deleteUserData`: vehicle_shares.vehicle_id cascades on vehicle delete, so
   * after the replace-mode wipe the table holds none of the owner's grants and every genuine accepted
   * share would come back pending — sharees silently losing access on an ordinary restore.
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

  /**
   * A restored grant keeps `accepted` only where the invitee is on record as having accepted THIS
   * (vehicle, invitee) pair; anything else lands `pending`, so the invitee decides. Pending is the
   * state a fresh invite starts in and the owner loses nothing by it — an invite to any address is
   * already a normal feature — while the invitee keeps the accept/decline they are entitled to.
   */
  private resolveShareStatus(share: Record<string, unknown>, consented: Set<string>): string {
    const key = shareConsentKey(String(share.vehicleId), String(share.sharedWithId));
    return consented.has(key) ? 'accepted' : 'pending';
  }

  /**
   * Which of the providers named by `refRows` exist on this instance AND belong to the importer. The
   * ownership predicate matters because a ref naming someone ELSE's provider id would otherwise be
   * accepted, after which the sync worker — which resolves a ref's provider by id alone, with no
   * ownership check — would upload the importer's photo bytes into a stranger's storage account. The
   * id list comes from the backup, so it is unbounded: chunked per the IN-clause contract in
   * utils/chunk.
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
