/**
 * Conflict Detector - Detects conflicts during merge operations
 */

/**
 * Consolidated Restore Service
 *
 * Consolidates:
 * - lib/services/sync/restore/conflict-detector.ts
 * - lib/services/sync/restore/data-importer.ts
 * - lib/services/sync/restore/restore-executor.ts
 */

import { eq, inArray } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { getDb } from '../db/connection';
import {
  expenses,
  insurancePolicies,
  vehicleFinancing,
  vehicleFinancingPayments,
  vehicles,
} from '../db/schema';
import { SyncError, SyncErrorCode } from '../errors';
import { settingsRepository } from '../settings/repository';
import type { ParsedBackupData } from '../types';
import { logger } from '../utils/logger';
import { backupService } from './backup';
import { GoogleSheetsService } from './google-sheets';

type Database = BunSQLiteDatabase<Record<string, unknown>>;
type DrizzleTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface Conflict {
  table: string;
  id: string;
  localData: unknown;
  remoteData: unknown;
}

export class ConflictDetector {
  constructor(private db: Database) {}

  /**
   * Detect conflicts for merge mode across all tables
   *
   * Compares backup data with existing database records to identify conflicts.
   * A conflict occurs when a record with the same ID exists in both the backup
   * and the database, indicating potential data divergence.
   *
   * @param userId - The user ID (used for logging)
   * @param data - Parsed backup data to check for conflicts
   * @returns Array of conflicts found across all tables
   *
   * @remarks
   * This method checks all entity types:
   * - Vehicles
   * - Expenses
   * - Vehicle Financing
   * - Financing Payments
   * - Insurance Policies
   */
  async detectConflicts(userId: string, data: ParsedBackupData): Promise<Conflict[]> {
    logger.info('Detecting conflicts for merge operation', { userId });

    const conflicts: Conflict[] = [];

    // Check vehicle conflicts
    const vehicleConflicts = await this.detectVehicleConflicts(data.vehicles);
    conflicts.push(...vehicleConflicts);

    // Check expense conflicts
    const expenseConflicts = await this.detectExpenseConflicts(data.expenses);
    conflicts.push(...expenseConflicts);

    // Check financing conflicts
    const financingConflicts = await this.detectFinancingConflicts(data.financing);
    conflicts.push(...financingConflicts);

    // Check financing payment conflicts
    const paymentConflicts = await this.detectFinancingPaymentConflicts(data.financingPayments);
    conflicts.push(...paymentConflicts);

    // Check insurance conflicts
    const insuranceConflicts = await this.detectInsuranceConflicts(data.insurance);
    conflicts.push(...insuranceConflicts);

    logger.info('Conflict detection completed', { userId, conflictCount: conflicts.length });

    return conflicts;
  }

  /**
   * Detect vehicle conflicts
   */
  private async detectVehicleConflicts(
    remoteVehicles: Record<string, unknown>[]
  ): Promise<Conflict[]> {
    if (remoteVehicles.length === 0) return [];

    const vehicleIds = remoteVehicles.map((v) => String(v.id));
    const existingVehicles = await this.db
      .select()
      .from(vehicles)
      .where(inArray(vehicles.id, vehicleIds));

    return existingVehicles.map((existing) => {
      const remote = remoteVehicles.find((v) => v.id === existing.id);
      return {
        table: 'vehicles',
        id: existing.id,
        localData: existing,
        remoteData: remote,
      };
    });
  }

  /**
   * Detect expense conflicts
   */
  private async detectExpenseConflicts(
    remoteExpenses: Record<string, unknown>[]
  ): Promise<Conflict[]> {
    if (remoteExpenses.length === 0) return [];

    const expenseIds = remoteExpenses.map((e) => String(e.id));
    const existingExpenses = await this.db
      .select()
      .from(expenses)
      .where(inArray(expenses.id, expenseIds));

    return existingExpenses.map((existing) => {
      const remote = remoteExpenses.find((e) => e.id === existing.id);
      return {
        table: 'expenses',
        id: existing.id,
        localData: existing,
        remoteData: remote,
      };
    });
  }

  /**
   * Detect financing conflicts
   */
  private async detectFinancingConflicts(
    remoteFinancing: Record<string, unknown>[]
  ): Promise<Conflict[]> {
    if (remoteFinancing.length === 0) return [];

    const financingIds = remoteFinancing.map((f) => String(f.id));
    const existingFinancing = await this.db
      .select()
      .from(vehicleFinancing)
      .where(inArray(vehicleFinancing.id, financingIds));

    return existingFinancing.map((existing) => {
      const remote = remoteFinancing.find((f) => f.id === existing.id);
      return {
        table: 'vehicle_financing',
        id: existing.id,
        localData: existing,
        remoteData: remote,
      };
    });
  }

