import AdmZip from 'adm-zip';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import type { Table } from 'drizzle-orm';
import { and, eq, getTableColumns, getTableName, inArray } from 'drizzle-orm';
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
  vehicleShares,
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
import { chunk } from '../../utils/chunk';
import { logger } from '../../utils/logger';
import { joinStoragePath } from '../../utils/paths';
import { unitPreferencesSchema } from '../../utils/unit-preferences-schema';
import { hasZipBackup } from './backup-strategy';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export const MONEY_CENTS_FIELDS = new Set<string>([
  'purchasePrice',
  'originalAmount',
  'paymentAmount',
  'residualValue',
  'excessMileageFee',
  'deductibleAmount',
  'coverageLimit',
  'totalCost',
  'monthlyCost',
  'payoutAmount',
  'expenseAmount',
  'groupTotal',
]);

export function isPreCentsBackup(version: string | undefined): boolean {
  const major = Number.parseInt(String(version ?? '').split('.')[0], 10);
  return Number.isFinite(major) && major < 2;
}

// biome-ignore lint/suspicious/noExplicitAny: Zod schema type is complex
const TABLE_SCHEMAS: Record<string, z.ZodObject<any>> = {};
for (const [key, table] of Object.entries(TABLE_SCHEMA_MAP)) {
  TABLE_SCHEMAS[key] = createInsertSchema(table);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Column type coercion requires checking multiple column types
export function coerceRow(
  row: Record<string, unknown>,
  table: Table,
  options?: { shimMoneyToCents?: boolean }
): Record<string, unknown> {
  const columns = getTableColumns(table);
  const coerced: Record<string, unknown> = { ...row };
  const shimMoneyToCents = options?.shimMoneyToCents ?? false;

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

    const hasStaticDefault = col.notNull && col.hasDefault && col.default !== undefined;

    if (val === undefined || val === null) {
      if (BOOLEAN_TYPES.has(col.columnType)) {
        coerced[columnName] = val === undefined ? (col.default ?? false) : false;
      } else if (hasStaticDefault) {
        coerced[columnName] = col.default;
      }
      continue;
    }
    const strVal = String(val);
    // A null in a NOT NULL column aborts the restore, so blanks take the static default.
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
      // CSV round-trips present booleans as true, 1, '1' or 'true'.
      coerced[columnName] = strVal === 'true' || strVal === '1' || strVal === 'TRUE';
    } else if (JSON_TYPES.has(col.columnType)) {
      try {
        coerced[columnName] = JSON.parse(strVal);
      } catch {
        logger.warn('Backup cell is not valid JSON; substituted the column default', {
          table: getTableName(table),
          column: columnName,
          row: row.id ?? row.userId,
        });
        coerced[columnName] = hasStaticDefault ? col.default : null;
      }
    } else if (INTEGER_TYPES.has(col.columnType)) {
      // Sheets exports grouped numbers such as "12,345"; parseInt would read them as 12.
      const num = Number(strVal.replace(/,/g, ''));
      if (Number.isNaN(num)) {
        coerced[columnName] = null;
      } else if (shimMoneyToCents && MONEY_CENTS_FIELDS.has(columnName)) {
        // Float products such as 12.34 * 100 land just below the integer, so round.
        coerced[columnName] = Math.round(num * 100);
      } else {
        coerced[columnName] = Math.round(num);
      }
    } else if (REAL_TYPES.has(col.columnType)) {
      const num = Number(strVal.replace(/,/g, ''));
      coerced[columnName] = Number.isNaN(num) ? null : num;
    } else if (TEXT_TYPES.has(col.columnType)) {
      // Sheets returns numeric-looking text such as license plates as numbers.
      coerced[columnName] = strVal;
    }
  }

  return coerced;
}

export function resolveBackupFolderPath(
  providerRow: UserProvider,
  settings: ProviderBackupSettings
): string {
  const providerRootPath =
    ((providerRow.config as Record<string, unknown> | null)?.providerRootPath as string) ?? '';
  return joinStoragePath(providerRootPath, settings.folderPath);
}

export class BackupService {
  async loadBackupConfig(userId: string): Promise<BackupConfig> {
    const { preferencesRepository } = await import('../settings/repository');
    const prefs = await preferencesRepository.getOrCreate(userId);
    return prefs.backupConfig ?? { providers: {} };
  }

  async enforceRetention(userId: string, providerId: string): Promise<number> {
    const config = await this.loadBackupConfig(userId);
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

    const config = await this.loadBackupConfig(userId);
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

  async listAllBackups(userId: string): Promise<ProviderBackupList[]> {
    const config = await this.loadBackupConfig(userId);
    const zipProviderIds = Object.entries(config.providers)
      .filter(([, settings]) => hasZipBackup(settings))
      .map(([providerId]) => providerId);
    const results: ProviderBackupList[] = [];

    for (const providerId of zipProviderIds) {
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

  async downloadBackup(userId: string, providerId: string, fileRef: string): Promise<Buffer> {
    const { storageProviderRegistry } = await import('../providers/domains/storage/registry');
    const provider = await storageProviderRegistry.getProvider(providerId, userId);
    return provider.download({ providerType: provider.type, externalId: fileRef });
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
        db.select().from(trips).where(eq(trips.userId, userId)),
      ]);

    const policyIds = userInsurance.map((p) => p.id);
    const userInsuranceTerms =
      policyIds.length > 0
        ? await db.select().from(insuranceTerms).where(inArray(insuranceTerms.policyId, policyIds))
        : [];

    const termIds = userInsuranceTerms.map((t) => t.id);
    const userInsuranceTermVehicles =
      termIds.length > 0
        ? await db
            .select()
            .from(insuranceTermVehicles)
            .where(inArray(insuranceTermVehicles.termId, termIds))
        : [];

    const userInsuranceClaims =
      policyIds.length > 0
        ? await db
            .select()
            .from(insuranceClaims)
            .where(inArray(insuranceClaims.policyId, policyIds))
        : [];

    const userPhotos = await db.select().from(photos).where(eq(photos.userId, userId));

    const photoIds = userPhotos.map((p) => p.id);
    const userPhotoRefs: (typeof photoRefs.$inferSelect)[] = [];
    for (const batch of chunk(photoIds)) {
      const rows = await db.select().from(photoRefs).where(inArray(photoRefs.photoId, batch));
      userPhotoRefs.push(...rows);
    }

    const userPreferencesRows = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId));
    const syncStateRows = await db.select().from(syncState).where(eq(syncState.userId, userId));

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

