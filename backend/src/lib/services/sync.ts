/**
 * Merged Sync Service
 *
 * This file consolidates three sync-related services:
 * - backup-service.ts (backup creation, parsing, validation)
 * - google-sync.ts (Google Drive and Sheets sync operations)
 * - sync-orchestrator.ts (sync coordination and lock management)
 *
 * All sync-related functionality is now in this single file for easier maintenance.
 */

import AdmZip from 'adm-zip';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { eq, getTableColumns } from 'drizzle-orm';
import type { SQLiteTableWithColumns } from 'drizzle-orm/sqlite-core';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';
import { users } from '../../db/schema';
import {
  BACKUP_CONFIG,
  getBackupTableKeys,
  getRequiredBackupFiles,
  TABLE_FILENAME_MAP,
  TABLE_SCHEMA_MAP,
} from '../constants';
import { databaseService } from '../core/database';
import { SyncError, SyncErrorCode } from '../core/errors';
import { settingsRepository } from '../repositories';
import { BackupRepository } from '../repositories/backup';
import type { BackupData, BackupMetadata, ParsedBackupData } from '../types/sync';
import { logger } from '../utils/logger';
import type { GoogleDriveService } from './integrations/google-drive';
import { GoogleSheetsService } from './integrations/google-sheets';
import type { ImportSummary, RestoreResponse } from './sync/restore/restore-executor';
import { restoreExecutor } from './sync/restore/restore-executor';

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface BackupSyncResult {
  fileId: string;
  fileName: string;
  webViewLink: string;
  lastBackupDate: string;
}

export interface SheetsSyncResult {
  spreadsheetId: string;
  webViewLink: string;
  lastSyncDate: string;
}

// ============================================================================
// VALIDATION SCHEMA HELPERS
// ============================================================================

/**
 * Helper to create flexible timestamp schema that accepts both string and Date
 */
const flexibleTimestamp = (optional = false, nullable = false) => {
  let schema = z.union([z.string(), z.date()]).transform((val) => {
    if (typeof val === 'string') return new Date(val);
    return val;
  });

  if (nullable) {
    // biome-ignore lint/suspicious/noExplicitAny: Type narrowing for union with null
    schema = z.union([schema, z.null()]) as any;
  }

  if (optional) {
    return schema.optional();
  }

  return schema;
};

/**
 * Automatically generates timestamp field overrides for a Drizzle table
 */
function generateTimestampOverrides(
  // biome-ignore lint/suspicious/noExplicitAny: Generic table type
  table: SQLiteTableWithColumns<any>
): Record<string, z.ZodTypeAny> {
  const columns = getTableColumns(table);
  const overrides: Record<string, z.ZodTypeAny> = {};

  for (const [columnName, column] of Object.entries(columns)) {
    // biome-ignore lint/suspicious/noExplicitAny: Drizzle column type is not fully exposed
    const col = column as any;
    if (col.columnType === 'SQLiteInteger' && col.config?.mode === 'timestamp') {
      const isOptional = col.notNull === false || col.hasDefault;
      overrides[columnName] = flexibleTimestamp(isOptional, false);
    }
  }

  return overrides;
}

/**
 * Dynamically generate Zod schemas for all tables
 */
// biome-ignore lint/suspicious/noExplicitAny: Zod schema type is complex
const TABLE_SCHEMAS: Record<string, z.ZodObject<any>> = {};
for (const [key, table] of Object.entries(TABLE_SCHEMA_MAP)) {
  TABLE_SCHEMAS[key] = createInsertSchema(table, generateTimestampOverrides(table));
}

// ============================================================================
// BACKUP SERVICE CLASS
// ============================================================================

export class BackupService {
  /**
   * Get column names from a Drizzle table schema
   */
  private getColumnNames(table: Parameters<typeof getTableColumns>[0]): string[] {
    const columns = getTableColumns(table);
    return Object.keys(columns);
  }

  /**
   * Create a complete backup of user data
   */
  async createBackup(userId: string): Promise<BackupData> {
    logger.info('Creating backup', { userId });

    const db = databaseService.getDatabase();
    const repository = new BackupRepository(db);
    const userData = await repository.getAllUserData(userId);

    return {
      metadata: {
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        userId,
      },
      ...userData,
    };
  }

