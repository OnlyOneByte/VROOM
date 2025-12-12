/**
 * Backup Service - Unified backup creation, parsing, and validation
 *
 * ARCHITECTURAL DECISION: Merged Backup Operations
 * =================================================
 * This service consolidates three previously separate files:
 * - backup-creator.ts (backup creation and export)
 * - backup-parser.ts (ZIP and CSV parsing)
 * - backup-validator.ts (backup data validation)
 *
 * Why merge?
 * - These operations are always used together
 * - Shared dependencies and types
 * - Eliminates duplicate code (CSV handling, validation patterns)
 * - Single cohesive service is easier to understand
 * - Reduces file count without losing clarity
 *
 * Responsibilities:
 * - Create backups from user data
 * - Export backups as ZIP files
 * - Parse ZIP backups into structured data
 * - Validate backup data integrity
 * - Handle CSV conversion for all entity types
 */

import AdmZip from 'adm-zip';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { getTableColumns } from 'drizzle-orm';
import type { SQLiteTableWithColumns } from 'drizzle-orm/sqlite-core';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';
import {
  BACKUP_CONFIG,
  getBackupTableKeys,
  getRequiredBackupFiles,
  TABLE_FILENAME_MAP,
  TABLE_SCHEMA_MAP,
} from '../../constants/sync';
import { databaseService } from '../../core/database';
import { BackupRepository } from '../../repositories/backup';
import type { BackupData, BackupMetadata, ParsedBackupData } from '../../types/sync';
import { logger } from '../../utils/logger';

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
 * Detects integer columns with 'timestamp' mode and makes them accept string or Date
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
    // Check if it's a timestamp column (integer with timestamp mode)
    if (col.columnType === 'SQLiteInteger' && col.config?.mode === 'timestamp') {
      const isOptional = col.notNull === false || col.hasDefault;
      overrides[columnName] = flexibleTimestamp(isOptional, false);
    }
  }

  return overrides;
}

/**
 * Dynamically generate Zod schemas for all tables in TABLE_SCHEMA_MAP
 * These schemas automatically stay in sync with the database schema
 */
// biome-ignore lint/suspicious/noExplicitAny: Zod schema type is complex and requires any
const TABLE_SCHEMAS: Record<string, z.ZodObject<any>> = {};
for (const [key, table] of Object.entries(TABLE_SCHEMA_MAP)) {
  TABLE_SCHEMAS[key] = createInsertSchema(table, generateTimestampOverrides(table));
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export class BackupService {
  // ============================================================================
  // BACKUP CREATION
  // ============================================================================

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

    // Get database instance at runtime to ensure we use the test database if set
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

    // Dynamically add CSV files for each data property (excluding metadata)
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
   * Convert array of objects to CSV using proper CSV library
   */
  private convertToCSV(data: Record<string, unknown>[], columns: string[]): string {
    if (data.length === 0) {
      return `${columns.join(',')}\n`;
    }

    // Prepare data with proper formatting
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

    // Use csv-stringify for proper CSV generation
    return stringify(formattedData, {
      header: true,
      columns,
      quoted: true,
      quoted_empty: false,
    });
  }

  // ============================================================================
  // BACKUP PARSING
  // ============================================================================

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

      // Parse CSV files using proper CSV parser
      const getCSVData = (fileName: string): Record<string, unknown>[] => {
        const entry = zip.getEntry(fileName);
        if (!entry) return [];
        const content = entry.getData().toString('utf-8');
        return this.parseCSV(content);
      };

      // Dynamically parse all CSV files based on TABLE_FILENAME_MAP
      const parsedData: ParsedBackupData = {
        metadata,
      } as ParsedBackupData;

      for (const [key, filename] of Object.entries(TABLE_FILENAME_MAP)) {
        // biome-ignore lint/suspicious/noExplicitAny: Dynamic key assignment requires any
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
   * Parse CSV content using proper CSV parser that handles quoted values
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

  // ============================================================================
  // BACKUP VALIDATION
  // ============================================================================

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

    // Dynamically validate all tables
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
    // biome-ignore lint/suspicious/noExplicitAny: Zod schema type is complex and requires any
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

export const backupService = new BackupService();
