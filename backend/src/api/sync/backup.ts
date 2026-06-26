/**
 * Backup Service - Creates, parses, and validates VROOM data backups
 */

import AdmZip from 'adm-zip';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import type { Table } from 'drizzle-orm';
import { and, eq, getTableColumns, inArray } from 'drizzle-orm';
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
import type { UserProvider } from '../../db/schema';
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
  vehicleFinancing,
  vehicles,
} from '../../db/schema';
import { ValidationError } from '../../errors';
import type {
  BackupConfig,
  BackupData,
  BackupFileInfo,
  BackupMetadata,
  ParsedBackupData,
  ProviderBackupList,
  ProviderBackupSettings,
} from '../../types';
import { logger } from '../../utils/logger';
import { joinStoragePath } from '../../utils/paths';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * The money columns that became integer-CENTS in migration 0009 (money-cents-migration §1), keyed by
 * their CAMELCASE drizzle field name (coerceRow + the CSV headers use the field name, not the snake_case
 * db column). A pre-cents backup (metadata.version < 2.0.0) stored these as DOLLAR floats; restoring it
 * into the cents schema must ×100 them, or coerceRow's INTEGER branch would `Math.round('12.34')` = 12
 * cents = $0.12, a silent 100× corruption (design §4, NORTH_STAR #1). A flat field-name set is safe:
 * coerceRow processes ONE table at a time, and no NON-money column shares any of these names (apr/volume/
 * businessMileageRate — the excluded reals — are all distinctly named).
 */
export const MONEY_CENTS_FIELDS = new Set<string>([
  'purchasePrice', // vehicles
  'originalAmount', // vehicleFinancing
  'paymentAmount', // vehicleFinancing + insuranceTerms (both money)
  'residualValue', // vehicleFinancing
  'excessMileageFee', // vehicleFinancing
  'deductibleAmount', // insuranceTerms
  'coverageLimit', // insuranceTerms
  'totalCost', // insuranceTerms
  'monthlyCost', // insuranceTerms
  'payoutAmount', // insuranceClaims
  'expenseAmount', // expenses + reminders (both money)
  'groupTotal', // expenses
]);

/**
 * A backup written under a schema where money was DOLLAR floats (everything before the 2.0.0 cents
 * schema). Such a backup must have its money columns ×100-shimmed on restore. Compares the MAJOR
 * version: anything < 2 is pre-cents. A version >= the current major we cannot shim (a future format) is
 * NOT pre-cents — it falls through to validateBackupData's fail-closed version check.
 */
export function isPreCentsBackup(version: string | undefined): boolean {
  const major = Number.parseInt(String(version ?? '').split('.')[0], 10);
  return Number.isFinite(major) && major < 2;
}

// biome-ignore lint/suspicious/noExplicitAny: Zod schema type is complex
const TABLE_SCHEMAS: Record<string, z.ZodObject<any>> = {};
for (const [key, table] of Object.entries(TABLE_SCHEMA_MAP)) {
  TABLE_SCHEMAS[key] = createInsertSchema(table);
}

/**
 * Schema-aware row coercion using Drizzle column metadata.
 * Converts string values from CSV/Sheets into proper JS types (Date, boolean, number, JSON).
 *
 * Column type sets are dialect-agnostic — supports both SQLite and PostgreSQL column types
 * so the backup pipeline works regardless of the underlying database.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Column type coercion requires checking multiple column types
export function coerceRow(
  row: Record<string, unknown>,
  table: Table,
  options?: { shimMoneyToCents?: boolean }
): Record<string, unknown> {
  const columns = getTableColumns(table);
  const coerced: Record<string, unknown> = { ...row };
  // Pre-cents (version < 2.0.0) backup: its money columns are DOLLAR floats but the post-0009 schema
  // declares them integer, so they route through the INTEGER branch below and would `Math.round('12.34')`
  // = 12 cents = $0.12 (a silent 100× loss). When this flag is set, the INTEGER branch ×100s a money
  // field instead (design §4 shim). A 2.0.0+ backup already stores cents → no shim (flag false).
  const shimMoneyToCents = options?.shimMoneyToCents ?? false;

  // Dialect-agnostic column type sets — add PG types here when adding PostgreSQL support
  const BOOLEAN_TYPES = new Set(['SQLiteBoolean', 'PgBoolean']);
  const TIMESTAMP_TYPES = new Set(['SQLiteTimestamp', 'PgTimestamp', 'PgTimestampString']);
  const JSON_TYPES = new Set(['SQLiteTextJson', 'PgJsonb', 'PgJson']);
  const INTEGER_TYPES = new Set(['SQLiteInteger', 'PgInteger', 'PgSerial', 'PgBigInt53']);
  const REAL_TYPES = new Set(['SQLiteReal', 'PgDoublePrecision', 'PgNumeric', 'PgReal']);
  const TEXT_TYPES = new Set(['SQLiteText', 'PgText', 'PgVarchar']);

  for (const [columnName, column] of Object.entries(columns)) {
    // biome-ignore lint/suspicious/noExplicitAny: Drizzle column type is not fully exposed
    const col = column as any;
    const val = coerced[columnName];

    // A NOT NULL column that carries a STATIC default: an absent/empty/null backup value must resolve to
    // that default, never to null — else the insert throws `NOT NULL constraint failed` and the WHOLE
    // restore aborts (the user can't recover ANY data from their own valid backup, NORTH_STAR #1). This is
    // the steering-doc `coerceRow` footgun (DatabaseMigrations.md): the boolean special-case below already
    // did exactly this (`col.default ?? false`); this generalizes it to every type (text `themePreference`/
    // `currencyUnit`/`backupFrequency`, JSON `unitPreferences`, integer `syncInactivityMinutes`, …). Gated
    // on a STATIC `default` (not a `$defaultFn` — those columns here are nullable, so they keep the null path).
    const hasStaticDefault = col.notNull && col.hasDefault && col.default !== undefined;

    if (val === undefined || val === null) {
      if (BOOLEAN_TYPES.has(col.columnType)) {
        coerced[columnName] = val === undefined ? (col.default ?? false) : false;
      } else if (hasStaticDefault) {
        // null (explicit) would violate NOT NULL; undefined (absent key) would also let the DB default
        // apply, but we set it explicitly so every restore path is uniform.
        coerced[columnName] = col.default;
      }
      continue;
    }
    const strVal = String(val);
    if (strVal === '' || strVal === 'null' || strVal === 'NULL' || strVal === 'undefined') {
      coerced[columnName] = BOOLEAN_TYPES.has(col.columnType)
        ? false
        : hasStaticDefault
          ? col.default
          : null;
      continue;
    }

    if (TIMESTAMP_TYPES.has(col.columnType)) {
      const date = new Date(strVal);
      coerced[columnName] = Number.isNaN(date.getTime()) ? null : date;
    } else if (BOOLEAN_TYPES.has(col.columnType)) {
      coerced[columnName] = strVal === 'true' || strVal === '1' || strVal === 'TRUE';
    } else if (JSON_TYPES.has(col.columnType)) {
      try {
        coerced[columnName] = JSON.parse(strVal);
      } catch {
        coerced[columnName] = null;
      }
    } else if (INTEGER_TYPES.has(col.columnType)) {
      // STRICT numeric parse, not Number.parseInt: parseInt stops at the first non-digit, so a
      // thousands-separated value the Google Sheets restore returns (default valueRenderOption is
      // FORMATTED_VALUE → a 12,345-mile odometer comes back as the string "12,345") would truncate
      // to 12 — silently, since 12 is not NaN — corrupting the reading 1000x (#68, NORTH_STAR #1).
      // Strip grouping commas, then require the WHOLE string to be numeric (Number(), unlike parseInt,
      // rejects a "12abc" tail to NaN → null, matching the existing garbage→null contract). Round so a
      // Sheets "12345.0" / a stray decimal lands on a whole number rather than truncating.
      const num = Number(strVal.replace(/,/g, ''));
      if (Number.isNaN(num)) {
        coerced[columnName] = null;
      } else if (shimMoneyToCents && MONEY_CENTS_FIELDS.has(columnName)) {
        // Pre-cents backup: this money value is DOLLARS (e.g. 12.34). Scale to integer cents (1234),
        // ROUND-before-int exactly like the 0009 migration (12.34*100 = 1233.9999… would truncate to
        // 1233 without the round). This is the design §4 recovery path: an old backup round-trips
        // CORRECTLY instead of becoming $0.12.
        coerced[columnName] = Math.round(num * 100);
      } else {
        coerced[columnName] = Math.round(num);
      }
    } else if (REAL_TYPES.has(col.columnType)) {
      // Same thousands-separator hazard: parseFloat("1,234.56") stops at the comma → 1. Strip grouping
      // commas + a strict whole-string parse (Number() → NaN on a garbage tail → null).
      const num = Number(strVal.replace(/,/g, ''));
      coerced[columnName] = Number.isNaN(num) ? null : num;
    } else if (TEXT_TYPES.has(col.columnType)) {
      // Google Sheets may return numeric-looking text values (e.g., license plates) as numbers
      coerced[columnName] = strVal;
    }
  }

  return coerced;
}

/**
 * Combines a provider's rootPath with the backup folder path from settings.
 */
export function resolveBackupFolderPath(
  providerRow: UserProvider,
  settings: ProviderBackupSettings
): string {
  const providerRootPath =
    ((providerRow.config as Record<string, unknown> | null)?.providerRootPath as string) ?? '';
  return joinStoragePath(providerRootPath, settings.folderPath);
}

export class BackupService {
  /**
   * Load BackupConfig from user settings and filter to enabled providers.
   */
  async loadBackupConfig(
    userId: string
  ): Promise<{ config: BackupConfig; enabledProviders: [string, ProviderBackupSettings][] }> {
    const { preferencesRepository } = await import('../settings/repository');
    const prefs = await preferencesRepository.getOrCreate(userId);
    const config: BackupConfig = prefs.backupConfig ?? { providers: {} };
    const enabledProviders = Object.entries(config.providers).filter(([_, s]) => s.enabled);
    return { config, enabledProviders };
  }

  /**
   * Enforce retention policy for a specific provider.
   * Lists backup files, sorts newest-first, deletes files beyond retentionCount.
   * Returns the count of actually deleted files (not attempted).
   */
  async enforceRetention(userId: string, providerId: string): Promise<number> {
    const { config } = await this.loadBackupConfig(userId);
    const settings = config.providers[providerId];
    if (!settings) return 0;

    const { storageProviderRegistry } = await import('../providers/domains/storage/registry');
    const provider = await storageProviderRegistry.getProvider(providerId, userId);

    const db = getDb();
    const { userProviders } = await import('../../db/schema');
    const providerRow = await db
      .select()
      .from(userProviders)
      .where(and(eq(userProviders.id, providerId), eq(userProviders.userId, userId)))
      .get();

    if (!providerRow) return 0;

    const folderPath = resolveBackupFolderPath(providerRow, settings);
    const files = await provider.list(folderPath);

    const backupFiles = files
      .filter((f) => f.name.startsWith('vroom-backup-') && f.name.endsWith('.zip'))
      .sort((a, b) => b.lastModified.localeCompare(a.lastModified));

    if (backupFiles.length <= settings.retentionCount) return 0;

    const toDelete = backupFiles.slice(settings.retentionCount);
    let deletedCount = 0;

    for (const file of toDelete) {
      try {
        await provider.delete({
          providerType: provider.type,
          externalId: file.key,
        });
        deletedCount++;
      } catch (error) {
        logger.warn('Failed to delete old backup', { key: file.key, error });
      }
    }

    return deletedCount;
  }

  /**
   * List backup files from a specific provider.
   * Filters to vroom-backup-*.zip, sorts newest-first, marks isLatest.
   */
  async listBackups(userId: string, providerId: string): Promise<BackupFileInfo[]> {
    const { storageProviderRegistry } = await import('../providers/domains/storage/registry');
    const provider = await storageProviderRegistry.getProvider(providerId, userId);

    const db = getDb();
    const { userProviders } = await import('../../db/schema');
    const providerRow = await db
      .select()
      .from(userProviders)
      .where(and(eq(userProviders.id, providerId), eq(userProviders.userId, userId)))
      .get();
    if (!providerRow) return [];

    const { config } = await this.loadBackupConfig(userId);
    const settings = config.providers[providerId];
    if (!settings) return [];

    const folderPath = resolveBackupFolderPath(providerRow, settings);
    const files = await provider.list(folderPath);

    const backups = files
      .filter((f) => f.name.startsWith('vroom-backup-') && f.name.endsWith('.zip'))
      .sort((a, b) => b.lastModified.localeCompare(a.lastModified))
      .map((f, i) => ({
        providerId,
        providerName: providerRow.displayName,
        providerType: providerRow.providerType,
        fileRef: f.key,
        fileName: f.name,
        size: f.size,
        createdTime: f.createdTime,
        isLatest: i === 0,
      }));

    return backups;
  }

  /**
   * List backup files from ALL backup-enabled providers.
   * Returns one ProviderBackupList per enabled provider with per-provider error handling.
   */
  async listAllBackups(userId: string): Promise<ProviderBackupList[]> {
    const { enabledProviders } = await this.loadBackupConfig(userId);
    const results: ProviderBackupList[] = [];

    for (const [providerId] of enabledProviders) {
      try {
        const backups = await this.listBackups(userId, providerId);

        const db = getDb();
        const { userProviders } = await import('../../db/schema');
        const providerRow = await db
          .select()
          .from(userProviders)
          .where(and(eq(userProviders.id, providerId), eq(userProviders.userId, userId)))
          .get();

        results.push({
          providerId,
          providerName: providerRow?.displayName ?? 'Unknown',
          providerType: providerRow?.providerType ?? 'unknown',
          backups,
        });
      } catch (error) {
        results.push({
          providerId,
          providerName: 'Unknown',
          providerType: 'unknown',
          backups: [],
          error: error instanceof Error ? error.message : 'Failed to list backups',
        });
      }
    }

    return results;
  }

  /**
   * Download a backup file from a specific provider.
   * Verifies ownership via storageProviderRegistry.getProvider().
   */
  async downloadBackup(userId: string, providerId: string, fileRef: string): Promise<Buffer> {
    const { storageProviderRegistry } = await import('../providers/domains/storage/registry');
    const provider = await storageProviderRegistry.getProvider(providerId, userId);
    return provider.download({ providerType: provider.type, externalId: fileRef });
  }

  private getColumnNames(table: Parameters<typeof getTableColumns>[0]): string[] {
    return Object.keys(getTableColumns(table));
  }

  async createBackup(userId: string): Promise<BackupData> {
    const db = getDb();
    const [userVehicles, userExpenses, userFinancing, userInsurance, userOdometer, userTrips] =
      await Promise.all([
        db.select().from(vehicles).where(eq(vehicles.userId, userId)),
        db.select().from(expenses).where(eq(expenses.userId, userId)),
        db
          .select()
          .from(vehicleFinancing)
          .innerJoin(vehicles, eq(vehicleFinancing.vehicleId, vehicles.id))
          .where(eq(vehicles.userId, userId))
          .then((r) => r.map((x) => x.vehicle_financing)),
        db.select().from(insurancePolicies).where(eq(insurancePolicies.userId, userId)),
        db
          .select()
          .from(odometerEntries)
          .innerJoin(vehicles, eq(odometerEntries.vehicleId, vehicles.id))
          .where(eq(vehicles.userId, userId))
          .then((r) => r.map((x) => x.odometer_entries)),
        // Trips are userId-stamped directly (like photos), so a plain userId scope is enough — but a
        // trip also carries vehicleId, exported verbatim for the restore referential-integrity check.
        db.select().from(trips).where(eq(trips.userId, userId)),
      ]);

    // Query insurance terms for user's policies
    const policyIds = userInsurance.map((p) => p.id);
    const userInsuranceTerms =
      policyIds.length > 0
        ? await db.select().from(insuranceTerms).where(inArray(insuranceTerms.policyId, policyIds))
        : [];

    // Query junction rows for user's insurance terms
    const termIds = userInsuranceTerms.map((t) => t.id);
    const userInsuranceTermVehicles =
      termIds.length > 0
        ? await db
            .select()
            .from(insuranceTermVehicles)
            .where(inArray(insuranceTermVehicles.termId, termIds))
        : [];

    // Query insurance claims for user's policies
    const userInsuranceClaims =
      policyIds.length > 0
        ? await db
            .select()
            .from(insuranceClaims)
            .where(inArray(insuranceClaims.policyId, policyIds))
        : [];

    // Query photos directly by userId
    const userPhotos = await db.select().from(photos).where(eq(photos.userId, userId));

    // Query photo_refs for all user photos (batched to stay under SQLite variable limit)
    const photoIds = userPhotos.map((p) => p.id);
    const userPhotoRefs: (typeof photoRefs.$inferSelect)[] = [];
    const BATCH_SIZE = 500;
    for (let i = 0; i < photoIds.length; i += BATCH_SIZE) {
      const batch = photoIds.slice(i, i + BATCH_SIZE);
      const rows = await db.select().from(photoRefs).where(inArray(photoRefs.photoId, batch));
      userPhotoRefs.push(...rows);
    }

    // Query user preferences and sync state
    const userPreferencesRows = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId));
    const syncStateRows = await db.select().from(syncState).where(eq(syncState.userId, userId));

    // Query reminders, reminder_vehicles, and reminder_notifications
    const userReminders = await db.select().from(reminders).where(eq(reminders.userId, userId));

    const reminderIds = userReminders.map((r) => r.id);
    const userReminderVehicles =
      reminderIds.length > 0
        ? await db
            .select()
            .from(reminderVehicles)
            .where(inArray(reminderVehicles.reminderId, reminderIds))
        : [];

    const userReminderNotifications = await db
      .select()
      .from(reminderNotifications)
      .where(eq(reminderNotifications.userId, userId));

    return {
      metadata: {
        version: CONFIG.backup.currentVersion,
        timestamp: new Date().toISOString(),
        userId,
      },
      vehicles: userVehicles,
      expenses: userExpenses,
      financing: userFinancing,
      insurance: userInsurance,
      insuranceTerms: userInsuranceTerms,
      insuranceTermVehicles: userInsuranceTermVehicles,
      insuranceClaims: userInsuranceClaims,
      odometer: userOdometer,
      photos: userPhotos,
      photoRefs: userPhotoRefs,
      userPreferences: userPreferencesRows,
      syncState: syncStateRows,
      reminders: userReminders,
      reminderVehicles: userReminderVehicles,
      reminderNotifications: userReminderNotifications,
      trips: userTrips,
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

    // Zip-bomb guard: bodyLimit caps the COMPRESSED upload, but getData() below
    // inflates each entry. Sum the uncompressed sizes (read from the ZIP central
    // directory — no inflation) and reject before decompressing anything if the
    // total exceeds the cap. A real backup is CSV text well under this; a bomb is
    // far over. (header.size is the uncompressed byte count for each entry.)
    //
    // #22: header.size is ATTACKER-DECLARED, so a bomb can lie (declare a small size to
    // pass the sum below, then inflate to GB on getData()). Guard the COMPRESSION RATIO
    // per entry FIRST — compressedSize is the real in-file byte count, and the declared
    // size being an absurd multiple of it is a bomb signature the sum can't catch. This
    // runs before any getData(), so a crafted entry is rejected without inflating.
    for (const e of zipEntries) {
      const compressed = e.header?.compressedSize ?? 0;
      const uncompressed = e.header?.size ?? 0;
      if (compressed > 0 && uncompressed / compressed > CONFIG.backup.maxCompressionRatio) {
        throw new ValidationError(
          `Backup archive entry "${e.entryName}" has a suspicious compression ratio ` +
            `(${Math.round(uncompressed / compressed)}x exceeds the ${CONFIG.backup.maxCompressionRatio}x limit) — possible zip bomb`
        );
      }
    }

    const totalUncompressed = zipEntries.reduce((sum, e) => sum + (e.header?.size ?? 0), 0);
    if (totalUncompressed > CONFIG.backup.maxUncompressedSize) {
      throw new ValidationError(
        `Backup archive is too large when decompressed (${totalUncompressed} bytes exceeds the ${CONFIG.backup.maxUncompressedSize}-byte limit)`
      );
    }

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

    // A pre-cents (version < 2.0.0) backup stored money as DOLLAR floats; the post-0009 schema declares
    // those columns integer, so they must be ×100-shimmed to CENTS during coercion or coerceRow's integer
    // branch silently 100×-undercounts them (design §4). After a successful shim the in-memory data IS in
    // the cents (2.0.0) format, so its version is upgraded to match — that is what lets validateBackupData
    // (which fail-closes on a version mismatch) accept this recovered backup. A version we can NOT shim
    // (a future major) leaves the version untouched → validateBackupData rejects it (fail-closed default).
    const shimMoneyToCents = isPreCentsBackup(metadata.version);

    const getCSVData = (fileName: string): Record<string, unknown>[] => {
      const entry = zip.getEntry(fileName);
      if (!entry) return [];
      return this.parseCSV(entry.getData().toString('utf-8'));
    };

    const parsedData: ParsedBackupData = { metadata } as ParsedBackupData;
    for (const [key, filename] of Object.entries(TABLE_FILENAME_MAP)) {
      const table = TABLE_SCHEMA_MAP[key];
      const rawRows = getCSVData(filename);
      const coercedRows = table
        ? rawRows.map((row) => this.coerceCSVRow(row, table, shimMoneyToCents))
        : rawRows;
      // biome-ignore lint/suspicious/noExplicitAny: Dynamic key assignment
      parsedData[key as keyof ParsedBackupData] = coercedRows as any;
    }

    if (shimMoneyToCents) {
      parsedData.metadata = { ...metadata, version: CONFIG.backup.currentVersion };
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
    table: Table,
    shimMoneyToCents = false
  ): Record<string, unknown> {
    return coerceRow(row, table, { shimMoneyToCents });
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
      const data = backup[key as keyof ParsedBackupData] as Record<string, unknown>[] | undefined;
      if (schema && data) {
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
    const userIds = new Set([backup.metadata.userId]);
    const vehicleIds = new Set(backup.vehicles.map((v) => String(v.id)));
    const policyIds = new Set(backup.insurance.map((i) => String(i.id)));
    const termIds = new Set((backup.insuranceTerms ?? []).map((t) => String(t.id)));
    const expenseIds = new Set(backup.expenses.map((e) => String(e.id)));
    const odometerIds = new Set((backup.odometer ?? []).map((o) => String(o.id)));
    const claimIds = new Set((backup.insuranceClaims ?? []).map((c) => String(c.id)));
    const photoIds = new Set((backup.photos ?? []).map((p) => String(p.id)));
    const reminderIds = new Set((backup.reminders ?? []).map((r) => String(r.id)));

    return [
      ...this.validateExpenseRefs(backup.expenses, vehicleIds, userIds),
      ...this.validateExpenseSourceRefs(backup.expenses, reminderIds),
      ...this.validateFinancingRefs(backup.financing, vehicleIds),
      ...this.validateInsuranceRefs(backup.insurance),
      ...this.validateInsuranceTermRefs(backup.insuranceTerms ?? [], policyIds),
      ...this.validateTermVehicleJunctionRefs(
        backup.insuranceTermVehicles ?? [],
        termIds,
        vehicleIds
      ),
      ...this.validateClaimRefs(backup.insuranceClaims ?? [], policyIds, termIds, vehicleIds),
      ...this.validateOdometerRefs(backup.odometer ?? [], vehicleIds),
      ...this.validateTripRefs(backup.trips ?? [], vehicleIds),
      ...this.validatePhotoRefs(backup.photos ?? [], {
        vehicleIds,
        expenseIds,
        policyIds,
        claimIds,
        odometerIds,
      }),
      ...this.validatePhotoRefEntries(backup.photoRefs ?? [], photoIds),
      ...this.validateReminderRefs(backup.reminders ?? [], userIds),
      ...this.validateReminderVehicleJunctionRefs(
        backup.reminderVehicles ?? [],
        reminderIds,
        vehicleIds
      ),
      ...this.validateReminderNotificationRefs(
        backup.reminderNotifications ?? [],
        reminderIds,
        userIds
      ),
      ...this.validateUniqueConstraints(backup),
    ];
  }

  /**
   * Reject a backup whose rows would violate a DB-level UNIQUE index, BEFORE restore's destructive
   * replace-mode wipe runs (#127, C428). Per-row schema + referential checks don't catch CROSS-ROW
   * duplicates, so a corrupt/truncated download with two expenses sharing a non-null clientId
   * (expenses_user_client_idx) or two vehicles sharing a licensePlate (vehicles_user_license_plate_idx)
   * passes validateBackupData, the wipe commits, then the 2nd colliding INSERT throws — and bun-sqlite's
   * async-transaction callback does NOT roll back the wipe (the C151 footgun), leaving the account EMPTY.
   * Catching the duplicate here means the insert can't fail on it, so the wipe never runs. (The general
   * transient-insert-failure window is a transaction-atomicity fix, escalated C428 — this closes the one
   * reachable within-tenant data-loss trigger.)
   */
  private validateUniqueConstraints(backup: ParsedBackupData): string[] {
    const errors: string[] = [];
    // One composite-key dup detector for ALL the DB-level UNIQUE indexes. A row is SKIPPED if ANY
    // keyed column is null, because SQLite treats a NULL in an indexed column as DISTINCT (and the
    // partial indexes are `WHERE <col> IS NOT NULL`) — so such a row can never collide. A single-column
    // index is just the one-element case: `[String(v)].join(sep) === String(v)` with the identical
    // null-skip, so this subsumes the former scalar dupCheck byte-for-byte (C292 dedup of the C291
    // self-introduced sibling — the scalar variant was a strict special case of this one).
    const dupCheck = (
      rows: Record<string, unknown>[] | undefined,
      fields: string[],
      label: string
    ): void => {
      const seen = new Set<string>();
      for (const row of rows ?? []) {
        const values = fields.map((f) => row[f]);
        if (values.some((v) => v == null)) continue; // NULL in any column → distinct (never collides)
        const key = values.map((v) => String(v)).join('\u0000'); // NUL join — unambiguous composite key
        if (seen.has(key)) {
          errors.push(`Duplicate ${label} "${key}" — backup violates a unique constraint`);
        }
        seen.add(key);
      }
    };
    dupCheck(backup.expenses, ['clientId'], 'expense clientId'); // expenses_user_client_idx
    dupCheck(backup.vehicles, ['licensePlate'], 'vehicle licensePlate'); // vehicles_user_license_plate_idx
    // The remaining DB-level UNIQUE indexes on backed-up + restored tables (C291 — the #127/C428 leg
    // those two checks missed): a duplicate on any of these survives per-row + referential validation,
    // then throws on the colliding INSERT after the replace-mode wipe → empty account (C151 footgun).
    dupCheck(backup.photoRefs, ['photoId', 'providerId'], 'photoRef photo+provider'); // pr_photo_provider_idx
    dupCheck(
      backup.reminderNotifications,
      ['reminderId', 'dueDate'],
      'reminderNotification reminder+dueDate'
    ); // rn_reminder_due_idx (time axis; null dueDate → distinct)
    dupCheck(
      backup.reminderNotifications,
      ['reminderId', 'dueOdometer'],
      'reminderNotification reminder+dueOdometer'
    ); // rn_reminder_odo_idx (mileage axis; partial WHERE due_odometer IS NOT NULL)
    return errors;
  }

  private validateExpenseRefs(
    expenseList: Record<string, unknown>[],
    vehicleIds: Set<string>,
    userIds: Set<string>
  ): string[] {
    const errors: string[] = [];
    for (const expense of expenseList) {
      if (!vehicleIds.has(String(expense.vehicleId))) {
        errors.push(`Expense ${expense.id} references non-existent vehicle`);
      }
      if (expense.userId && !userIds.has(String(expense.userId))) {
        errors.push(`Expense ${expense.id} references non-existent user`);
      }
    }
    return errors;
  }

  /**
   * Shared referential check for a row that owns purely via a `vehicleId` FK (financing/odometer/trips —
   * each cascade-deletes with its vehicle). Rejects a backup whose row names a vehicle absent from the SAME
   * backup, so the post-wipe restore INSERT can't FK-violate. The three callers were byte-identical save the
   * entity label (a rule-of-three the C202 trips addition tipped — dedup'd C205); the message is preserved
   * verbatim (`<Label> <id> references non-existent vehicle`) so any consumer of the text is unaffected.
   */
  private validateVehicleFkRefs(
    rows: Record<string, unknown>[],
    vehicleIds: Set<string>,
    label: string
  ): string[] {
    const errors: string[] = [];
    for (const row of rows) {
      if (!vehicleIds.has(String(row.vehicleId))) {
        errors.push(`${label} ${row.id} references non-existent vehicle`);
      }
    }
    return errors;
  }

  private validateFinancingRefs(
    financingList: Record<string, unknown>[],
    vehicleIds: Set<string>
  ): string[] {
    return this.validateVehicleFkRefs(financingList, vehicleIds, 'Financing');
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

  private validateInsuranceTermRefs(
    termList: Record<string, unknown>[],
    policyIds: Set<string>
  ): string[] {
    const errors: string[] = [];
    for (const term of termList) {
      if (!policyIds.has(String(term.policyId))) {
        errors.push(`Insurance term ${term.id} references non-existent policy ${term.policyId}`);
      }
    }
    return errors;
  }

  private validateClaimRefs(
    claimList: Record<string, unknown>[],
    policyIds: Set<string>,
    termIds: Set<string>,
    vehicleIds: Set<string>
  ): string[] {
    const errors: string[] = [];
    for (const claim of claimList) {
      if (!policyIds.has(String(claim.policyId))) {
        errors.push(`Insurance claim ${claim.id} references non-existent policy ${claim.policyId}`);
      }
      // termId / vehicleId are optional links; validate only when present.
      if (claim.termId != null && claim.termId !== '' && !termIds.has(String(claim.termId))) {
        errors.push(`Insurance claim ${claim.id} references non-existent term ${claim.termId}`);
      }
      if (
        claim.vehicleId != null &&
        claim.vehicleId !== '' &&
        !vehicleIds.has(String(claim.vehicleId))
      ) {
        errors.push(
          `Insurance claim ${claim.id} references non-existent vehicle ${claim.vehicleId}`
        );
      }
    }
    return errors;
  }

  private validateTermVehicleJunctionRefs(
    junctionList: Record<string, unknown>[],
    termIds: Set<string>,
    vehicleIds: Set<string>
  ): string[] {
    const errors: string[] = [];
    for (const junction of junctionList) {
      if (!termIds.has(String(junction.termId))) {
        errors.push(`Insurance junction references non-existent term ${junction.termId}`);
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
    return this.validateVehicleFkRefs(odometerList, vehicleIds, 'Odometer entry');
  }

  // A trip references a vehicle (trips.vehicle_id, ON DELETE cascade) — the trips-location T4 referential
  // check (spec §4), via the shared vehicleId-FK helper.
  private validateTripRefs(tripList: Record<string, unknown>[], vehicleIds: Set<string>): string[] {
    return this.validateVehicleFkRefs(tripList, vehicleIds, 'Trip');
  }

  private validatePhotoRefs(
    photoList: Record<string, unknown>[],
    entityIds: {
      vehicleIds: Set<string>;
      expenseIds: Set<string>;
      policyIds: Set<string>;
      claimIds: Set<string>;
      odometerIds: Set<string>;
    }
  ): string[] {
    const errors: string[] = [];
    // entityType keys MUST match the photo upload allowlist (photos/helpers.ts validateEntityOwnership):
    // vehicle / insurance_policy / insurance_claim / expense / odometer_entry. A type accepted on upload
    // but missing here makes restore reject an otherwise-valid backup outright (valid:false aborts the
    // WHOLE restore, not just the photo) — the crown-jewel NORTH_STAR #1 round-trip failure insurance_claim
    // hit (C404: claim photos are a real, app-creatable target the original 15-table cert/C366 predated).
    const entityTypeToIds: Record<string, Set<string>> = {
      vehicle: entityIds.vehicleIds,
      expense: entityIds.expenseIds,
      insurance_policy: entityIds.policyIds,
      insurance_claim: entityIds.claimIds,
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

  private validateExpenseSourceRefs(
    expenseList: Record<string, unknown>[],
    reminderIds: Set<string>
  ): string[] {
    const errors: string[] = [];
    for (const expense of expenseList) {
      if (expense.sourceType === 'reminder' && expense.sourceId) {
        if (!reminderIds.has(String(expense.sourceId))) {
          errors.push(
            `Expense ${expense.id} references non-existent reminder source ${expense.sourceId}`
          );
        }
      }
    }
    return errors;
  }

  private validateReminderRefs(
    reminderList: Record<string, unknown>[],
    userIds: Set<string>
  ): string[] {
    const errors: string[] = [];
    for (const reminder of reminderList) {
      if (reminder.userId && !userIds.has(String(reminder.userId))) {
        errors.push(`Reminder ${reminder.id} references non-existent user ${reminder.userId}`);
      }
    }
    return errors;
  }

  private validateReminderVehicleJunctionRefs(
    junctionList: Record<string, unknown>[],
    reminderIds: Set<string>,
    vehicleIds: Set<string>
  ): string[] {
    const errors: string[] = [];
    for (const junction of junctionList) {
      if (!reminderIds.has(String(junction.reminderId))) {
        errors.push(
          `Reminder vehicle junction references non-existent reminder ${junction.reminderId}`
        );
      }
      if (!vehicleIds.has(String(junction.vehicleId))) {
        errors.push(
          `Reminder vehicle junction references non-existent vehicle ${junction.vehicleId}`
        );
      }
    }
    return errors;
  }

  private validateReminderNotificationRefs(
    notificationList: Record<string, unknown>[],
    reminderIds: Set<string>,
    userIds: Set<string>
  ): string[] {
    const errors: string[] = [];
    for (const notification of notificationList) {
      if (!reminderIds.has(String(notification.reminderId))) {
        errors.push(
          `Reminder notification ${notification.id} references non-existent reminder ${notification.reminderId}`
        );
      }
      if (notification.userId && !userIds.has(String(notification.userId))) {
        errors.push(
          `Reminder notification ${notification.id} references non-existent user ${notification.userId}`
        );
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
