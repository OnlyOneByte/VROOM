/**
 * Restore Service - Handles data restoration from backups and Google Sheets
 */

import { and, eq, inArray } from 'drizzle-orm';
import { TABLE_SCHEMA_MAP } from '../../config';
import type { AppDatabase } from '../../db/connection';
import { getDb } from '../../db/connection';
import {
  expenses,
  insurancePolicies,
  insurancePolicyVehicles,
  odometerEntries,
  photoRefs,
  photos,
  userProviders,
  vehicleFinancing,
  vehicles,
} from '../../db/schema';
import { SyncError, SyncErrorCode } from '../../errors';
import type { BackupConfig, ParsedBackupData } from '../../types';
import { settingsRepository } from '../settings/repository';
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
  insurancePolicyVehicles: number;
  odometer: number;
  photos: number;
  photoRefs: number;
}

export interface RestoreResponse {
  success: boolean;
  preview?: ImportSummary;
  imported?: ImportSummary;
  conflicts?: Conflict[];
}

class RestoreService {
  private db = getDb();

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
      insurancePolicyVehicles: parsedBackup.insurancePolicyVehicles?.length ?? 0,
      odometer: parsedBackup.odometer?.length ?? 0,
      photos: parsedBackup.photos?.length ?? 0,
      photoRefs: parsedBackup.photoRefs?.length ?? 0,
    };

    if (mode === 'preview') {
      return { success: true, preview: summary };
    }

    if (mode === 'merge') {
      const conflicts = await this.detectConflicts(parsedBackup);
      if (conflicts.length > 0) {
        return { success: false, conflicts };
      }
    }

    await this.db.transaction(async (tx) => {
      if (mode === 'replace') {
        await this.deleteUserData(tx, userId);
      }
      await this.insertBackupData(tx, parsedBackup);
    });

    return { success: true, imported: summary };
  }

  async restoreFromSheets(
    userId: string,
    providerId: string,
    mode: 'replace' | 'merge' | 'preview'
  ): Promise<RestoreResponse> {
    // Load backupConfig and read sheetsSpreadsheetId for this provider
    const settings = await settingsRepository.getUserSettings(userId);
    const backupConfig = settings?.backupConfig as BackupConfig | null;
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
      insurancePolicyVehicles: sheetData.insurancePolicyVehicles?.length ?? 0,
      odometer: sheetData.odometer?.length ?? 0,
      photos: sheetData.photos?.length ?? 0,
      photoRefs: sheetData.photoRefs?.length ?? 0,
    };

    if (mode === 'preview') {
      return { success: true, preview: summary };
    }

    if (mode === 'merge') {
      const conflicts = await this.detectConflicts(sheetData);
      if (conflicts.length > 0) {
        return { success: false, conflicts };
      }
    }

    await this.db.transaction(async (tx) => {
      if (mode === 'replace') {
        await this.deleteUserData(tx, userId);
      }
      await this.insertBackupData(tx, sheetData);
    });

    return { success: true, imported: summary };
  }

  private async detectConflicts(data: ParsedBackupData): Promise<Conflict[]> {
    const conflicts: Conflict[] = [];
    const tables = [
      { data: data.vehicles, table: vehicles, name: 'vehicles' },
      { data: data.expenses, table: expenses, name: 'expenses' },
      { data: data.financing, table: vehicleFinancing, name: 'vehicle_financing' },
      { data: data.insurance, table: insurancePolicies, name: 'insurance_policies' },
      { data: data.photos ?? [], table: photos, name: 'photos' },
      { data: data.photoRefs ?? [], table: photoRefs, name: 'photo_refs' },
    ];

    for (const { data: items, table, name } of tables) {
      if (items.length === 0) continue;
      const ids = items.map((item) => String(item.id));
      const existing = await this.db.select().from(table).where(inArray(table.id, ids));
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
    // Collect expense IDs for photo cleanup — delete directly by userId
    const userExpenses = await tx
      .select({ id: expenses.id })
      .from(expenses)
      .where(eq(expenses.userId, userId));
    const expenseIds = userExpenses.map((e) => e.id);

    // Collect vehicle IDs for related entity cleanup
    const userVehicles = await tx
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(eq(vehicles.userId, userId));
    const vehicleIds = userVehicles.map((v) => v.id);

    // Collect insurance policy IDs for photo deletion
    const userPolicies = await tx
      .select({ id: insurancePolicies.id })
      .from(insurancePolicies)
      .where(eq(insurancePolicies.userId, userId));
    const policyIds = userPolicies.map((p) => p.id);

    // Collect odometer entry IDs for photo deletion
    const odometerIds: string[] = [];
    if (vehicleIds.length > 0) {
      const userOdometerEntries = await tx
        .select({ id: odometerEntries.id })
        .from(odometerEntries)
        .where(inArray(odometerEntries.vehicleId, vehicleIds));
      odometerIds.push(...userOdometerEntries.map((o) => o.id));
    }

    // Delete photos for all entity types
    if (vehicleIds.length > 0) {
      await tx
        .delete(photos)
        .where(and(eq(photos.entityType, 'vehicle'), inArray(photos.entityId, vehicleIds)));
    }
    if (expenseIds.length > 0) {
      await tx
        .delete(photos)
        .where(and(eq(photos.entityType, 'expense'), inArray(photos.entityId, expenseIds)));
    }
    if (policyIds.length > 0) {
      await tx
        .delete(photos)
        .where(and(eq(photos.entityType, 'insurance_policy'), inArray(photos.entityId, policyIds)));
    }
    if (odometerIds.length > 0) {
      await tx
        .delete(photos)
        .where(and(eq(photos.entityType, 'odometer_entry'), inArray(photos.entityId, odometerIds)));
    }

    // Delete expenses directly by userId (no vehicle ID lookups needed)
    await tx.delete(expenses).where(eq(expenses.userId, userId));

    // Delete odometer entries before vehicles (FK constraint)
    if (vehicleIds.length > 0) {
      await tx.delete(odometerEntries).where(inArray(odometerEntries.vehicleId, vehicleIds));
      await tx.delete(vehicleFinancing).where(inArray(vehicleFinancing.vehicleId, vehicleIds));
    }

    // Delete insurance policies directly by userId (junction rows cascade via FK)
    await tx.delete(insurancePolicies).where(eq(insurancePolicies.userId, userId));
    await tx.delete(vehicles).where(eq(vehicles.userId, userId));
  }

  private async insertBackupData(tx: DrizzleTransaction, data: ParsedBackupData): Promise<void> {
    // Data is already coerced by coerceRow (ZIP path via parseZipBackup, Sheets path via restoreFromSheets)
    if (data.vehicles.length > 0) {
      await tx.insert(vehicles).values(data.vehicles as (typeof vehicles.$inferInsert)[]);
    }
    if (data.expenses.length > 0) {
      await tx.insert(expenses).values(data.expenses as (typeof expenses.$inferInsert)[]);
    }
    // Insert odometer entries AFTER expenses (linked_entity_id may reference expense IDs)
    if (data.odometer?.length > 0) {
      await tx
        .insert(odometerEntries)
        .values(data.odometer as (typeof odometerEntries.$inferInsert)[]);
    }
    if (data.financing.length > 0) {
      await tx
        .insert(vehicleFinancing)
        .values(data.financing as (typeof vehicleFinancing.$inferInsert)[]);
    }
    if (data.insurance.length > 0) {
      await tx
        .insert(insurancePolicies)
        .values(data.insurance as (typeof insurancePolicies.$inferInsert)[]);
    }
    if (data.insurancePolicyVehicles?.length > 0) {
      await tx
        .insert(insurancePolicyVehicles)
        .values(data.insurancePolicyVehicles as (typeof insurancePolicyVehicles.$inferInsert)[]);
    }
    // Insert photos AFTER all entity tables so entityId references are valid
    if (data.photos?.length > 0) {
      await tx.insert(photos).values(data.photos as (typeof photos.$inferInsert)[]);
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