  /**
   * Export backup as CSV files in a ZIP
   */
  async exportAsZip(userId: string): Promise<Buffer> {
    logger.info('Exporting backup as ZIP', { userId });

    const backup = await this.createBackup(userId);
    const zip = new AdmZip();

    // Add metadata
    zip.addFile('metadata.json', Buffer.from(JSON.stringify(backup.metadata, null, 2), 'utf-8'));

    // Add CSV files for each data property
    for (const key of Object.keys(backup)) {
      if (key === 'metadata') continue;

      const table = TABLE_SCHEMA_MAP[key];
      const filename = TABLE_FILENAME_MAP[key];

      if (!table || !filename) {
        logger.warn(`No table schema or filename found for backup key: ${key}`);
        continue;
      }

      const data = backup[key as keyof BackupData] as Record<string, unknown>[];
      const csv = this.convertToCSV(data, this.getColumnNames(table));
      zip.addFile(filename, Buffer.from(csv, 'utf-8'));
    }

    logger.info('Backup ZIP created successfully', { userId, size: zip.toBuffer().length });
    return zip.toBuffer();
  }

  /**
   * Convert array of objects to CSV
   */
  private convertToCSV(data: Record<string, unknown>[], columns: string[]): string {
    if (data.length === 0) {
      return `${columns.join(',')}\n`;
    }

    const formattedData = data.map((item) => {
      const row: Record<string, unknown> = {};
      for (const col of columns) {
        const value = item[col];
        if (value === null || value === undefined) {
          row[col] = '';
        } else if (value instanceof Date) {
          row[col] = value.toISOString();
        } else {
          row[col] = value;
        }
      }
      return row;
    });

    return stringify(formattedData, {
      header: true,
      columns,
      quoted: true,
      quoted_empty: false,
    });
  }

