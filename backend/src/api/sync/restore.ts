/**
 * Restore Service - Handles data restoration from backups and Google Sheets
 */

import { and, eq, inArray } from 'drizzle-orm';
import { TABLE_SCHEMA_MAP } from '../../config';
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
  userPreferences,
  userProviders,
  vehicleFinancing,
  vehicles,
} from '../../db/schema';
import { SyncError, SyncErrorCode } from '../../errors';
import type { BackupConfig, ParsedBackupData } from '../../types';
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

    await this.db.transaction(async (tx) => {
      if (mode === 'replace') {
        await this.deleteUserData(tx, userId);
      }
      await this.insertBackupData(tx, parsedBackup, userId);
    });

    return { success: true, imported: summary };
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

    // Coerce Sheets data using schema-aware column types
    for (const [key, table] of Object.entries(TABLE_SCHEMA_MAP)) {
      const data = sheetData[key as keyof typeof sheetData];
      if (Array.isArray(data)) {
        // biome-ignore lint/suspicious/noExplicitAny: Dynamic key assignment on parsed backup data
        (sheetData as Record<string, any>)[key] = data.map((row: Record<string, unknown>) =>
          coerceRow(row, table)
        );
      }
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

    const tables = [
      {
        data: data.vehicles,
        table: vehicles,
        name: 'vehicles',
        scope: eq(vehicles.userId, userId),
      },
      {
        data: data.expenses,
        table: expenses,
        name: 'expenses',
        scope: eq(expenses.userId, userId),
      },
      {
        data: data.financing,
        table: vehicleFinancing,
        name: 'vehicle_financing',
        // Owns via vehicleId → an empty owned-vehicle set must match nothing (inArray([]) is false).
        scope: inArray(vehicleFinancing.vehicleId, userVehicleIds),
      },
      {
        data: data.insurance,
        table: insurancePolicies,
        name: 'insurance_policies',
        scope: eq(insurancePolicies.userId, userId),
      },
      { data: data.photos ?? [], table: photos, name: 'photos', scope: eq(photos.userId, userId) },
      {
        data: data.photoRefs ?? [],
        table: photoRefs,
        name: 'photo_refs',
        // Owns via photoId → scope to the importer's photos.
        scope: inArray(photoRefs.photoId, userPhotoIds),
      },
    ];

    for (const { data: items, table, name, scope } of tables) {
      if (items.length === 0) continue;
      const ids = items.map((item) => String(item.id));
      const existing = await this.db
        .select()
        .from(table)
        .where(and(inArray(table.id, ids), scope));
      conflicts.push(
        ...existing.map((e) => ({
          table: name,
          id: e.id,
          localData: e,
          remoteData: items.find((item) => item.id === e.id),
        }))
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
