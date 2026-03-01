/**
 * Restore Service - Handles data restoration from backups and Google Sheets
 */

import { eq, inArray } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { getDb } from '../../db/connection';
import { expenses, insurancePolicies, vehicleFinancing, vehicles } from '../../db/schema';
import { SyncError, SyncErrorCode } from '../../errors';
import type { ParsedBackupData } from '../../types';
import { settingsRepository } from '../settings/repository';
import { backupService } from './backup';
import { GoogleSheetsService } from './google-sheets';

type DrizzleTransaction = Parameters<
  Parameters<BunSQLiteDatabase<Record<string, unknown>>['transaction']>[0]
>[0];

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
    mode: 'replace' | 'merge' | 'preview'
  ): Promise<RestoreResponse> {
    const settings = await settingsRepository.getUserSettings(userId);
    if (!settings?.googleSheetsSpreadsheetId) {
      throw new SyncError(SyncErrorCode.VALIDATION_ERROR, 'No Google Sheets spreadsheet found');
    }

    const user = await this.getUserWithToken(userId);
    const sheetsService = new GoogleSheetsService(user.googleRefreshToken);
    const sheetData = await sheetsService.readSpreadsheetData(settings.googleSheetsSpreadsheetId);

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

  async autoRestoreFromLatestBackup(userId: string): Promise<{
    restored: boolean;
    backupInfo?: { fileId: string; fileName: string; createdTime?: string };
    summary?: ImportSummary;
    error?: string;
  }> {
    try {
      const existingVehicles = await this.db
        .select()
        .from(vehicles)
        .where(eq(vehicles.userId, userId))
        .limit(1);
      if (existingVehicles.length > 0) {
        return { restored: false, error: 'User already has local data' };
      }

      const settings = await settingsRepository.getUserSettings(userId);
      if (!settings?.googleDriveBackupFolderId) {
        return { restored: false, error: 'No backup folder configured' };
      }

      const user = await this.getUserWithToken(userId);
      const { GoogleDriveService } = await import('./google-drive');
      const driveService = new GoogleDriveService(user.googleRefreshToken);

      const backups = await driveService.listFilesInFolder(settings.googleDriveBackupFolderId);
      const backupFiles = backups
        .filter((file) => file.name.startsWith('vroom-backup-') && file.name.endsWith('.zip'))
        .sort((a, b) => (b.modifiedTime || '').localeCompare(a.modifiedTime || ''));

      if (backupFiles.length === 0) {
        return { restored: false, error: 'No backups found' };
      }

      const latestBackup = backupFiles[0];
      const fileBuffer = await driveService.downloadFile(latestBackup.id);
      const result = await this.restoreFromBackup(userId, fileBuffer, 'replace');

      if (result.success && result.imported) {
        return {
          restored: true,
          backupInfo: {
            fileId: latestBackup.id,
            fileName: latestBackup.name,
            createdTime: latestBackup.createdTime,
          },
          summary: result.imported,
        };
      }

      return { restored: false, error: 'Restore operation failed' };
    } catch (error) {
      return { restored: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  private async detectConflicts(data: ParsedBackupData): Promise<Conflict[]> {
    const conflicts: Conflict[] = [];
    const tables = [
      { data: data.vehicles, table: vehicles, name: 'vehicles' },
      { data: data.expenses, table: expenses, name: 'expenses' },
      { data: data.financing, table: vehicleFinancing, name: 'vehicle_financing' },
      { data: data.insurance, table: insurancePolicies, name: 'insurance_policies' },
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
    const userVehicles = await tx.select().from(vehicles).where(eq(vehicles.userId, userId));
    if (userVehicles.length === 0) return;

    const vehicleIds = userVehicles.map((v: { id: string }) => v.id);
    await tx.delete(expenses).where(inArray(expenses.vehicleId, vehicleIds));
    await tx.delete(insurancePolicies).where(inArray(insurancePolicies.vehicleId, vehicleIds));
    await tx.delete(vehicleFinancing).where(inArray(vehicleFinancing.vehicleId, vehicleIds));
    await tx.delete(vehicles).where(eq(vehicles.userId, userId));
  }

  private async insertBackupData(tx: DrizzleTransaction, data: ParsedBackupData): Promise<void> {
    // Insert data with validation - convertRow handles type conversion
    // Drizzle will validate against schema during insert
    if (data.vehicles.length > 0) {
      const convertedVehicles = data.vehicles.map((v) => this.convertRow(v));
      await tx.insert(vehicles).values(convertedVehicles as (typeof vehicles.$inferInsert)[]);
    }
    if (data.expenses.length > 0) {
      const convertedExpenses = data.expenses.map((e) => this.convertRow(e));
      await tx.insert(expenses).values(convertedExpenses as (typeof expenses.$inferInsert)[]);
    }
    if (data.financing.length > 0) {
      const convertedFinancing = data.financing.map((f) => this.convertRow(f));
      await tx
        .insert(vehicleFinancing)
        .values(convertedFinancing as (typeof vehicleFinancing.$inferInsert)[]);
    }
    if (data.insurance.length > 0) {
      const convertedInsurance = data.insurance.map((i) => this.convertRow(i));
      await tx
        .insert(insurancePolicies)
        .values(convertedInsurance as (typeof insurancePolicies.$inferInsert)[]);
    }
  }

  private convertRow(row: Record<string, unknown>): Record<string, unknown> {
    const converted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      // Handle null/undefined values before conversion
      if (value === null || value === undefined) {
        converted[key] = null;
        continue;
      }
      converted[key] = this.convertValue(String(value), key);
    }
    return converted;
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Type conversion requires checking multiple field patterns
  private convertValue(value: string, field: string): unknown {
    if (value === '' || value === 'null' || value === 'undefined' || value === 'NULL') return null;

    if (field.endsWith('At') || field.endsWith('Date') || field === 'date') {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    if (field.startsWith('is') || field === 'isActive' || field === 'isScheduled') {
      return value === 'true' || value === '1' || value === 'TRUE';
    }

    if (
      field.includes('amount') ||
      field.includes('Amount') ||
      field.includes('price') ||
      field.includes('Price') ||
      field.includes('cost') ||
      field.includes('Cost') ||
      field.includes('balance') ||
      field.includes('Balance') ||
      field === 'apr' ||
      field === 'volume' ||
      field === 'charge' ||
      field === 'mileage' ||
      field === 'initialMileage' ||
      field === 'mileageLimit' ||
      field === 'excessMileageFee' ||
      field === 'residualValue'
    ) {
      const num = Number.parseFloat(value);
      return Number.isNaN(num) ? null : num;
    }

    if (
      field === 'year' ||
      field === 'termMonths' ||
      field === 'termLengthMonths' ||
      field === 'paymentNumber' ||
      field === 'paymentDayOfMonth' ||
      field === 'paymentDayOfWeek'
    ) {
      const num = Number.parseInt(value, 10);
      return Number.isNaN(num) ? null : num;
    }

    return value;
  }

  private async getUserWithToken(userId: string): Promise<{
    id: string;
    displayName: string;
    googleRefreshToken: string;
  }> {
    const { users } = await import('../../db/schema');
    const userResults = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);

    if (!userResults.length || !userResults[0].googleRefreshToken) {
      throw new SyncError(
        SyncErrorCode.AUTH_INVALID,
        'Google Drive access not available. Please re-authenticate.'
      );
    }

    return {
      id: userResults[0].id,
      displayName: userResults[0].displayName,
      googleRefreshToken: userResults[0].googleRefreshToken,
    };
  }
}

export const restoreService = new RestoreService();