  /**
   * Parse ZIP backup file and validate structure
   */
  async parseZipBackup(file: Buffer): Promise<ParsedBackupData> {
    logger.info('Parsing ZIP backup', { size: file.length });

    try {
      const zip = new AdmZip(file);
      const zipEntries = zip.getEntries();

      const requiredFiles = getRequiredBackupFiles();
      const fileNames = zipEntries.map((entry) => entry.entryName);
      const missingFiles = requiredFiles.filter((file) => !fileNames.includes(file));

      if (missingFiles.length > 0) {
        throw new Error(`Missing required files: ${missingFiles.join(', ')}`);
      }

      // Parse metadata
      const metadataEntry = zip.getEntry('metadata.json');
      if (!metadataEntry) {
        throw new Error('metadata.json not found in backup');
      }

      const metadataContent = metadataEntry.getData().toString('utf-8');
      const metadata = JSON.parse(metadataContent) as BackupMetadata;

      // Parse CSV files
      const getCSVData = (fileName: string): Record<string, unknown>[] => {
        const entry = zip.getEntry(fileName);
        if (!entry) return [];
        const content = entry.getData().toString('utf-8');
        return this.parseCSV(content);
      };

      const parsedData: ParsedBackupData = {
        metadata,
      } as ParsedBackupData;

      for (const [key, filename] of Object.entries(TABLE_FILENAME_MAP)) {
        // biome-ignore lint/suspicious/noExplicitAny: Dynamic key assignment
        parsedData[key as keyof ParsedBackupData] = getCSVData(filename) as any;
      }

      logger.info('ZIP backup parsed successfully', {
        vehicles: parsedData.vehicles.length,
        expenses: parsedData.expenses.length,
      });

      return parsedData;
    } catch (error) {
      logger.error('Failed to parse ZIP backup', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      if (error instanceof Error) {
        throw new Error(`Failed to parse ZIP backup: ${error.message}`);
      }
      throw new Error('Failed to parse ZIP backup: Unknown error');
    }
  }

  /**
   * Parse CSV content
   */
  private parseCSV(csvContent: string): Record<string, unknown>[] {
    if (!csvContent.trim()) {
      return [];
    }

    try {
      const records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_quotes: true,
        escape: '"',
        quote: '"',
      }) as Record<string, string>[];

      return records;
    } catch (error) {
      logger.error('CSV parsing failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new Error(
        `CSV parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Validate backup data structure and content
   */
  validateBackupData(backup: ParsedBackupData): ValidationResult {
    const errors: string[] = [];

    // Validate metadata
    if (!backup.metadata || !backup.metadata.userId || !backup.metadata.version) {
      errors.push('Invalid metadata: missing userId or version');
    }

    // Validate version
    if (backup.metadata.version !== BACKUP_CONFIG.CURRENT_VERSION) {
      errors.push(
        `Version mismatch: expected ${BACKUP_CONFIG.CURRENT_VERSION}, got ${backup.metadata.version}`
      );
    }

    // Validate all tables
    for (const key of getBackupTableKeys()) {
      const schema = TABLE_SCHEMAS[key];
      const data = backup[key as keyof ParsedBackupData] as Record<string, unknown>[];

      if (!schema) {
        logger.warn(`No schema found for backup key: ${key}`);
        continue;
      }

      const tableErrors = this.validateArray(data, schema, key);
      errors.push(...tableErrors);
    }

    // Validate referential integrity
    const integrityErrors = this.validateReferentialIntegrity(backup);
    errors.push(...integrityErrors);

    if (errors.length > 0) {
      logger.warn('Backup validation failed', { errorCount: errors.length, errors });
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate an array of records against a schema
   */
  private validateArray(
    records: Record<string, unknown>[],
    // biome-ignore lint/suspicious/noExplicitAny: Zod schema type
    schema: z.ZodObject<any>,
    tableName: string
  ): string[] {
    const errors: string[] = [];

    for (let i = 0; i < records.length; i++) {
      const result = schema.safeParse(records[i]);
      if (!result.success) {
        const fieldErrors = result.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`);
        errors.push(`${tableName}[${i}]: ${fieldErrors.join(', ')}`);
      }
    }

    return errors;
  }

  /**
   * Validate referential integrity between tables
   */
  private validateReferentialIntegrity(backup: ParsedBackupData): string[] {
    const errors: string[] = [];

    const vehicleIds = new Set(backup.vehicles.map((v) => String(v.id)));
    const financingIds = new Set(backup.financing.map((f) => String(f.id)));

    // Check expenses reference valid vehicles
    for (const expense of backup.expenses) {
      if (!vehicleIds.has(String(expense.vehicleId))) {
        errors.push(`Expense ${expense.id} references non-existent vehicle ${expense.vehicleId}`);
      }
    }

    // Check financing references valid vehicles
    for (const financing of backup.financing) {
      if (!vehicleIds.has(String(financing.vehicleId))) {
        errors.push(
          `Financing ${financing.id} references non-existent vehicle ${financing.vehicleId}`
        );
      }
    }

    // Check financing payments reference valid financing
    for (const payment of backup.financingPayments) {
      if (!financingIds.has(String(payment.financingId))) {
        errors.push(
          `Payment ${payment.id} references non-existent financing ${payment.financingId}`
        );
      }
    }

    // Check insurance references valid vehicles
    for (const insurance of backup.insurance) {
      if (!vehicleIds.has(String(insurance.vehicleId))) {
        errors.push(
          `Insurance ${insurance.id} references non-existent vehicle ${insurance.vehicleId}`
        );
      }
    }

    return errors;
  }

  /**
   * Validate file size
   */
  validateFileSize(size: number): ValidationResult {
    if (size > BACKUP_CONFIG.MAX_FILE_SIZE) {
      return {
        valid: false,
        errors: [
          `File size ${size} bytes exceeds maximum allowed size of ${BACKUP_CONFIG.MAX_FILE_SIZE} bytes`,
        ],
      };
    }

    return { valid: true, errors: [] };
  }

  /**
   * Validate user ID matches
   */
  validateUserId(backupUserId: string, requestUserId: string): ValidationResult {
    if (backupUserId !== requestUserId) {
      return {
        valid: false,
        errors: ['Backup file belongs to a different user'],
      };
    }

    return { valid: true, errors: [] };
  }
}

// ============================================================================
// GOOGLE SYNC SERVICE CLASS
// ============================================================================