  /**
   * Detect financing payment conflicts
   */
  private async detectFinancingPaymentConflicts(
    remotePayments: Record<string, unknown>[]
  ): Promise<Conflict[]> {
    if (remotePayments.length === 0) return [];

    const paymentIds = remotePayments.map((p) => String(p.id));
    const existingPayments = await this.db
      .select()
      .from(vehicleFinancingPayments)
      .where(inArray(vehicleFinancingPayments.id, paymentIds));

    return existingPayments.map((existing) => {
      const remote = remotePayments.find((p) => p.id === existing.id);
      return {
        table: 'vehicle_financing_payments',
        id: existing.id,
        localData: existing,
        remoteData: remote,
      };
    });
  }

  /**
   * Detect insurance conflicts
   */
  private async detectInsuranceConflicts(
    remoteInsurance: Record<string, unknown>[]
  ): Promise<Conflict[]> {
    if (remoteInsurance.length === 0) return [];

    const insuranceIds = remoteInsurance.map((i) => String(i.id));
    const existingInsurance = await this.db
      .select()
      .from(insurancePolicies)
      .where(inArray(insurancePolicies.id, insuranceIds));

    return existingInsurance.map((existing) => {
      const remote = remoteInsurance.find((i) => i.id === existing.id);
      return {
        table: 'insurance_policies',
        id: existing.id,
        localData: existing,
        remoteData: remote,
      };
    });
  }
}
/**
 * Data Importer - Handles importing data into database with proper type conversion
 */
export class DataImporter {
  /**
   * Delete all user data (for replace mode)
   *
   * Deletes all data associated with a user in the correct order to respect
   * foreign key constraints. This is used in 'replace' mode before importing
   * backup data.
   *
   * @param tx - Database transaction to execute deletions within
   * @param userId - The user ID whose data should be deleted
   *
   * @remarks
   * Deletion order (respects foreign keys):
   * 1. Expenses (references vehicles)
   * 2. Insurance Policies (references vehicles)
   * 3. Financing Payments (references financing)
   * 4. Vehicle Financing (references vehicles)
   * 5. Vehicles (references user)
   */
  async deleteUserData(tx: DrizzleTransaction, userId: string): Promise<void> {
    logger.info('Deleting user data for replace mode', { userId });

    // Get all vehicle IDs for the user
    const userVehicles = await tx.select().from(vehicles).where(eq(vehicles.userId, userId));

    if (userVehicles.length === 0) {
      logger.info('No existing data to delete', { userId });
      return;
    }

    const vehicleIds = userVehicles.map((v: { id: string }) => v.id);

    // Delete in correct order (respecting foreign key constraints)
    await tx.delete(expenses).where(inArray(expenses.vehicleId, vehicleIds));

    await tx.delete(insurancePolicies).where(inArray(insurancePolicies.vehicleId, vehicleIds));

    // Get financing IDs before deleting
    const financingRecords = await tx
      .select()
      .from(vehicleFinancing)
      .where(inArray(vehicleFinancing.vehicleId, vehicleIds));

    if (financingRecords.length > 0) {
      const financingIds = financingRecords.map((f: { id: string }) => f.id);
      await tx
        .delete(vehicleFinancingPayments)
        .where(inArray(vehicleFinancingPayments.financingId, financingIds));
    }

    await tx.delete(vehicleFinancing).where(inArray(vehicleFinancing.vehicleId, vehicleIds));

    await tx.delete(vehicles).where(eq(vehicles.userId, userId));

    logger.info('User data deleted successfully', { userId, vehicleCount: vehicleIds.length });
  }