    const userVehicleShares = await db
      .select()
      .from(vehicleShares)
      // Scoped by ownerId so invitees' grants stay out of this user's backup.
      .where(and(eq(vehicleShares.ownerId, userId), eq(vehicleShares.status, 'accepted')));

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
      vehicleShares: userVehicleShares,
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
        const csv = this.convertToCSV(data, Object.keys(getTableColumns(table)));
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
          // Sheets renders a raw object as [object Object].
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

    for (const e of zipEntries) {
      // Entry sizes are attacker-declared: check the compression ratio before inflating.
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
        ? rawRows.map((row) => coerceRow(row, table, { shimMoneyToCents }))
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
    errors.push(...this.validateJsonColumnShapes(backup));
    return { valid: errors.length === 0, errors };
  }

  private validateJsonColumnShapes(backup: ParsedBackupData): string[] {
    const errors: string[] = [];
    const checkUnitPreferences = (
      rows: Record<string, unknown>[] | undefined,
      tableName: string,
      idField: string
    ): void => {
      for (const row of rows ?? []) {
        if (row.unitPreferences == null) continue;
        const result = unitPreferencesSchema.safeParse(row.unitPreferences);
        if (!result.success) {
          const issues = result.error.issues.map((e) => e.message).join(', ');
          errors.push(`${tableName}[${row[idField]}]: unitPreferences is invalid — ${issues}`);
        }
      }
    };
    checkUnitPreferences(backup.vehicles, 'vehicles', 'id');
    checkUnitPreferences(backup.userPreferences, 'user_preferences', 'userId');
    return errors;
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

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: a flat fan-out of per-table FK validators (one spread each); the count is breadth, not nesting — splitting it would only obscure the one-validator-per-table structure
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
      ...this.validateVehicleFkRefs(backup.financing, vehicleIds, 'Financing'),
      ...this.validateInsuranceRefs(backup.insurance),
      ...this.validateInsuranceTermRefs(backup.insuranceTerms ?? [], policyIds),
      ...this.validateTermVehicleJunctionRefs(
        backup.insuranceTermVehicles ?? [],
        termIds,
        vehicleIds
      ),
      ...this.validateClaimRefs(backup.insuranceClaims ?? [], policyIds, termIds, vehicleIds),
      ...this.validateVehicleFkRefs(backup.odometer ?? [], vehicleIds, 'Odometer entry'),
      ...this.validateVehicleFkRefs(backup.trips ?? [], vehicleIds, 'Trip'),
      ...this.validateShareRefs(backup.vehicleShares ?? [], vehicleIds, userIds),
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

  private validateUniqueConstraints(backup: ParsedBackupData): string[] {
    const errors: string[] = [];
    const dupCheck = (
      rows: Record<string, unknown>[] | undefined,
      fields: string[],
      label: string,
      inIndex?: (row: Record<string, unknown>) => boolean
    ): void => {
      const seen = new Set<string>();
      for (const row of rows ?? []) {
        if (inIndex && !inIndex(row)) continue;
        const values = fields.map((f) => row[f]);
        // SQLite treats NULLs as distinct in UNIQUE indexes, so null-keyed rows cannot collide.
        if (values.some((v) => v == null)) continue;
        const key = values.map((v) => String(v)).join('\u0000');
        if (seen.has(key)) {
          errors.push(`Duplicate ${label} "${key}" — backup violates a unique constraint`);
        }
        seen.add(key);
      }
    };
    const isTruthyFlag = (value: unknown): boolean =>
      value === true || value === 1 || value === '1' || value === 'true';
    dupCheck(backup.expenses, ['clientId'], 'expense clientId');
    dupCheck(backup.vehicles, ['licensePlate'], 'vehicle licensePlate');
    dupCheck(backup.photoRefs, ['photoId', 'providerId'], 'photoRef photo+provider');
    dupCheck(
      backup.reminderNotifications,
      ['reminderId', 'dueDate'],
      'reminderNotification reminder+dueDate'
    );
    dupCheck(
      backup.reminderNotifications,
      ['reminderId', 'dueOdometer'],
      'reminderNotification reminder+dueOdometer'
    );
    dupCheck(backup.vehicleShares, ['vehicleId', 'sharedWithId'], 'vehicleShare vehicle+invitee');
    dupCheck(backup.financing, ['vehicleId'], 'active financing vehicleId', (row) =>
      isTruthyFlag(row.isActive)
    );
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

  private validateShareRefs(
    shareList: Record<string, unknown>[],
    vehicleIds: Set<string>,
    userIds: Set<string>
  ): string[] {
    const errors: string[] = [];
    for (const share of shareList) {
      if (!vehicleIds.has(String(share.vehicleId))) {
        errors.push(`Vehicle share ${share.id} references non-existent vehicle`);
      }
      if (!userIds.has(String(share.ownerId))) {
        errors.push(`Vehicle share ${share.id} references a non-owner`);
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