export class GoogleSyncService {
  /**
   * Upload backup to Google Drive
   */
  async uploadBackupToGoogleDrive(userId: string): Promise<BackupSyncResult> {
    logger.info('Starting Google Drive backup upload', { userId });

    const settings = await settingsRepository.getByUserId(userId);

    if (!settings || !settings.googleDriveBackupEnabled) {
      throw new SyncError(
        SyncErrorCode.VALIDATION_ERROR,
        'Google Drive backup is not enabled for this user'
      );
    }

    const user = await this.getUserWithToken(userId);

    try {
      const { GoogleDriveService } = await import('./integrations/google-drive');
      const driveService = new GoogleDriveService(user.googleRefreshToken, user.googleRefreshToken);

      const folderStructure = await driveService.createVroomFolderStructure(user.displayName);

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `vroom-backup-${timestamp}.zip`;
      const fileContent = await backupService.exportAsZip(userId);
      const mimeType = 'application/zip';

      const uploadedFile = await driveService.uploadFile(
        fileName,
        fileContent,
        mimeType,
        folderStructure.subFolders.backups.id
      );

      const retentionCount =
        settings.googleDriveBackupRetentionCount || BACKUP_CONFIG.DEFAULT_RETENTION_COUNT;
      await this.cleanupOldBackups(
        driveService,
        folderStructure.subFolders.backups.id,
        retentionCount
      );

      await settingsRepository.updateBackupDate(userId, folderStructure.subFolders.backups.id);

      logger.info('Google Drive backup upload completed', {
        userId,
        fileId: uploadedFile.id,
        fileName,
      });

      return {
        fileId: uploadedFile.id,
        fileName: uploadedFile.name,
        webViewLink: uploadedFile.webViewLink || '',
        lastBackupDate: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('Google Drive backup upload failed', {
        userId,
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
        SyncErrorCode.NETWORK_ERROR,
        'Failed to upload backup to Google Drive',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * List backups in Google Drive folder
   */
  async listBackupsInDrive(
    driveService: GoogleDriveService,
    backupFolderId: string
  ): Promise<
    Array<{
      id: string;
      name: string;
      size: string;
      createdTime: string;
      modifiedTime: string;
      webViewLink: string;
    }>
  > {
    const files = await driveService.listFilesInFolder(backupFolderId);

    return files
      .filter((file) => file.name.startsWith('vroom-backup-') && file.name.endsWith('.zip'))
      .map((file) => ({
        id: file.id,
        name: file.name,
        size: file.size || '0',
        createdTime: file.createdTime || '',
        modifiedTime: file.modifiedTime || '',
        webViewLink: file.webViewLink || '',
      }))
      .sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
  }

  /**
   * Initialize Google Drive folder structure
   */
  async initializeGoogleDriveForUser(userId: string): Promise<{
    folderStructure: {
      mainFolder: { id: string; name: string; webViewLink?: string };
      subFolders: {
        receipts: { id: string; name: string };
        maintenance: { id: string; name: string };
        photos: { id: string; name: string };
        backups: { id: string; name: string };
      };
    };
    existingBackups: Array<{
      id: string;
      name: string;
      createdTime?: string;
      modifiedTime?: string;
      size?: string;
    }>;
  }> {
    logger.info('Initializing Google Drive folder structure', { userId });

    const user = await this.getUserWithToken(userId);

    try {
      const { GoogleDriveService } = await import('./integrations/google-drive');
      const driveService = new GoogleDriveService(user.googleRefreshToken, user.googleRefreshToken);

      const folderStructure = await driveService.createVroomFolderStructure(user.displayName);

      const existingBackups = await this.listBackupsInDrive(
        driveService,
        folderStructure.subFolders.backups.id
      );

      await settingsRepository.updateBackupFolderId(userId, folderStructure.subFolders.backups.id);

      if (existingBackups.length > 0) {
        const mostRecentBackup = existingBackups[0];
        if (mostRecentBackup.modifiedTime) {
          const lastBackupDate = new Date(mostRecentBackup.modifiedTime);
          await settingsRepository.updateBackupDateWithTime(userId, lastBackupDate);
          logger.info('Updated lastBackupDate from existing backup', {
            userId,
            lastBackupDate: lastBackupDate.toISOString(),
          });
        }
      }

      logger.info('Google Drive folder structure initialized', {
        userId,
        backupCount: existingBackups.length,
      });

      return {
        folderStructure,
        existingBackups,
      };
    } catch (error) {
      logger.error('Failed to initialize Google Drive folder structure', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      if (error instanceof Error && error.message.includes('auth')) {
        throw new SyncError(
          SyncErrorCode.AUTH_INVALID,
          'Google Drive access not available. Please re-authenticate with Google.',
          error.message
        );
      }

      throw new SyncError(
        SyncErrorCode.NETWORK_ERROR,
        'Failed to initialize Google Drive folder structure',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Delete old backups (keep only the last N backups)
   */
  private async cleanupOldBackups(
    driveService: GoogleDriveService,
    backupFolderId: string,
    keepCount: number = BACKUP_CONFIG.DEFAULT_RETENTION_COUNT
  ): Promise<number> {
    const backups = await this.listBackupsInDrive(driveService, backupFolderId);

    if (backups.length <= keepCount) {
      return 0;
    }

    const toDelete = backups.slice(keepCount);
    let deletedCount = 0;

    for (const backup of toDelete) {
      try {
        await driveService.deleteFile(backup.id);
        deletedCount++;
      } catch (error) {
        logger.warn('Failed to delete old backup', {
          backupId: backup.id,
          backupName: backup.name,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    logger.info('Old backups cleaned up', { deletedCount, keepCount });
    return deletedCount;
  }

  /**
   * Check for existing Google Drive folder structure and backups
   */
  async checkExistingGoogleDriveBackups(userId: string): Promise<{
    hasBackupFolder: boolean;
    backupFolderId?: string;
    existingBackups: Array<{
      id: string;
      name: string;
      createdTime?: string;
      modifiedTime?: string;
      size?: string;
    }>;
  }> {
    const settings = await settingsRepository.getByUserId(userId);

    if (settings?.googleDriveBackupFolderId) {
      return await this.checkKnownBackupFolder(userId, settings.googleDriveBackupFolderId);
    }

    return await this.searchForBackupFolder(userId);
  }

  /**
   * Check a known backup folder ID for existing backups
   */
  private async checkKnownBackupFolder(
    userId: string,
    backupFolderId: string
  ): Promise<{
    hasBackupFolder: boolean;
    backupFolderId?: string;
    existingBackups: Array<{
      id: string;
      name: string;
      createdTime?: string;
      modifiedTime?: string;
      size?: string;
    }>;
  }> {
    try {
      const user = await this.getUserWithToken(userId);

      const { GoogleDriveService } = await import('./integrations/google-drive');
      const driveService = new GoogleDriveService(user.googleRefreshToken, user.googleRefreshToken);

      const existingBackups = await this.listBackupsInDrive(driveService, backupFolderId);

      if (existingBackups.length > 0) {
        const mostRecentBackup = existingBackups[0];
        if (mostRecentBackup.modifiedTime) {
          const lastBackupDate = new Date(mostRecentBackup.modifiedTime);
          await settingsRepository.updateBackupDateWithTime(userId, lastBackupDate);
          logger.info('Updated lastBackupDate from existing backup folder', {
            userId,
            lastBackupDate: lastBackupDate.toISOString(),
          });
        }
      }

      return {
        hasBackupFolder: true,
        backupFolderId,
        existingBackups,
      };
    } catch (error) {
      logger.warn('Error accessing backup folder', {
        userId,
        backupFolderId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return { hasBackupFolder: false, existingBackups: [] };
    }
  }

  /**
   * Search for backup folder in Google Drive
   */
  private async searchForBackupFolder(userId: string): Promise<{
    hasBackupFolder: boolean;
    backupFolderId?: string;
    existingBackups: Array<{
      id: string;
      name: string;
      createdTime?: string;
      modifiedTime?: string;
      size?: string;
    }>;
  }> {
    try {
      const user = await this.getUserWithToken(userId);

      const { GoogleDriveService } = await import('./integrations/google-drive');
      const driveService = new GoogleDriveService(user.googleRefreshToken, user.googleRefreshToken);

      const folderStructure = await driveService.createVroomFolderStructure(user.displayName);
      const backupFolderId = folderStructure.subFolders.backups.id;
      const existingBackups = await this.listBackupsInDrive(driveService, backupFolderId);

      await settingsRepository.updateBackupFolderId(userId, backupFolderId);

      if (existingBackups.length > 0) {
        const mostRecentBackup = existingBackups[0];
        if (mostRecentBackup.modifiedTime) {
          const lastBackupDate = new Date(mostRecentBackup.modifiedTime);
          await settingsRepository.updateBackupDateWithTime(userId, lastBackupDate);
          logger.info('Updated lastBackupDate from search', {
            userId,
            lastBackupDate: lastBackupDate.toISOString(),
          });
        }
      }

      return {
        hasBackupFolder: true,
        backupFolderId,
        existingBackups,
      };
    } catch (error) {
      logger.warn('Error searching for backup folder', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return { hasBackupFolder: false, existingBackups: [] };
    }
  }

  /**
   * Sync data to Google Sheets
   */
  async syncToSheets(userId: string): Promise<SheetsSyncResult> {
    logger.info('Starting Google Sheets sync', { userId });

    const settings = await settingsRepository.getByUserId(userId);

    if (!settings || !settings.googleSheetsSyncEnabled) {
      throw new SyncError(
        SyncErrorCode.VALIDATION_ERROR,
        'Google Sheets sync is not enabled for this user'
      );
    }

    const user = await this.getUserWithToken(userId);

    try {
      const sheetsService = new GoogleSheetsService(
        user.googleRefreshToken,
        user.googleRefreshToken
      );

      const spreadsheetInfo = await sheetsService.createOrUpdateVroomSpreadsheet(
        userId,
        user.displayName
      );

      await settingsRepository.updateSyncDate(userId, spreadsheetInfo.id);

      logger.info('Google Sheets sync completed', { userId, spreadsheetId: spreadsheetInfo.id });

      return {
        spreadsheetId: spreadsheetInfo.id,
        webViewLink: spreadsheetInfo.webViewLink,
        lastSyncDate: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('Google Sheets sync failed', {
        userId,
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
        SyncErrorCode.NETWORK_ERROR,
        'Failed to sync to Google Sheets',
        error instanceof Error ? error.message : 'Unknown error'
      );
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
    const db = databaseService.getDatabase();
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

// ============================================================================
// SYNC ORCHESTRATOR CLASS
// ============================================================================

/**
 * ⚠️ PRODUCTION WARNING:
 * The sync lock is an in-memory implementation that will NOT work correctly in:
 * - Multi-instance deployments (horizontal scaling)
 * - Serverless environments (state is lost between invocations)
 * - Load-balanced setups (locks are not shared across instances)
 *
 * For production, replace with:
 * - Redis (recommended): Use SET NX EX for atomic lock acquisition
 * - Database-based locks: Use SELECT FOR UPDATE or advisory locks
 * - Distributed lock service: e.g., etcd, Consul
 */
export class SyncOrchestrator {
  private locks = new Map<string, { timestamp: number; ttl: number }>();
  private cleanupInterval: Timer | null = null;

  constructor() {
    // Clean up expired locks every minute
    this.cleanupInterval = setInterval(() => this.cleanupLocks(), 60000);
  }

  /**
   * Acquire a sync lock for a user
   */
  async acquireLock(userId: string, ttl = 300000): Promise<boolean> {
    const existing = this.locks.get(userId);
    if (existing && Date.now() - existing.timestamp < existing.ttl) {
      return false;
    }

    this.locks.set(userId, { timestamp: Date.now(), ttl });
    return true;
  }

  /**
   * Release a sync lock for a user
   */
  releaseLock(userId: string): void {
    this.locks.delete(userId);
  }

  /**
   * Check if a user has an active sync lock
   */
  isLocked(userId: string): boolean {
    const existing = this.locks.get(userId);
    if (!existing) return false;
    return Date.now() - existing.timestamp < existing.ttl;
  }

  /**
   * Get the number of active locks
   */
  getActiveLockCount(): number {
    this.cleanupLocks();
    return this.locks.size;
  }

  /**
   * Clean up expired locks
   */
  private cleanupLocks(): void {
    const now = Date.now();
    for (const [userId, lock] of this.locks.entries()) {
      if (now - lock.timestamp >= lock.ttl) {
        this.locks.delete(userId);
      }
    }
  }

  /**
   * Destroy the orchestrator and clean up resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.locks.clear();
  }

  /**
   * Execute sync operations for specified types
   */
  async executeSync(
    userId: string,
    syncTypes: string[]
  ): Promise<{
    sheets?: SheetsSyncResult;
    backup?: BackupSyncResult;
    errors?: Record<string, string>;
  }> {
    logger.info('Executing sync operations', { userId, syncTypes });

    const syncPromises = syncTypes.map(async (type) => {
      if (type === 'sheets') {
        return { type: 'sheets', result: await googleSyncService.syncToSheets(userId) };
      }
      if (type === 'backup') {
        return {
          type: 'backup',
          result: await googleSyncService.uploadBackupToGoogleDrive(userId),
        };
      }
      throw new Error(`Unknown sync type: ${type}`);
    });

    const results = await Promise.allSettled(syncPromises);
    return this.collectSyncResults(results, syncTypes);
  }

  /**
   * Create a backup of user data
   */
  async createBackup(userId: string): Promise<BackupData> {
    logger.info('Creating backup via orchestrator', { userId });
    return backupService.createBackup(userId);
  }

  /**
   * Export backup as ZIP file
   */
  async exportBackupAsZip(userId: string): Promise<Buffer> {
    logger.info('Exporting backup as ZIP via orchestrator', { userId });
    return backupService.exportAsZip(userId);
  }

  /**
   * Upload backup to Google Drive
   */
  async uploadBackupToDrive(userId: string): Promise<BackupSyncResult> {
    logger.info('Uploading backup to Drive via orchestrator', { userId });
    const result = await googleSyncService.uploadBackupToGoogleDrive(userId);

    if (result.fileId) {
      await this.enforceBackupRetention(userId).catch((error) => {
        logger.warn('Failed to enforce backup retention policy', { userId, error });
      });
    }

    return result;
  }

  /**
   * List backups in Google Drive
   */
  async listDriveBackups(userId: string): Promise<
    Array<{
      id: string;
      name: string;
      size: string;
      createdTime: string;
      modifiedTime: string;
      webViewLink: string;
    }>
  > {
    logger.info('Listing Drive backups via orchestrator', { userId });

    const { getDriveServiceForUser } = await import('./integrations/drive-helper');
    const { SettingsRepository } = await import('../repositories/settings');

    const db = databaseService.getDatabase();
    const settingsRepo = new SettingsRepository(db);
    let settings = await settingsRepo.getByUserId(userId);

    if (!settings || !settings.googleDriveBackupFolderId) {
      logger.info('No backup folder ID found, checking for existing folder structure', { userId });
      const checkResult = await googleSyncService.checkExistingGoogleDriveBackups(userId);

      if (checkResult.hasBackupFolder && checkResult.backupFolderId) {
        settings = await settingsRepo.getByUserId(userId);
      } else {
        logger.info('No backup folder found', { userId });
        return [];
      }
    }

    if (!settings?.googleDriveBackupFolderId) {
      return [];
    }

    const driveService = await getDriveServiceForUser(userId);
    const backups = await googleSyncService.listBackupsInDrive(
      driveService,
      settings.googleDriveBackupFolderId
    );

    logger.info('Backups found', { userId, count: backups.length });
    return backups;
  }

  /**
   * Initialize Google Drive folder structure
   */
  async initializeDrive(userId: string): Promise<{
    folderStructure: {
      mainFolder: { id: string; name: string; webViewLink?: string };
      subFolders: {
        receipts: { id: string; name: string };
        maintenance: { id: string; name: string };
        photos: { id: string; name: string };
        backups: { id: string; name: string };
      };
    };
    existingBackups: Array<{
      id: string;
      name: string;
      createdTime?: string;
      modifiedTime?: string;
      size?: string;
    }>;
  }> {
    logger.info('Initializing Drive via orchestrator', { userId });
    return googleSyncService.initializeGoogleDriveForUser(userId);
  }

  /**
   * Check for existing Google Drive backups
   */
  async checkExistingDriveBackups(userId: string): Promise<{
    hasBackupFolder: boolean;
    backupFolderId?: string;
    existingBackups: Array<{
      id: string;
      name: string;
      createdTime?: string;
      modifiedTime?: string;
      size?: string;
    }>;
  }> {
    logger.info('Checking existing Drive backups via orchestrator', { userId });
    return googleSyncService.checkExistingGoogleDriveBackups(userId);
  }

  /**
   * Download backup file from Google Drive
   */
  async downloadBackupFromDrive(
    userId: string,
    fileId: string
  ): Promise<{
    buffer: Buffer;
    metadata: { name: string };
  }> {
    logger.info('Downloading backup from Drive via orchestrator', { userId, fileId });

    const { getDriveServiceForUser } = await import('./integrations/drive-helper');
    const driveService = await getDriveServiceForUser(userId);

    const buffer = await driveService.downloadFile(fileId);
    const metadata = await driveService.getFileMetadata(fileId);

    return { buffer, metadata };
  }

  /**
   * Delete backup file from Google Drive
   */
  async deleteBackupFromDrive(userId: string, fileId: string): Promise<void> {
    logger.info('Deleting backup from Drive via orchestrator', { userId, fileId });

    const { getDriveServiceForUser } = await import('./integrations/drive-helper');
    const driveService = await getDriveServiceForUser(userId);

    await driveService.deleteFile(fileId);
  }

  /**
   * Restore from backup file
   */
  async restoreFromBackup(
    userId: string,
    file: Buffer,
    mode: 'replace' | 'merge' | 'preview'
  ): Promise<RestoreResponse> {
    logger.info('Restoring from backup via orchestrator', { userId, mode });
    return restoreExecutor.restoreFromBackup(userId, file, mode);
  }

  /**
   * Restore from Google Sheets
   */
  async restoreFromSheets(
    userId: string,
    mode: 'replace' | 'merge' | 'preview'
  ): Promise<RestoreResponse> {
    logger.info('Restoring from Sheets via orchestrator', { userId, mode });
    return restoreExecutor.restoreFromSheets(userId, mode);
  }

  /**
   * Auto-restore from latest Google Drive backup
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
    logger.info('Auto-restoring from latest backup via orchestrator', { userId });
    return restoreExecutor.autoRestoreFromLatestBackup(userId);
  }

  /**
   * Sync data to Google Sheets
   */
  async syncToSheets(userId: string): Promise<SheetsSyncResult> {
    logger.info('Syncing to Sheets via orchestrator', { userId });
    return googleSyncService.syncToSheets(userId);
  }

  /**
   * Enforce backup retention policy
   */
  private async enforceBackupRetention(userId: string): Promise<void> {
    logger.info('Enforcing backup retention policy', { userId });

    const backups = await this.listDriveBackups(userId);

    if (backups.length <= BACKUP_CONFIG.DEFAULT_RETENTION_COUNT) {
      logger.info('Backup count within retention limit', {
        userId,
        count: backups.length,
        limit: BACKUP_CONFIG.DEFAULT_RETENTION_COUNT,
      });
      return;
    }

    const sortedBackups = backups.sort(
      (a, b) => new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime()
    );

    const backupsToDelete = sortedBackups.slice(BACKUP_CONFIG.DEFAULT_RETENTION_COUNT);

    logger.info('Deleting old backups', {
      userId,
      totalBackups: backups.length,
      toDelete: backupsToDelete.length,
    });

    for (const backup of backupsToDelete) {
      try {
        await this.deleteBackupFromDrive(userId, backup.id);
        logger.info('Deleted old backup', { userId, backupId: backup.id, name: backup.name });
      } catch (error) {
        logger.error('Failed to delete old backup', {
          userId,
          backupId: backup.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }

  /**
   * Collect results from Promise.allSettled
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Result collection requires checking multiple result types
  private collectSyncResults(
    results: PromiseSettledResult<{ type: string; result: SheetsSyncResult | BackupSyncResult }>[],
    syncTypes: string[]
  ): {
    sheets?: SheetsSyncResult;
    backup?: BackupSyncResult;
    errors?: Record<string, string>;
  } {
    const response: {
      sheets?: SheetsSyncResult;
      backup?: BackupSyncResult;
      errors?: Record<string, string>;
    } = {};

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { type, result: syncResult } = result.value;
        if (type === 'sheets') {
          response.sheets = syncResult as SheetsSyncResult;
        } else if (type === 'backup') {
          response.backup = syncResult as BackupSyncResult;
        }
      } else {
        const errorMessage =
          result.reason instanceof Error ? result.reason.message : String(result.reason);
        const failedIndex = results.indexOf(result);
        const failedType = syncTypes[failedIndex] || 'unknown';

        if (!response.errors) {
          response.errors = {};
        }
        response.errors[failedType] = errorMessage;
      }
    }

    return response;
  }
}

// ============================================================================
// EXPORTED INSTANCES
// ============================================================================

export const backupService = new BackupService();
export const googleSyncService = new GoogleSyncService();
export const syncOrchestrator = new SyncOrchestrator();