  /**
   * Insert backup data into database
   *
   * Imports all entities from parsed backup data into the database within a transaction.
   * Handles type conversion from CSV strings to proper database types (dates, numbers, booleans).
   *
   * @param tx - Database transaction to execute inserts within
   * @param data - Parsed backup data containing all entities
   *
   * @remarks
   * Insertion order (respects foreign keys):
   * 1. Vehicles (no dependencies)
   * 2. Expenses (depends on vehicles)
   * 3. Vehicle Financing (depends on vehicles)
   * 4. Financing Payments (depends on financing)
   * 5. Insurance Policies (depends on vehicles)
   *
   * All CSV string values are converted to proper types before insertion.
   */
  async insertBackupData(tx: DrizzleTransaction, data: ParsedBackupData): Promise<void> {
    logger.info('Inserting backup data', {
      vehicles: data.vehicles.length,
      expenses: data.expenses.length,
      financing: data.financing.length,
      financingPayments: data.financingPayments.length,
      insurance: data.insurance.length,
    });

    // Insert vehicles
    if (data.vehicles.length > 0) {
      const vehicleData = data.vehicles.map((v) => this.convertCSVRow(v));
      await tx.insert(vehicles).values(vehicleData as (typeof vehicles.$inferInsert)[]);
    }

    // Insert expenses
    if (data.expenses.length > 0) {
      const expenseData = data.expenses.map((e) => this.convertCSVRow(e));
      await tx.insert(expenses).values(expenseData as (typeof expenses.$inferInsert)[]);
    }

    // Insert financing
    if (data.financing.length > 0) {
      const financingData = data.financing.map((f) => this.convertCSVRow(f));
      await tx
        .insert(vehicleFinancing)
        .values(financingData as (typeof vehicleFinancing.$inferInsert)[]);
    }

    // Insert financing payments
    if (data.financingPayments.length > 0) {
      const paymentData = data.financingPayments.map((p) => this.convertCSVRow(p));
      await tx
        .insert(vehicleFinancingPayments)
        .values(paymentData as (typeof vehicleFinancingPayments.$inferInsert)[]);
    }

    // Insert insurance
    if (data.insurance.length > 0) {
      const insuranceData = data.insurance.map((i) => this.convertCSVRow(i));
      await tx
        .insert(insurancePolicies)
        .values(insuranceData as (typeof insurancePolicies.$inferInsert)[]);
    }

    logger.info('Backup data inserted successfully');
  }

  /**
   * Convert CSV row data to properly typed object
   */
  private convertCSVRow(row: Record<string, unknown>): Record<string, unknown> {
    const converted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      converted[key] = this.convertCSVValue(String(value), key);
    }
    return converted;
  }

  /**
   * Convert CSV string values to proper types
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Type conversion requires checking multiple field patterns
  private convertCSVValue(value: string, fieldName: string): unknown {
    if (value === '' || value === 'null' || value === 'undefined' || value === 'NULL') {
      return null;
    }

    // Date fields
    if (fieldName.endsWith('At') || fieldName.endsWith('Date') || fieldName === 'date') {
      try {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return null;
        return date;
      } catch {
        return null;
      }
    }

    // Boolean fields
    if (fieldName.startsWith('is') || fieldName === 'isActive' || fieldName === 'isScheduled') {
      return value === 'true' || value === '1' || value === 'TRUE';
    }

    // Numeric fields
    if (
      fieldName.includes('amount') ||
      fieldName.includes('Amount') ||
      fieldName.includes('price') ||
      fieldName.includes('Price') ||
      fieldName.includes('cost') ||
      fieldName.includes('Cost') ||
      fieldName.includes('balance') ||
      fieldName.includes('Balance') ||
      fieldName === 'apr' ||
      fieldName === 'volume' ||
      fieldName === 'charge' ||
      fieldName === 'mileage' ||
      fieldName === 'initialMileage' ||
      fieldName === 'mileageLimit' ||
      fieldName === 'excessMileageFee' ||
      fieldName === 'residualValue'
    ) {
      const num = Number.parseFloat(value);
      return Number.isNaN(num) ? null : num;
    }

    // Integer fields
    if (
      fieldName === 'year' ||
      fieldName === 'termMonths' ||
      fieldName === 'termLengthMonths' ||
      fieldName === 'paymentNumber' ||
      fieldName === 'paymentDayOfMonth' ||
      fieldName === 'paymentDayOfWeek'
    ) {
      const num = Number.parseInt(value, 10);
      return Number.isNaN(num) ? null : num;
    }

    return value;
  }
}
/**
 * Restore Executor - Orchestrates restore operations
 */

export interface ImportSummary {
  vehicles: number;
  expenses: number;
  financing: number;
  financingPayments: number;
  insurance: number;
}

export interface RestoreResponse {
  success: boolean;
  preview?: ImportSummary;
  imported?: ImportSummary;
  conflicts?: Conflict[];
}

export class RestoreExecutor {
  private conflictDetector: ConflictDetector;
  private dataImporter: DataImporter;

  constructor() {
    const db = getDb();
    this.conflictDetector = new ConflictDetector(db);
    this.dataImporter = new DataImporter();
  }

