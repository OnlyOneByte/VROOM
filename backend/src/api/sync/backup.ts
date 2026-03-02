/**
 * Backup Service - Creates, parses, and validates VROOM data backups
 */

import AdmZip from 'adm-zip';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { eq, getTableColumns } from 'drizzle-orm';
import type { SQLiteTableWithColumns } from 'drizzle-orm/sqlite-core';
import { createInsertSchema } from 'drizzle-zod';
import type { z } from 'zod';
import {
  CONFIG,
  getBackupTableKeys,
  getRequiredBackupFiles,
  TABLE_FILENAME_MAP,
  TABLE_SCHEMA_MAP,
} from '../../config';
import { getDb } from '../../db/connection';
import {
  expenses,
  insurancePolicies,
  insurancePolicyVehicles,
  vehicleFinancing,
  vehicles,
} from '../../db/schema';
import type { BackupData, BackupMetadata, ParsedBackupData } from '../../types';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// biome-ignore lint/suspicious/noExplicitAny: Zod schema type is complex
const TABLE_SCHEMAS: Record<string, z.ZodObject<any>> = {};
for (const [key, table] of Object.entries(TABLE_SCHEMA_MAP)) {
  TABLE_SCHEMAS[key] = createInsertSchema(table);
}

/**
 * Schema-aware row coercion using Drizzle column metadata.
 * Converts string values from CSV/Sheets into proper JS types (Date, boolean, number, JSON).
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Column type coercion requires checking multiple SQLite column types
export function coerceRow(
  row: Record<string, unknown>,
  // biome-ignore lint/suspicious/noExplicitAny: Generic table type from Drizzle
  table: SQLiteTableWithColumns<any>
): Record<string, unknown> {
  const columns = getTableColumns(table);
  const coerced: Record<string, unknown> = { ...row };

  for (const [columnName, column] of Object.entries(columns)) {
    const val = coerced[columnName];
    if (val === undefined || val === null) continue;
    const strVal = String(val);
    if (strVal === '' || strVal === 'null' || strVal === 'NULL' || strVal === 'undefined') {
      coerced[columnName] = null;
      continue;
    }

    // biome-ignore lint/suspicious/noExplicitAny: Drizzle column type is not fully exposed
    const col = column as any;

    if (col.columnType === 'SQLiteTimestamp') {
      const date = new Date(strVal);
      coerced[columnName] = Number.isNaN(date.getTime()) ? null : date;
    } else if (col.columnType === 'SQLiteBoolean') {
      coerced[columnName] = strVal === 'true' || strVal === '1' || strVal === 'TRUE';
    } else if (col.columnType === 'SQLiteTextJson') {
      try {
        coerced[columnName] = JSON.parse(strVal);
      } catch {
        coerced[columnName] = null;
      }
    } else if (col.columnType === 'SQLiteInteger') {
      const num = Number.parseInt(strVal, 10);
      coerced[columnName] = Number.isNaN(num) ? null : num;
    } else if (col.columnType === 'SQLiteReal') {
      const num = Number.parseFloat(strVal);
      coerced[columnName] = Number.isNaN(num) ? null : num;
    }
  }

  return coerced;
}

export class BackupService {
  private getColumnNames(table: Parameters<typeof getTableColumns>[0]): string[] {
    return Object.keys(getTableColumns(table));
  }

  async createBackup(userId: string): Promise<BackupData> {
    const db = getDb();
    const [userVehicles, userExpenses, userFinancing, userInsurance] = await Promise.all([
      db.select().from(vehicles).where(eq(vehicles.userId, userId)),
      db
        .select()
        .from(expenses)
        .innerJoin(vehicles, eq(expenses.vehicleId, vehicles.id))
        .where(eq(vehicles.userId, userId))
        .then((r) => r.map((x) => x.expenses)),
      db
        .select()
        .from(vehicleFinancing)
        .innerJoin(vehicles, eq(vehicleFinancing.vehicleId, vehicles.id))
        .where(eq(vehicles.userId, userId))
        .then((r) => r.map((x) => x.vehicle_financing)),
      db
        .select()
        .from(insurancePolicies)
        .innerJoin(
          insurancePolicyVehicles,
          eq(insurancePolicies.id, insurancePolicyVehicles.policyId)
        )
        .innerJoin(vehicles, eq(insurancePolicyVehicles.vehicleId, vehicles.id))
        .where(eq(vehicles.userId, userId))
        .then((r) => r.map((x) => x.insurance_policies)),
    ]);

    return {
      metadata: { version: '1.0.0', timestamp: new Date().toISOString(), userId },
      vehicles: userVehicles,
      expenses: userExpenses,
      financing: userFinancing,
      insurance: userInsurance,
    };
  }

  async exportAsZip(userId: string): Promise<Buffer> {
    const backup = await this.createBackup(userId);
    const zip = new AdmZip();

    zip.addFile('metadata.json', Buffer.from(JSON.stringify(backup.metadata, null, 2), 'utf-8'));

    for (const key of Object.keys(backup)) {
      if (key === 'metadata') continue;
      const table = TABLE_SCHEMA_MAP[key];
      const filename = TABLE_FILENAME_MAP[key];
      if (table && filename) {
        const data = backup[key as keyof BackupData] as Record<string, unknown>[];
        const csv = this.convertToCSV(data, this.getColumnNames(table));
        zip.addFile(filename, Buffer.from(csv, 'utf-8'));
      }
    }

    return zip.toBuffer();
  }

  private convertToCSV(data: Record<string, unknown>[], columns: string[]): string {
    if (data.length === 0) return `${columns.join(',')}\n`;

    const formattedData = data.map((item) => {
      const row: Record<string, unknown> = {};
      for (const col of columns) {
        const value = item[col];
        row[col] =
          value === null || value === undefined
            ? ''
            : value instanceof Date
              ? value.toISOString()
              : value;
      }
      return row;
    });

    return stringify(formattedData, { header: true, columns, quoted: true, quoted_empty: false });
  }

  async parseZipBackup(file: Buffer): Promise<ParsedBackupData> {
    const zip = new AdmZip(file);
    const zipEntries = zip.getEntries();
    const fileNames = zipEntries.map((entry) => entry.entryName);
    const missingFiles = getRequiredBackupFiles().filter((file) => !fileNames.includes(file));

    if (missingFiles.length > 0) {
      throw new Error(`Missing required files: ${missingFiles.join(', ')}`);
    }

    const metadataEntry = zip.getEntry('metadata.json');
    if (!metadataEntry) {
      throw new Error('metadata.json not found');
    }

    const metadata = JSON.parse(metadataEntry.getData().toString('utf-8')) as BackupMetadata;

    const getCSVData = (fileName: string): Record<string, unknown>[] => {
      const entry = zip.getEntry(fileName);
      if (!entry) return [];
      return this.parseCSV(entry.getData().toString('utf-8'));
    };

    const parsedData: ParsedBackupData = { metadata } as ParsedBackupData;
    for (const [key, filename] of Object.entries(TABLE_FILENAME_MAP)) {
      const table = TABLE_SCHEMA_MAP[key];
      const rawRows = getCSVData(filename);
      const coercedRows = table ? rawRows.map((row) => this.coerceCSVRow(row, table)) : rawRows;
      // biome-ignore lint/suspicious/noExplicitAny: Dynamic key assignment
      parsedData[key as keyof ParsedBackupData] = coercedRows as any;
    }

    return parsedData;
  }

  private parseCSV(csvContent: string): Record<string, unknown>[] {
    if (!csvContent.trim()) return [];
    return parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_quotes: true,
      escape: '"',
      quote: '"',
    }) as Record<string, string>[];
  }
  private coerceCSVRow(
    row: Record<string, unknown>,
    // biome-ignore lint/suspicious/noExplicitAny: Generic table type from Drizzle
    table: SQLiteTableWithColumns<any>
  ): Record<string, unknown> {
    return coerceRow(row, table);
  }

  validateBackupData(backup: ParsedBackupData): ValidationResult {
    const errors: string[] = [];

    if (!backup.metadata?.userId || !backup.metadata?.version) {
      errors.push('Invalid metadata');
    }

    if (backup.metadata.version !== CONFIG.backup.currentVersion) {
      errors.push(
        `Version mismatch: expected ${CONFIG.backup.currentVersion}, got ${backup.metadata.version}`
      );
    }

    for (const key of getBackupTableKeys()) {
      const schema = TABLE_SCHEMAS[key];
      const data = backup[key as keyof ParsedBackupData] as Record<string, unknown>[];
      if (schema) {
        errors.push(...this.validateArray(data, schema, key));
      }
    }

    errors.push(...this.validateReferentialIntegrity(backup));
    return { valid: errors.length === 0, errors };
  }

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

  private validateReferentialIntegrity(backup: ParsedBackupData): string[] {
    const errors: string[] = [];
    const vehicleIds = new Set(backup.vehicles.map((v) => String(v.id)));

    for (const expense of backup.expenses) {
      if (!vehicleIds.has(String(expense.vehicleId))) {
        errors.push(`Expense ${expense.id} references non-existent vehicle`);
      }
    }

    for (const financing of backup.financing) {
      if (!vehicleIds.has(String(financing.vehicleId))) {
        errors.push(`Financing ${financing.id} references non-existent vehicle`);
      }
    }

    for (const insurance of backup.insurance) {
      // New schema: insurance policies don't have a direct vehicleId
      // They link to vehicles via the junction table, so skip vehicleId check here
      if (!insurance.id) {
        errors.push('Insurance policy missing id');
      }
    }

    return errors;
  }

  validateFileSize(size: number): ValidationResult {
    return size > CONFIG.backup.maxFileSize
      ? {
          valid: false,
          errors: [`File size exceeds maximum of ${CONFIG.backup.maxFileSize} bytes`],
        }
      : { valid: true, errors: [] };
  }

  validateUserId(backupUserId: string, requestUserId: string): ValidationResult {
    return backupUserId !== requestUserId
      ? { valid: false, errors: ['Backup belongs to different user'] }
      : { valid: true, errors: [] };
  }
}

export const backupService = new BackupService();
