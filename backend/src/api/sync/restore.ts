/**
 * Restore Service - Handles data restoration from backups and Google Sheets
 */

import { and, eq, inArray } from 'drizzle-orm';
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
  vehicleFinancing,
  vehicles,
} from '../../db/schema';
import { SyncError, SyncErrorCode } from '../../errors';
import type { BackupConfig, ParsedBackupData } from '../../types';
import { preferencesRepository } from '../settings/repository';
import { backupService, coerceRow, isPreCentsBackup } from './backup';

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
}

export interface RestoreResponse {
  success: boolean;
  preview?: ImportSummary;
  imported?: ImportSummary;
  conflicts?: Conflict[];
}

class RestoreService {
  private db = getDb();

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Restore orchestration requires sequential validation and data insertion steps
  async restoreFromBackup(
    userId: string,
    file: Buffer,
    mode: 'replace' | 'merge' | 'preview'
  ): Promise<RestoreResponse> {
    const parsedBackup = await backupService.parseZipBackup(file);

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

    await this.db.transaction(async (tx) => {
      if (mode === 'replace') {
        await this.deleteUserData(tx, userId);
      }
      await this.insertBackupData(tx, parsedBackup, userId);
    });

    return { success: true, imported: summary };
  }

  /**
   * Guard against a silent TOTAL wipe (NORTH_STAR #1: no silent loss). Replace-mode deletes ALL of
   * the user's data, then inserts the backup. `validateBackupData` only checks metadata + per-row
   * schema + referential integrity, so an empty-but-valid backup (every data array empty — a
   * truncated/corrupt download) passes clean, and a replace restore would delete everything and
   * insert nothing, atomically committing the empty state. Reject a replace whose payload carries
   * ZERO rows across all tables; preview (read-only) and merge (never deletes) are unaffected. There
   * is no legitimate "replace all my data with nothing" restore — clearing data is a separate,
   * explicit operation. (A partial-shrink guard — rejecting a backup implausibly smaller than the
   * current data — is a separate product decision, filed as bug #21's threshold half.)
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

    // A pre-cents (version < 2.0.0) Sheets backup stored money as DOLLAR floats; under the post-0009
    // integer-cents schema they must be ×100-shimmed during coercion or coerceRow's integer branch
    // 100×-undercounts them (design §4, NORTH_STAR #1 — the same fail-closed-default + recovery-shim
    // contract as the ZIP path in backup.parseZipBackup).
    const shimMoneyToCents = isPreCentsBackup(sheetData.metadata?.version);

    // Coerce Sheets data using schema-aware column types
    for (const [key, table] of Object.entries(TABLE_SCHEMA_MAP)) {
      const data = sheetData[key as keyof typeof sheetData];
      if (Array.isArray(data)) {
        // biome-ignore lint/suspicious/noExplicitAny: Dynamic key assignment on parsed backup data
        (sheetData as Record<string, any>)[key] = data.map((row: Record<string, unknown>) =>
          coerceRow(row, table, { shimMoneyToCents })
        );
      }
    }

    // After a successful shim the in-memory data IS the cents (2.0.0) format → upgrade the version so
    // validateBackupData (fail-closes on a version mismatch) accepts the recovered backup. A version we
    // cannot shim leaves it untouched → fail-closed.
    if (shimMoneyToCents) {
      sheetData.metadata = { ...sheetData.metadata, version: CONFIG.backup.currentVersion };
    }

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

    await this.db.transaction(async (tx) => {
      if (mode === 'replace') {
        await this.deleteUserData(tx, userId);
      }
      await this.insertBackupData(tx, sheetData, userId);
    });

    return { success: true, imported: summary };
  }

  private async detectConflicts(data: ParsedBackupData, userId: string): Promise<Conflict[]> {
    const conflicts: Conflict[] = [];

    // Tenant-scope every conflict probe: a conflict is only a conflict against THE IMPORTER'S OWN
    // rows. Without this, a merge-mode restore whose ids collide with another user's rows would
    // return that user's full row contents in `localData` — a cross-tenant read leak (C109, same
    // class as the C145 restore write-stamp). vehicles/expenses/insurancePolicies/photos own via a
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
        // vehicles (the #97 vehicle-less-but-active state). Without probing it, a merge restore of a
        // backup carrying that surviving reminder slipped past conflict detection into insert(reminders)
        // against the existing id PK → a raw UNIQUE-constraint throw that aborted the WHOLE restore — the
        // #93/C300 class on a third table that fix never reached. Probe it like any owned id-PK table.
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
      // throw that rolled back the WHOLE restore (#93, C300). Probe them like any other owned table so the
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
        // a clean conflict, not a raw UNIQUE-PK throw that aborts the whole restore (#93/C300 class).
        data: data.trips ?? [],
        table: trips,
        name: 'trips',
        scope: eq(trips.userId, userId),
        idColumn: trips.id,
        idField: 'id' as const,
      },
    ];

    for (const { data: items, table, name, scope, idColumn, idField } of tables) {
      if (items.length === 0) continue;
      const idOf = (row: Record<string, unknown>): string => String(row[idField]);
      const ids = items.map((item) => String(item.id));
      const existing = await this.db
        .select()
        .from(table)
        .where(and(inArray(idColumn, ids), scope));
      conflicts.push(
        ...existing.map((e) => {
          const eid = idOf(e as Record<string, unknown>);
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

  private async deleteUserData(tx: DrizzleTransaction, userId: string): Promise<void> {
    // Collect vehicle IDs for related entity cleanup
    const userVehicles = await tx
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(eq(vehicles.userId, userId));
    const vehicleIds = userVehicles.map((v) => v.id);

    // Delete photos directly by userId (photos now have user_id column)
    await tx.delete(photos).where(eq(photos.userId, userId));

    // Delete expenses directly by userId
    await tx.delete(expenses).where(eq(expenses.userId, userId));

    // Delete trips directly by userId (trips carry a user_id column; this also removes them before
    // their vehicle FK would cascade — same direct-by-userId pattern as photos/expenses).
    await tx.delete(trips).where(eq(trips.userId, userId));

    // Delete odometer entries before vehicles (FK constraint)
    if (vehicleIds.length > 0) {
      await tx.delete(odometerEntries).where(inArray(odometerEntries.vehicleId, vehicleIds));
      await tx.delete(vehicleFinancing).where(inArray(vehicleFinancing.vehicleId, vehicleIds));
    }

    // Delete insurance policies directly by userId (terms, junction rows, and
    // claims all cascade via FK — claims.policy_id is ON DELETE cascade)
    await tx.delete(insurancePolicies).where(eq(insurancePolicies.userId, userId));

    // Delete reminders before vehicles (CASCADE handles reminder_vehicles + reminder_notifications)
    await tx.delete(reminders).where(eq(reminders.userId, userId));

    // Delete user preferences and sync state
    await tx.delete(userPreferences).where(eq(userPreferences.userId, userId));
    await tx.delete(syncState).where(eq(syncState.userId, userId));

    await tx.delete(vehicles).where(eq(vehicles.userId, userId));
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

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Sequential FK-ordered inserts for all backup tables
  private async insertBackupData(
    tx: DrizzleTransaction,
    data: ParsedBackupData,
    userId: string
  ): Promise<void> {
    // Data is already coerced by coerceRow (ZIP path via parseZipBackup, Sheets path via restoreFromSheets)
    if (data.vehicles.length > 0) {
      await tx
        .insert(vehicles)
        .values(this.stampUserId(data.vehicles, userId) as (typeof vehicles.$inferInsert)[]);
    }
    if (data.financing.length > 0) {
      await tx
        .insert(vehicleFinancing)
        .values(data.financing as (typeof vehicleFinancing.$inferInsert)[]);
    }
    if (data.insurance.length > 0) {
      await tx
        .insert(insurancePolicies)
        .values(
          this.stampUserId(data.insurance, userId) as (typeof insurancePolicies.$inferInsert)[]
        );
    }
    // Insert insurance terms after policies (FK constraint)
    if (data.insuranceTerms?.length > 0) {
      await tx
        .insert(insuranceTerms)
        .values(data.insuranceTerms as (typeof insuranceTerms.$inferInsert)[]);
    }
    // Insert insurance term vehicles after terms (FK constraint)
    if (data.insuranceTermVehicles?.length > 0) {
      await tx
        .insert(insuranceTermVehicles)
        .values(data.insuranceTermVehicles as (typeof insuranceTermVehicles.$inferInsert)[]);
    }
    // Insert insurance claims after policies/terms/vehicles (policy FK + optional
    // term_id/vehicle_id set-null FKs)
    if ((data.insuranceClaims?.length ?? 0) > 0) {
      await tx
        .insert(insuranceClaims)
        .values(data.insuranceClaims as (typeof insuranceClaims.$inferInsert)[]);
    }
    // Insert reminders after vehicles (userId + vehicleId FKs)
    if ((data.reminders?.length ?? 0) > 0) {
      await tx
        .insert(reminders)
        .values(this.stampUserId(data.reminders, userId) as (typeof reminders.$inferInsert)[]);
    }
    // Insert reminder vehicles after reminders and vehicles (junction FK)
    if ((data.reminderVehicles?.length ?? 0) > 0) {
      await tx
        .insert(reminderVehicles)
        .values(data.reminderVehicles as (typeof reminderVehicles.$inferInsert)[]);
    }
    // Insert reminder notifications after reminders (reminderId FK)
    if ((data.reminderNotifications?.length ?? 0) > 0) {
      await tx
        .insert(reminderNotifications)
        .values(
          this.stampUserId(
            data.reminderNotifications,
            userId
          ) as (typeof reminderNotifications.$inferInsert)[]
        );
    }
    if (data.expenses.length > 0) {
      await tx
        .insert(expenses)
        .values(this.stampUserId(data.expenses, userId) as (typeof expenses.$inferInsert)[]);
    }
    if (data.odometer?.length > 0) {
      await tx
        .insert(odometerEntries)
        .values(this.stampUserId(data.odometer, userId) as (typeof odometerEntries.$inferInsert)[]);
    }
    // Insert trips AFTER vehicles (trips.vehicle_id FK) — userId-stamped like odometer/expenses.
    if ((data.trips?.length ?? 0) > 0) {
      await tx
        .insert(trips)
        .values(this.stampUserId(data.trips, userId) as (typeof trips.$inferInsert)[]);
    }
    // Insert user preferences and sync state
    if (data.userPreferences?.length > 0) {
      await tx
        .insert(userPreferences)
        .values(
          this.stampUserId(data.userPreferences, userId) as (typeof userPreferences.$inferInsert)[]
        );
    }
    if (data.syncState?.length > 0) {
      await tx
        .insert(syncState)
        .values(this.stampUserId(data.syncState, userId) as (typeof syncState.$inferInsert)[]);
    }
    // Insert photos AFTER all entity tables so entityId references are valid
    if (data.photos?.length > 0) {
      await tx
        .insert(photos)
        .values(this.stampUserId(data.photos, userId) as (typeof photos.$inferInsert)[]);
    }
    // Insert photo_refs AFTER photos (photo_id FK references photos)
    // Filter out refs whose providerId doesn't exist in user_providers —
    // providers contain encrypted credentials and are NOT included in backups,
    // so restored refs may reference providers that don't exist on this instance.
    if (data.photoRefs?.length > 0) {
      const refRows = data.photoRefs as (typeof photoRefs.$inferInsert)[];
      const providerIds = [...new Set(refRows.map((r) => r.providerId))];
      const existingProviders = await tx
        .select({ id: userProviders.id })
        .from(userProviders)
        .where(inArray(userProviders.id, providerIds));
      const existingProviderIds = new Set(existingProviders.map((p) => p.id));
      const validRefs = refRows.filter((r) => existingProviderIds.has(r.providerId));
      if (validRefs.length > 0) {
        await tx.insert(photoRefs).values(validRefs);
      }
    }
  }
}

export const restoreService = new RestoreService();