  /**
   * Restore user data from a backup ZIP file
   *
   * @param userId - The user ID to restore data for
   * @param file - The backup ZIP file as a Buffer
   * @param mode - Restore mode:
   *   - 'preview': Validate and show what would be imported (no changes)
   *   - 'merge': Import data, detecting conflicts with existing data
   *   - 'replace': Delete all existing data and import backup
   * @returns RestoreResponse with success status, import summary, and any conflicts
   * @throws {SyncError} If validation fails or user ID doesn't match
   */
  async restoreFromBackup(
    userId: string,
    file: Buffer,
    mode: 'replace' | 'merge' | 'preview'
  ): Promise<RestoreResponse> {
    logger.info('Starting restore from backup', { userId, mode });

    // Parse backup
    const parsedBackup = await backupService.parseZipBackup(file);

    // Validate user ID
    const userIdValidation = backupService.validateUserId(parsedBackup.metadata.userId, userId);
    if (!userIdValidation.valid) {
      throw new SyncError(
        SyncErrorCode.VALIDATION_ERROR,
        userIdValidation.errors[0] || 'User ID mismatch'
      );
    }

    // Validate backup data
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
      financingPayments: parsedBackup.financingPayments.length,
      insurance: parsedBackup.insurance.length,
    };

    if (mode === 'preview') {
      logger.info('Restore preview generated', { userId, summary });
      return {
        success: true,
        preview: summary,
      };
    }

    if (mode === 'merge') {
      const conflicts = await this.conflictDetector.detectConflicts(userId, parsedBackup);
      if (conflicts.length > 0) {
        logger.warn('Conflicts detected during merge', { userId, conflictCount: conflicts.length });
        return {
          success: false,
          conflicts,
        };
      }
    }

    const db = getDb();

