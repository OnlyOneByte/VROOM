/**
 * Backup Service
 *
 * Handles backup creation, parsing, and validation for VROOM data.
 * Extracted from lib/services/sync.ts
 */

import AdmZip from 'adm-zip';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { eq, getTableColumns } from 'drizzle-orm';
import type { SQLiteTableWithColumns } from 'drizzle-orm/sqlite-core';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';
import {
  CONFIG,
  getBackupTableKeys,
  getRequiredBackupFiles,
  TABLE_FILENAME_MAP,
  TABLE_SCHEMA_MAP,
} from '../config';
import { getDb } from '../db/connection';
import {
  type Expense,
  expenses,
  type InsurancePolicy,
  insurancePolicies,
  type Vehicle,
  type VehicleFinancing,
  type VehicleFinancingPayment,
  vehicleFinancing,
  vehicleFinancingPayments,
  vehicles,
} from '../db/schema';
import type { BackupData, BackupMetadata, ParsedBackupData } from '../types';
import { logger } from '../utils/logger';

// ============================================================================
// TYPES
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
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
   * Get all vehicles for a user
   */
  private async getUserVehicles(userId: string): Promise<Vehicle[]> {
    const db = getDb();
    return db.select().from(vehicles).where(eq(vehicles.userId, userId));
  }

  /**
   * Get all expenses for a user
   */
  private async getUserExpenses(userId: string): Promise<Expense[]> {
    const db = getDb();
    const results = await db
      .select()
      .from(expenses)
      .innerJoin(vehicles, eq(expenses.vehicleId, vehicles.id))
      .where(eq(vehicles.userId, userId));

    return results.map((r) => r.expenses);
  }

  /**
   * Get all financing for a user
   */
  private async getUserFinancing(userId: string): Promise<VehicleFinancing[]> {
    const db = getDb();
    const results = await db
      .select()
      .from(vehicleFinancing)
      .innerJoin(vehicles, eq(vehicleFinancing.vehicleId, vehicles.id))
      .where(eq(vehicles.userId, userId));

    return results.map((r) => r.vehicle_financing);
  }

  /**
   * Get all financing payments for a user
   */
  private async getUserFinancingPayments(userId: string): Promise<VehicleFinancingPayment[]> {
    const db = getDb();
    const results = await db
      .select()
      .from(vehicleFinancingPayments)
      .innerJoin(vehicleFinancing, eq(vehicleFinancingPayments.financingId, vehicleFinancing.id))
      .innerJoin(vehicles, eq(vehicleFinancing.vehicleId, vehicles.id))
      .where(eq(vehicles.userId, userId));

    return results.map((r) => r.vehicle_financing_payments);
  }

  /**
   * Get all insurance policies for a user
   */
  private async getUserInsurance(userId: string): Promise<InsurancePolicy[]> {
    const db = getDb();
    const results = await db
      .select()
      .from(insurancePolicies)
      .innerJoin(vehicles, eq(insurancePolicies.vehicleId, vehicles.id))
      .where(eq(vehicles.userId, userId));

    return results.map((r) => r.insurance_policies);
  }

  /**
   * Create a complete backup of user data
   */
  async createBackup(userId: string): Promise<BackupData> {
    logger.info('Creating backup', { userId });

    const [userVehicles, userExpenses, userFinancing, userFinancingPayments, userInsurance] =
      await Promise.all([
        this.getUserVehicles(userId),
        this.getUserExpenses(userId),
        this.getUserFinancing(userId),
        this.getUserFinancingPayments(userId),
        this.getUserInsurance(userId),
      ]);

    return {
      metadata: {
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        userId,
      },
      vehicles: userVehicles,
      expenses: userExpenses,
      financing: userFinancing,
      financingPayments: userFinancingPayments,
      insurance: userInsurance,
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
    if (backup.metadata.version !== CONFIG.backup.currentVersion) {
      errors.push(
        `Version mismatch: expected ${CONFIG.backup.currentVersion}, got ${backup.metadata.version}`
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
    if (size > CONFIG.backup.maxFileSize) {
      return {
        valid: false,
        errors: [
          `File size ${size} bytes exceeds maximum allowed size of ${CONFIG.backup.maxFileSize} bytes`,
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

// Export singleton instance
export const backupService = new BackupService();
