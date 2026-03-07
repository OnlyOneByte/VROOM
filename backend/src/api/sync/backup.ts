/**
 * Backup Service - Creates, parses, and validates VROOM data backups
 */

import AdmZip from 'adm-zip';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { and, eq, getTableColumns, inArray } from 'drizzle-orm';
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
  expenseGroups,
  expenses,
  insurancePolicies,
  insurancePolicyVehicles,
  odometerEntries,
  photoRefs,
  photos,
  vehicleFinancing,
  vehicles,
} from '../../db/schema';
import { ValidationError } from '../../errors';
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
    // biome-ignore lint/suspicious/noExplicitAny: Drizzle column type is not fully exposed
    const col = column as any;
    const val = coerced[columnName];

    if (val === undefined || val === null) {
      // Missing column (undefined) on NOT NULL boolean: use schema default (e.g., trackFuel defaults to true)
      // Explicit null: also use schema default for NOT NULL booleans
      if (col.columnType === 'SQLiteBoolean') {
        coerced[columnName] = val === undefined ? (col.default ?? false) : false;
      }
      continue;
    }
    const strVal = String(val);
    if (strVal === '' || strVal === 'null' || strVal === 'NULL' || strVal === 'undefined') {
      // Empty/null-like string values: boolean defaults to false (value was present but empty)
      coerced[columnName] = col.columnType === 'SQLiteBoolean' ? false : null;
      continue;
    }

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
    } else if (col.columnType === 'SQLiteText') {
      // Google Sheets may return numeric-looking text values (e.g., license plates) as numbers
      coerced[columnName] = strVal;
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
    const [
      userVehicles,
      userExpenses,
      userFinancing,
      userInsuranceJoined,
      userExpenseGroups,
      userOdometer,
    ] = await Promise.all([
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
        .where(eq(vehicles.userId, userId)),
      db.select().from(expenseGroups).where(eq(expenseGroups.userId, userId)),
      db
        .select()
        .from(odometerEntries)
        .innerJoin(vehicles, eq(odometerEntries.vehicleId, vehicles.id))
        .where(eq(vehicles.userId, userId))
        .then((r) => r.map((x) => x.odometer_entries)),
    ]);

    // Deduplicate insurance policies (join produces one row per vehicle)
    const seenPolicyIds = new Set<string>();
    const userInsurance = [];
    const userInsurancePolicyVehicles = [];
    for (const row of userInsuranceJoined) {
      if (!seenPolicyIds.has(row.insurance_policies.id)) {
        seenPolicyIds.add(row.insurance_policies.id);
        userInsurance.push(row.insurance_policies);
      }
      userInsurancePolicyVehicles.push(row.insurance_policy_vehicles);
    }

    // Collect all entity IDs to query photos for all user-owned entities
    const vehicleIds = userVehicles.map((v) => v.id);
    const expenseIds = userExpenses.map((e) => e.id);
    const policyIds = [...seenPolicyIds];
    const expenseGroupIds = userExpenseGroups.map((g) => g.id);
    const odometerEntryIds = userOdometer.map((o) => o.id);

    const userPhotos = await this.queryUserPhotos(db, {
      vehicleIds,
      expenseIds,
      policyIds,
      expenseGroupIds,
      odometerEntryIds,
    });

    // Query photo_refs for all user photos (batched to stay under SQLite variable limit)
    const photoIds = userPhotos.map((p) => p.id);
    const userPhotoRefs: (typeof photoRefs.$inferSelect)[] = [];
    const BATCH_SIZE = 500;
    for (let i = 0; i < photoIds.length; i += BATCH_SIZE) {
      const batch = photoIds.slice(i, i + BATCH_SIZE);
      const rows = await db.select().from(photoRefs).where(inArray(photoRefs.photoId, batch));
      userPhotoRefs.push(...rows);
    }

    return {
      metadata: { version: '1.0.0', timestamp: new Date().toISOString(), userId },
      vehicles: userVehicles,
      expenses: userExpenses,
      financing: userFinancing,
      insurance: userInsurance,
      insurancePolicyVehicles: userInsurancePolicyVehicles,
      expenseGroups: userExpenseGroups,
      odometer: userOdometer,
      photos: userPhotos,
      photoRefs: userPhotoRefs,
    };
  }

  /**
   * Query all photos belonging to a user's entities.
   * Photos use a polymorphic entityType/entityId pattern with no userId column,
   * so we query by each entity type's IDs separately.
   */
  private async queryUserPhotos(
    db: ReturnType<typeof getDb>,
    entityIds: {
      vehicleIds: string[];
      expenseIds: string[];
      policyIds: string[];
      expenseGroupIds: string[];
      odometerEntryIds: string[];
    }
  ) {
    const allPhotos = [];

    const entityQueries: { type: string; ids: string[] }[] = [
      { type: 'vehicle', ids: entityIds.vehicleIds },
      { type: 'expense', ids: entityIds.expenseIds },
      { type: 'insurance_policy', ids: entityIds.policyIds },
      { type: 'expense_group', ids: entityIds.expenseGroupIds },
      { type: 'odometer_entry', ids: entityIds.odometerEntryIds },
    ];

    for (const { type, ids } of entityQueries) {
      if (ids.length === 0) continue;
      const rows = await db
        .select()
        .from(photos)
        .where(and(eq(photos.entityType, type), inArray(photos.entityId, ids)));
      allPhotos.push(...rows);
    }

    return allPhotos;
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
        if (value === null || value === undefined) {
          row[col] = '';
        } else if (value instanceof Date) {
          row[col] = value.toISOString();
        } else if (typeof value === 'object') {
          // JSON columns (unitPreferences, terms, tags, splitConfig, etc.)
          // must be serialized as JSON strings, not [object Object]
          row[col] = JSON.stringify(value);
        } else {
          row[col] = value;
        }
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
      throw new ValidationError(`Missing required files: ${missingFiles.join(', ')}`);
    }

    const metadataEntry = zip.getEntry('metadata.json');
    if (!metadataEntry) {
      throw new ValidationError('metadata.json not found in backup archive');
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
    const vehicleIds = new Set(backup.vehicles.map((v) => String(v.id)));
    const policyIds = new Set(backup.insurance.map((i) => String(i.id)));
    const expenseGroupIds = new Set((backup.expenseGroups ?? []).map((g) => String(g.id)));
    const expenseIds = new Set(backup.expenses.map((e) => String(e.id)));
    const odometerIds = new Set((backup.odometer ?? []).map((o) => String(o.id)));
    const photoIds = new Set((backup.photos ?? []).map((p) => String(p.id)));

    return [
      ...this.validateExpenseRefs(backup.expenses, vehicleIds, expenseGroupIds),
      ...this.validateFinancingRefs(backup.financing, vehicleIds),
      ...this.validateInsuranceRefs(backup.insurance),
      ...this.validateJunctionRefs(backup.insurancePolicyVehicles ?? [], policyIds, vehicleIds),
      ...this.validateOdometerRefs(backup.odometer ?? [], vehicleIds),
      ...this.validatePhotoRefs(backup.photos ?? [], {
        vehicleIds,
        expenseIds,
        policyIds,
        expenseGroupIds,
        odometerIds,
      }),
      ...this.validatePhotoRefEntries(backup.photoRefs ?? [], photoIds),
    ];
  }

  private validateExpenseRefs(
    expenseList: Record<string, unknown>[],
    vehicleIds: Set<string>,
    expenseGroupIds: Set<string>
  ): string[] {
    const errors: string[] = [];
    for (const expense of expenseList) {
      if (!vehicleIds.has(String(expense.vehicleId))) {
        errors.push(`Expense ${expense.id} references non-existent vehicle`);
      }
      if (expense.expenseGroupId && !expenseGroupIds.has(String(expense.expenseGroupId))) {
        errors.push(`Expense ${expense.id} references non-existent expense group`);
      }
    }
    return errors;
  }

  private validateFinancingRefs(
    financingList: Record<string, unknown>[],
    vehicleIds: Set<string>
  ): string[] {
    const errors: string[] = [];
    for (const financing of financingList) {
      if (!vehicleIds.has(String(financing.vehicleId))) {
        errors.push(`Financing ${financing.id} references non-existent vehicle`);
      }
    }
    return errors;
  }

  private validateInsuranceRefs(insuranceList: Record<string, unknown>[]): string[] {
    const errors: string[] = [];
    for (const insurance of insuranceList) {
      if (!insurance.id) {
        errors.push('Insurance policy missing id');
      }
    }
    return errors;
  }

  private validateJunctionRefs(
    junctionList: Record<string, unknown>[],
    policyIds: Set<string>,
    vehicleIds: Set<string>
  ): string[] {
    const errors: string[] = [];
    for (const junction of junctionList) {
      if (!policyIds.has(String(junction.policyId))) {
        errors.push(`Insurance junction references non-existent policy ${junction.policyId}`);
      }
      if (!vehicleIds.has(String(junction.vehicleId))) {
        errors.push(`Insurance junction references non-existent vehicle ${junction.vehicleId}`);
      }
    }
    return errors;
  }

  private validateOdometerRefs(
    odometerList: Record<string, unknown>[],
    vehicleIds: Set<string>
  ): string[] {
    const errors: string[] = [];
    for (const entry of odometerList) {
      if (!vehicleIds.has(String(entry.vehicleId))) {
        errors.push(`Odometer entry ${entry.id} references non-existent vehicle`);
      }
    }
    return errors;
  }

  private validatePhotoRefs(
    photoList: Record<string, unknown>[],
    entityIds: {
      vehicleIds: Set<string>;
      expenseIds: Set<string>;
      policyIds: Set<string>;
      expenseGroupIds: Set<string>;
      odometerIds: Set<string>;
    }
  ): string[] {
    const errors: string[] = [];
    const entityTypeToIds: Record<string, Set<string>> = {
      vehicle: entityIds.vehicleIds,
      expense: entityIds.expenseIds,
      insurance_policy: entityIds.policyIds,
      expense_group: entityIds.expenseGroupIds,
      odometer_entry: entityIds.odometerIds,
    };

    for (const photo of photoList) {
      const entityType = String(photo.entityType);
      const entityId = String(photo.entityId);
      const idSet = entityTypeToIds[entityType];

      if (!idSet) {
        errors.push(`Photo ${photo.id} has unknown entity type: ${entityType}`);
      } else if (!idSet.has(entityId)) {
        errors.push(`Photo ${photo.id} references non-existent ${entityType} ${entityId}`);
      }
    }
    return errors;
  }

  private validatePhotoRefEntries(
    photoRefList: Record<string, unknown>[],
    photoIds: Set<string>
  ): string[] {
    const errors: string[] = [];
    for (const ref of photoRefList) {
      if (!photoIds.has(String(ref.photoId))) {
        errors.push(`PhotoRef ${ref.id} references non-existent photo ${ref.photoId}`);
      }
      // Note: providerId validation is skipped here because user_providers
      // are not included in the backup data (they contain encrypted credentials)
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