    try {
      await db.transaction(async (tx) => {
        if (mode === 'replace') {
          await this.dataImporter.deleteUserData(tx, userId);
        }

        await this.dataImporter.insertBackupData(tx, parsedBackup);
      });

      logger.info('Restore from backup completed', { userId, mode, summary });

      return {
        success: true,
        imported: summary,
      };
    } catch (error) {
      logger.error('Restore from backup failed', {
        userId,
        mode,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      throw new SyncError(
        SyncErrorCode.VALIDATION_ERROR,
        'Failed to restore backup',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Restore user data from Google Sheets
   *
   * Fetches data from the user's synced Google Sheets and imports it.
   * Requires the user to have Google Sheets sync configured.
   *
   * @param userId - The user ID to restore data for
   * @param mode - Restore mode:
   *   - 'preview': Validate and show what would be imported (no changes)
   *   - 'merge': Import data, detecting conflicts with existing data
   *   - 'replace': Delete all existing data and import from Sheets
   * @returns RestoreResponse with success status, import summary, and any conflicts
   * @throws {SyncError} If Sheets sync is not configured or data fetch fails
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Restore logic requires multiple validation and transaction steps
  async restoreFromSheets(
    userId: string,
    mode: 'replace' | 'merge' | 'preview'
  ): Promise<RestoreResponse> {
    logger.info('Starting restore from Google Sheets', { userId, mode });

    const db = getDb();

    const settings = await settingsRepository.getUserSettings(userId);

    if (!settings || !settings.googleSheetsSpreadsheetId) {
      throw new SyncError(
        SyncErrorCode.VALIDATION_ERROR,
        'No Google Sheets spreadsheet found for this user'
      );
    }

    const user = await this.getUserWithToken(userId);

    try {
      const sheetsService = new GoogleSheetsService(
        user.googleRefreshToken,
        user.googleRefreshToken
      );

      const sheetData = await sheetsService.readSpreadsheetData(settings.googleSheetsSpreadsheetId);

      if (sheetData.metadata.userId !== userId) {
        throw new SyncError(
          SyncErrorCode.VALIDATION_ERROR,
          'Spreadsheet data belongs to a different user'
        );
      }

      // Validate sheet data
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
        financingPayments: sheetData.financingPayments.length,
        insurance: sheetData.insurance.length,
      };

      if (mode === 'preview') {
        logger.info('Restore from sheets preview generated', { userId, summary });
        return {
          success: true,
          preview: summary,
        };
      }

      if (mode === 'merge') {
        const conflicts = await this.conflictDetector.detectConflicts(userId, sheetData);
        if (conflicts.length > 0) {
          logger.warn('Conflicts detected during sheets merge', {
            userId,
            conflictCount: conflicts.length,
          });
          return {
            success: false,
            conflicts,
          };
        }
      }

      await db.transaction(async (tx) => {
        if (mode === 'replace') {
          await this.dataImporter.deleteUserData(tx, userId);
        }

        await this.dataImporter.insertBackupData(tx, sheetData);
      });

      logger.info('Restore from Google Sheets completed', { userId, mode, summary });

      return {
        success: true,
        imported: summary,
      };
    } catch (error) {
      logger.error('Restore from Google Sheets failed', {
        userId,
        mode,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      if (error instanceof Error && error.message.includes('auth')) {
        throw new SyncError(
          SyncErrorCode.AUTH_INVALID,
          'Google Drive access not available. Please re-authenticate with Google.',
          error.message
        );
      }

      if (error instanceof SyncError) {
        throw error;
      }

      throw new SyncError(
        SyncErrorCode.VALIDATION_ERROR,
        'Failed to restore from Google Sheets',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Auto-restore from the latest Google Drive backup if user has no local data
   *
   * This method is typically called during user onboarding or after account setup.
   * It checks if the user has any existing vehicles, and if not, attempts to restore
   * from their most recent Google Drive backup.
   *
   * @param userId - The user ID to check and restore for
   * @returns Object with:
   *   - restored: Whether a restore was performed
   *   - backupInfo: Information about the backup file used (if restored)
   *   - summary: Import summary (if restored)
   *   - error: Error message if restore was skipped or failed
   *
   * @example
   * ```typescript
   * const result = await restoreExecutor.autoRestoreFromLatestBackup(userId);
   * if (result.restored) {
   *   console.log(`Restored ${result.summary.vehicles} vehicles`);
   * }
   * ```
   */
  async autoRestoreFromLatestBackup(userId: string): Promise<{
    restored: boolean;
    backupInfo?: {
      fileId: string;
      fileName: string;
      createdTime?: string;
    };
    summary?: ImportSummary;
    error?: string;
  }> {
    logger.info('Starting auto-restore from latest backup', { userId });

    try {
      const db = getDb();

      // Check if user already has data
      const existingVehicles = await db
        .select()
        .from(vehicles)
        .where(eq(vehicles.userId, userId))
        .limit(1);

      if (existingVehicles.length > 0) {
        logger.info('User already has data, skipping auto-restore', { userId });
        return {
          restored: false,
          error: 'User already has local data',
        };
      }

      const settings = await settingsRepository.getUserSettings(userId);

      if (!settings || !settings.googleDriveBackupFolderId) {
        logger.info('No backup folder configured, skipping auto-restore', { userId });
        return {
          restored: false,
          error: 'No backup folder configured',
        };
      }

      const user = await this.getUserWithToken(userId);

      const { GoogleDriveService } = await import('./google-drive');
      const driveService = new GoogleDriveService(user.googleRefreshToken, user.googleRefreshToken);

      // List backups directly
      const backups = await driveService.listFilesInFolder(settings.googleDriveBackupFolderId);
      const backupFiles = backups
        .filter((file) => file.name.startsWith('vroom-backup-') && file.name.endsWith('.zip'))
        .sort((a, b) => (b.modifiedTime || '').localeCompare(a.modifiedTime || ''));

      if (backupFiles.length === 0) {
        logger.info('No backups found, skipping auto-restore', { userId });
        return {
          restored: false,
          error: 'No backups found',
        };
      }

      // Get the latest backup
      const latestBackup = backupFiles[0];

      // Download and restore
      const fileBuffer = await driveService.downloadFile(latestBackup.id);
      const result = await this.restoreFromBackup(userId, fileBuffer, 'replace');

      if (result.success && result.imported) {
        logger.info('Auto-restore completed successfully', {
          userId,
          backupId: latestBackup.id,
          summary: result.imported,
        });

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

      return {
        restored: false,
        error: 'Restore operation failed',
      };
    } catch (error) {
      logger.error('Auto-restore failed', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        restored: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get user with Google refresh token
   */
  private async getUserWithToken(userId: string): Promise<{
    id: string;
    displayName: string;
    googleRefreshToken: string;
  }> {
    const db = getDb();
    const { users } = await import('../db/schema');
    const userResults = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    if (!userResults.length || !userResults[0].googleRefreshToken) {
      throw new SyncError(
        SyncErrorCode.AUTH_INVALID,
        'Google Drive access not available. Please re-authenticate with Google.'
      );
    }

    return {
      id: userResults[0].id,
      displayName: userResults[0].displayName,
      googleRefreshToken: userResults[0].googleRefreshToken,
    };
  }
}

export const restoreService = new RestoreExecutor();
