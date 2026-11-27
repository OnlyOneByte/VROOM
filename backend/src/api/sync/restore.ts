import { and, eq, getTableColumns, inArray, ne, type Table } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { appContext, repos } from '../../app-context';
import { TABLE_SCHEMA_MAP } from '../../config';
import type { AsyncHandle } from '../../db/async-sqlite';
import { firstRow } from '../../db/first-row';
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
  userProviders,
  users,
  vehicleDrivers,
  vehicleFinancing,
  vehicleShares,
  vehicles,
} from '../../db/schema';
import { isVehicleKind } from '../../db/types';
import {
  AppError,
  ConflictError,
  isUniqueConstraintError,
  SyncError,
  ValidationError,
} from '../../errors';
import { changeShareRole, hasPerPersonVehicleGrants } from '../../permissions/grants';
import {
  type BackupConfig,
  DEFAULT_PROVIDER_CAPABILITIES,
  DEFAULT_STORAGE_CONFIG,
  type ParsedBackupData,
  type ProviderDefaults,
  type StorageConfig,
} from '../../types';
import { chunk, rowsPerInsert } from '../../utils/chunk';
import { logger } from '../../utils/logger';
import { minorUnitScale } from '../../utils/money';
import { ownedVehiclesScope } from '../../utils/vehicle-access';
import { catalogModelMatchesMake } from '../../utils/vehicle-catalog';
import { DRIVER_COLORS } from '../drivers/repository';
import { LOCAL_OCR_PROVIDER_ID } from '../providers/domains/vlm/registry';
import { CAPABILITY_DOMAIN } from '../providers/resolve';
import { DEFAULT_CURRENCY } from '../settings/repository';
import { isKnownRegion } from '../settings/validation';
import {
  backupService,
  coerceRow,
  normalizeStorageIdentity,
  storageProviderIdentity,
  upgradeBackupTables,
} from './backup';

export interface ImportSummary {
  vehicles: number;
  expenses: number;
  financing: number;
  insurance: number;
  insuranceTerms: number;
  insuranceTermVehicles: number;
  insuranceClaims: number;
  reminders: number;
  reminderVehicles: number;
  reminderNotifications: number;
  odometer: number;
  photos: number;
  photoRefs: number;
  userPreferences: number;
  syncState: number;
  trips: number;
  vehicleShares: number;
  vehicleDrivers: number;
}

export interface MergeCounts {
  imported: ImportSummary;
  kept: ImportSummary;
}

export interface RestoreResponse {
  success: boolean;
  preview?: ImportSummary;
  merge?: MergeCounts;
  imported?: ImportSummary;
  kept?: ImportSummary;
  skipped?: { photos: number };
}

type SummaryKey = keyof ImportSummary;

class MergePreviewRollback extends Error {
  constructor(readonly counts: MergeCounts) {
    super('merge preview');
  }
}

const EXPENSE_SOURCES = new Set(['reminder', 'financing', 'insurance_term']);

const shareConsentKey = (vehicleId: string, sharedWithId: string): string =>
  `${vehicleId}\u0000${sharedWithId}`;

const clampShareLevel = (level: unknown): string => (level === 'editor' ? 'editor' : 'viewer');

type RestoreMode = 'replace' | 'merge' | 'preview';

type ProviderScopedPrefs = Pick<
  typeof userPreferences.$inferSelect,
  'backupConfig' | 'storageConfig' | 'providerDefaults'
>;

function summarizeBackup(data: ParsedBackupData): ImportSummary {
  return {
    vehicles: data.vehicles.length,
    expenses: data.expenses.length,
    financing: data.financing.length,
    insurance: data.insurance.length,
    insuranceTerms: data.insuranceTerms?.length ?? 0,
    insuranceTermVehicles: data.insuranceTermVehicles?.length ?? 0,
    insuranceClaims: data.insuranceClaims?.length ?? 0,
    reminders: data.reminders?.length ?? 0,
    reminderVehicles: data.reminderVehicles?.length ?? 0,
    reminderNotifications: data.reminderNotifications?.length ?? 0,
    odometer: data.odometer?.length ?? 0,
    photos: data.photos?.length ?? 0,
    photoRefs: data.photoRefs?.length ?? 0,
    userPreferences: data.userPreferences?.length ?? 0,
    syncState: data.syncState?.length ?? 0,
    trips: data.trips?.length ?? 0,
    vehicleShares: data.vehicleShares?.length ?? 0,
    vehicleDrivers: data.vehicleDrivers?.length ?? 0,
  };
}

function mergeCounts(summary: ImportSummary, imported: ImportSummary): MergeCounts {
  const keys = Object.keys(summary) as SummaryKey[];
  return {
    imported,
    kept: Object.fromEntries(
      keys.map((key) => [key, summary[key] - imported[key]])
    ) as unknown as ImportSummary,
  };
}

function coerceRows(rows: Record<string, unknown>[], table: Table): Record<string, unknown>[] {
  return rows.map((row) => coerceRow(row, table));
}

class RestoreService {
  private get db() {
    return appContext().asyncDb;
  }

  async restoreFromBackup(
    userId: string,
    file: Buffer,
    mode: RestoreMode,
    signal?: AbortSignal
  ): Promise<RestoreResponse> {
    const currency = await this.accountCurrency(userId);
    const { data: parsedBackup, skippedPhotos } = this.withoutOrphanPhotos(
      await this.parseOrReject(file, currency)
    );

    const validation = backupService.validateBackupData(parsedBackup);
    if (!validation.valid) {
      throw new ValidationError('Backup validation failed', validation.errors);
    }

    return this.applyRestore(userId, parsedBackup, mode, skippedPhotos, currency, signal);
  }

  private withoutOrphanPhotos(data: ParsedBackupData): {
    data: ParsedBackupData;
    skippedPhotos: number;
  } {
    const cleaned = backupService.dropOrphanPhotos(data);
    return {
      data: cleaned,
      skippedPhotos: (data.photos?.length ?? 0) - (cleaned.photos?.length ?? 0),
    };
  }

  private async applyRestore(
    userId: string,
    data: ParsedBackupData,
    mode: RestoreMode,
    skippedPhotos: number,
    parsedWithCurrency: string | undefined,
    signal?: AbortSignal
  ): Promise<RestoreResponse> {
    const summary = summarizeBackup(data);
    const skipped = skippedPhotos > 0 ? { skipped: { photos: skippedPhotos } } : {};

    this.assertReplaceNotEmpty(summary, mode);

    signal?.throwIfAborted();
    let imported = summary;
    try {
      await this.db.transaction(async (tx) => {
        signal?.throwIfAborted();
        if (mode === 'replace' && (await hasPerPersonVehicleGrants(tx, userId))) {
          throw new ConflictError(
            'Some people have their own roles or permission changes on your vehicles, and a full restore would remove them. Remove those changes first, or restore in merge mode.'
          );
        }
        if (
          minorUnitScale((await this.accountCurrency(userId, tx)) ?? DEFAULT_CURRENCY) !==
          minorUnitScale(parsedWithCurrency ?? DEFAULT_CURRENCY)
        ) {
          throw new ConflictError(
            'The currency changed while this backup was being read. Reload and try again.'
          );
        }
        // Read before the wipe: deleteUserData cascades vehicle_shares.
        const consented = await this.consentedShareKeys(tx, userId);
        const currentPrefs = await this.currentProviderPrefs(tx, userId);
        if (mode === 'replace') {
          await this.deleteUserData(tx, userId, { keepPreferences: !data.userPreferences?.length });
        }
        const merge = mode !== 'replace';
        imported = await this.insertBackupData(tx, data, userId, consented, currentPrefs, merge);
        if (mode === 'preview') {
          throw new MergePreviewRollback(mergeCounts(summary, imported));
        }
        signal?.throwIfAborted();
      });
    } catch (error) {
      if (error instanceof MergePreviewRollback) {
        return { success: true, preview: summary, merge: error.counts, ...skipped };
      }
      if (!isUniqueConstraintError(error)) throw error;
      logger.warn('Restore rolled back on a record conflict', { error });
      throw new ConflictError(
        'This backup contains records that conflict with existing data, so nothing was restored.'
      );
    }

    if (mode === 'merge') {
      return { success: true, ...mergeCounts(summary, imported), ...skipped };
    }
    return { success: true, imported: summary, ...skipped };
  }

  private async accountCurrency(
    userId: string,
    db: AsyncHandle = this.db
  ): Promise<string | undefined> {
    const row = await db
      .select({ currency: userPreferences.currencyUnit })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .then(firstRow);
    return row?.currency;
  }

  private async parseOrReject(file: Buffer, accountCurrency?: string): Promise<ParsedBackupData> {
    try {
      return await backupService.parseZipBackup(file, accountCurrency);
    } catch (error) {
      if (error instanceof AppError || error instanceof SyncError) throw error;
      throw new ValidationError(
        'That file is not a readable VROOM backup ZIP — it may be the wrong file, truncated, or edited into a shape the parser cannot read.',
        { parserMessage: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  private assertReplaceNotEmpty(
    summary: ImportSummary,
    mode: 'replace' | 'merge' | 'preview'
  ): void {
    if (mode !== 'replace') return;
    const totalRows = Object.values(summary).reduce((sum, n) => sum + n, 0);
    if (totalRows === 0) {
      throw new ValidationError(
        'Refusing to replace all data with an empty backup (0 rows): this would delete everything and restore nothing. The backup is likely truncated or corrupt.'
      );
    }
  }

  async restoreFromSheets(
    userId: string,
    providerId: string,
    mode: RestoreMode,
    signal?: AbortSignal
  ): Promise<RestoreResponse> {
    const prefs = await repos().preferences.getOrCreate(userId);
    const backupConfig = prefs?.backupConfig as BackupConfig | null;
    const providerConfig = backupConfig?.providers?.[providerId];
    const sheetsSpreadsheetId = providerConfig?.sheetsSpreadsheetId;

    if (!sheetsSpreadsheetId) {
      throw new ValidationError('No Google Sheets spreadsheet found for this provider');
    }

    try {
      return await this.readSheetsAndRestore(userId, providerId, sheetsSpreadsheetId, mode, signal);
    } catch (error) {
      await repos().preferences.mergeLiveBackupProviders(userId, {
        [providerId]: { sheetsAutoPausedAt: new Date().toISOString() },
      });
      throw error;
    }
  }

  private async readSheetsAndRestore(
    userId: string,
    providerId: string,
    sheetsSpreadsheetId: string,
    mode: RestoreMode,
    signal?: AbortSignal
  ): Promise<RestoreResponse> {
    const { createSheetsServiceForProvider } = await import(
      '../providers/services/google-sheets-service'
    );
    const sheetsService = await createSheetsServiceForProvider(providerId, userId);
    const { metadata, ...sheetTables } =
      await sheetsService.readSpreadsheetData(sheetsSpreadsheetId);
    const currency = await this.accountCurrency(userId);
    const sheet = upgradeBackupTables(
      metadata.version,
      sheetTables,
      currency
    ) as typeof sheetTables;

    const { data: sheetData, skippedPhotos } = this.withoutOrphanPhotos({
      metadata,
      vehicles: coerceRows(sheet.vehicles, TABLE_SCHEMA_MAP.vehicles),
      expenses: coerceRows(sheet.expenses, TABLE_SCHEMA_MAP.expenses),
      financing: coerceRows(sheet.financing, TABLE_SCHEMA_MAP.financing),
      insurance: coerceRows(sheet.insurance, TABLE_SCHEMA_MAP.insurance),
      insuranceTerms: coerceRows(sheet.insuranceTerms, TABLE_SCHEMA_MAP.insuranceTerms),
      insuranceTermVehicles: coerceRows(
        sheet.insuranceTermVehicles,
        TABLE_SCHEMA_MAP.insuranceTermVehicles
      ),
      insuranceClaims: coerceRows(sheet.insuranceClaims, TABLE_SCHEMA_MAP.insuranceClaims),
      photos: coerceRows(sheet.photos, TABLE_SCHEMA_MAP.photos),
      odometer: coerceRows(sheet.odometer, TABLE_SCHEMA_MAP.odometer),
      photoRefs: coerceRows(sheet.photoRefs, TABLE_SCHEMA_MAP.photoRefs),
      userPreferences: coerceRows(sheet.userPreferences, TABLE_SCHEMA_MAP.userPreferences),
      syncState: coerceRows(sheet.syncState, TABLE_SCHEMA_MAP.syncState),
      reminders: coerceRows(sheet.reminders, TABLE_SCHEMA_MAP.reminders),
      reminderVehicles: coerceRows(sheet.reminderVehicles, TABLE_SCHEMA_MAP.reminderVehicles),
      reminderNotifications: coerceRows(
        sheet.reminderNotifications,
        TABLE_SCHEMA_MAP.reminderNotifications
      ),
      trips: coerceRows(sheet.trips, TABLE_SCHEMA_MAP.trips),
      vehicleShares: coerceRows(sheet.vehicleShares, TABLE_SCHEMA_MAP.vehicleShares),
      vehicleDrivers: coerceRows(sheet.vehicleDrivers, TABLE_SCHEMA_MAP.vehicleDrivers),
    });

    const validation = backupService.validateBackupData(sheetData, 'sheets');
    if (!validation.valid) {
      throw new ValidationError('Sheet data validation failed', validation.errors);
    }

    return this.applyRestore(userId, sheetData, mode, skippedPhotos, currency, signal);
  }

  private async deleteUserData(
    tx: AsyncHandle,
    userId: string,
    { keepPreferences }: { keepPreferences: boolean }
  ): Promise<void> {
    const userVehicles = await tx
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(ownedVehiclesScope(userId));
    const vehicleIds = userVehicles.map((v) => v.id);

    const keptPhotoIds = new Set(await this.photosOnOtherOwnersVehicles(tx, userId));
    const wipedPhotoIds = (
      await tx.select({ id: photos.id }).from(photos).where(eq(photos.userId, userId))
    )
      .map((p) => p.id)
      .filter((id) => !keptPhotoIds.has(id));
    for (const idBatch of chunk(wipedPhotoIds)) {
      await tx.delete(photos).where(inArray(photos.id, idBatch));
    }
    await tx.delete(expenses).where(eq(expenses.userId, userId));
    await tx.delete(trips).where(eq(trips.userId, userId));

    for (const idBatch of chunk(vehicleIds)) {
      await tx.delete(odometerEntries).where(inArray(odometerEntries.vehicleId, idBatch));
      await tx.delete(vehicleFinancing).where(inArray(vehicleFinancing.vehicleId, idBatch));
    }

    await tx.delete(insurancePolicies).where(eq(insurancePolicies.userId, userId));

    await tx.delete(reminders).where(eq(reminders.userId, userId));

    if (!keepPreferences) {
      await tx.delete(userPreferences).where(eq(userPreferences.userId, userId));
    }
    await tx.delete(syncState).where(eq(syncState.userId, userId));

    await tx.delete(vehicles).where(ownedVehiclesScope(userId));
  }

  private async photosOnOtherOwnersVehicles(tx: AsyncHandle, userId: string): Promise<string[]> {
    const onExpenses = await tx
      .select({ id: photos.id })
      .from(photos)
      .innerJoin(expenses, eq(expenses.id, photos.entityId))
      .innerJoin(vehicles, eq(vehicles.id, expenses.vehicleId))
      .where(
        and(
          eq(photos.userId, userId),
          eq(photos.entityType, 'expense'),
          ne(vehicles.userId, userId)
        )
      );
    const onOdometer = await tx
      .select({ id: photos.id })
      .from(photos)
      .innerJoin(odometerEntries, eq(odometerEntries.id, photos.entityId))
      .innerJoin(vehicles, eq(vehicles.id, odometerEntries.vehicleId))
      .where(
        and(
          eq(photos.userId, userId),
          eq(photos.entityType, 'odometer_entry'),
          ne(vehicles.userId, userId)
        )
      );
    return [...onExpenses, ...onOdometer].map((p) => p.id);
  }

  // Backup files are untrusted; this is the chokepoint against cross-tenant writes.
  private stampUserId<T extends Record<string, unknown>>(
    rows: T[] | undefined,
    userId: string
  ): T[] {
    return (rows ?? []).map((row) => ({ ...row, userId }));
  }

  private keepMemberAuthors<T extends Record<string, unknown>>(
    rows: T[],
    consentedShares: Set<string>,
    vehiclesOf: (row: T) => string[]
  ): T[] {
    const isMember = (row: T): boolean =>
      vehiclesOf(row).every((vehicleId) =>
        consentedShares.has(shareConsentKey(vehicleId, String(row.createdBy)))
      );
    const cleared = rows.filter((row) => row.createdBy != null && !isMember(row)).length;
    if (cleared > 0) {
      logger.warn('Restore credited entries to the owner because their author is not a member', {
        rows: cleared,
      });
    }
    return rows.map((row) =>
      row.createdBy != null && !isMember(row) ? { ...row, createdBy: null } : row
    );
  }

  private memberOfCar(
    candidate: unknown,
    vehicleId: unknown,
    ownerId: string,
    consentedShares: Set<string>
  ): string | null {
    const userId = candidate == null || candidate === '' ? null : String(candidate);
    if (userId === null || userId === ownerId) return userId;
    return consentedShares.has(shareConsentKey(String(vehicleId), userId)) ? userId : null;
  }

  private async insertRows<TTable extends SQLiteTable>(
    tx: AsyncHandle,
    table: TTable,
    rows: Record<string, unknown>[],
    merge: boolean
  ): Promise<number> {
    if (rows.length === 0) return 0;
    const columnCount = Object.keys(getTableColumns(table)).length;
    let added = 0;
    for (const batch of chunk(rows, rowsPerInsert(columnCount))) {
      const values = batch as unknown as TTable['$inferInsert'][];
      if (merge) {
        added += (await tx.insert(table).values(values).onConflictDoNothing().returning()).length;
      } else {
        await tx.insert(table).values(values);
        added += batch.length;
      }
    }
    return added;
  }

  private async mineAmong(
    tx: AsyncHandle,
    table: SQLiteTable,
    idColumn: SQLiteColumn,
    ownerColumn: SQLiteColumn,
    ids: string[],
    isMine: (owner: string) => boolean
  ): Promise<Set<string>> {
    const found = new Set<string>();
    for (const batch of chunk([...new Set(ids)])) {
      const rows = await tx
        .select({ id: idColumn, owner: ownerColumn })
        .from(table)
        .where(inArray(idColumn, batch));
      for (const row of rows) {
        if (isMine(String(row.owner))) found.add(String(row.id));
      }
    }
    return found;
  }

  private async insertBackupData(
    tx: AsyncHandle,
    data: ParsedBackupData,
    userId: string,
    consentedShares: Set<string>,
    currentPrefs: ProviderScopedPrefs | undefined,
    merge: boolean
  ): Promise<ImportSummary> {
    const knownUserIds = new Set((await tx.select({ id: users.id }).from(users)).map((u) => u.id));
    type Row = Record<string, unknown>;
    const gate = <T extends Row>(rows: T[], keep: (row: T) => boolean): T[] =>
      merge ? rows.filter(keep) : rows;
    const optional = (ids: Set<string>, value: unknown): boolean =>
      value == null || value === '' || ids.has(String(value));
    const mine = (
      table: SQLiteTable,
      idColumn: SQLiteColumn,
      ownerColumn: SQLiteColumn,
      rows: Row[],
      isMine: (owner: string) => boolean
    ): Promise<Set<string>> =>
      merge
        ? this.mineAmong(
            tx,
            table,
            idColumn,
            ownerColumn,
            rows.map((row) => String(row.id)),
            isMine
          )
        : Promise.resolve(new Set(rows.map((row) => String(row.id))));
    const isOwner = (owner: string): boolean => owner === userId;
    const insert = (table: SQLiteTable, rows: Row[]): Promise<number> =>
      this.insertRows(tx, table, rows, merge);

    // SQLite checks foreign keys on insert, so parents must be inserted before children.
    const vehicleRows = this.stampUserId(data.vehicles, userId).map((row) => ({
      ...row,
      catalogModelId:
        typeof row.catalogModelId === 'string' &&
        catalogModelMatchesMake(row.catalogModelId, String(row.make))
          ? row.catalogModelId
          : null,
      vehicleKind: isVehicleKind(row.vehicleKind) ? row.vehicleKind : 'car',
    }));
    const addedVehicles = await insert(vehicles, vehicleRows);
    const carOk = await mine(vehicles, vehicles.id, vehicles.userId, vehicleRows, isOwner);
    const onCar = (row: Row): boolean => carOk.has(String(row.vehicleId));
    const ownCar = (owner: string): boolean => carOk.has(owner);

    const driverRows = gate(data.vehicleDrivers ?? [], onCar).map((driver) => ({
      ...driver,
      userId: this.memberOfCar(driver.userId, driver.vehicleId, userId, consentedShares),
      color: (DRIVER_COLORS as readonly unknown[]).includes(driver.color) ? driver.color : null,
      createdBy: this.memberOfCar(driver.createdBy, driver.vehicleId, userId, consentedShares),
    }));
    const addedDrivers = await insert(vehicleDrivers, driverRows);
    const driverOk = await mine(
      vehicleDrivers,
      vehicleDrivers.id,
      vehicleDrivers.vehicleId,
      driverRows,
      ownCar
    );

    const financingRows = gate(data.financing ?? [], onCar);
    const addedFinancing = await insert(vehicleFinancing, financingRows);
    const financingOk = await mine(
      vehicleFinancing,
      vehicleFinancing.id,
      vehicleFinancing.vehicleId,
      financingRows,
      ownCar
    );

    const policyRows = this.stampUserId(data.insurance, userId);
    const addedPolicies = await insert(insurancePolicies, policyRows);
    const policyOk = await mine(
      insurancePolicies,
      insurancePolicies.id,
      insurancePolicies.userId,
      policyRows,
      isOwner
    );
    const onPolicy = (row: Row): boolean => policyOk.has(String(row.policyId));
    const termRows = gate(data.insuranceTerms ?? [], onPolicy);
    const addedTerms = await insert(insuranceTerms, termRows);
    const termOk = await mine(
      insuranceTerms,
      insuranceTerms.id,
      insuranceTerms.policyId,
      termRows,
      (owner) => policyOk.has(owner)
    );
    const addedTermVehicles = await insert(
      insuranceTermVehicles,
      gate(
        data.insuranceTermVehicles ?? [],
        (row) => termOk.has(String(row.termId)) && onCar(row)
      ).map((row, index) => ({ ...row, position: index + 1 }))
    );
    const claimRows = gate(
      data.insuranceClaims ?? [],
      (row) => onPolicy(row) && optional(termOk, row.termId) && optional(carOk, row.vehicleId)
    );
    const addedClaims = await insert(insuranceClaims, claimRows);
    const claimOk = await mine(
      insuranceClaims,
      insuranceClaims.id,
      insuranceClaims.policyId,
      claimRows,
      (owner) => policyOk.has(owner)
    );

    const reminderVehicleIds = new Map<string, string[]>();
    for (const link of data.reminderVehicles ?? []) {
      const id = String(link.reminderId);
      reminderVehicleIds.set(id, [...(reminderVehicleIds.get(id) ?? []), String(link.vehicleId)]);
    }
    const reminderRows = this.keepMemberAuthors(
      gate(this.stampUserId(data.reminders, userId), (row) =>
        (reminderVehicleIds.get(String(row.id)) ?? []).every((id) => carOk.has(id))
      ),
      consentedShares,
      (row) => reminderVehicleIds.get(String(row.id)) ?? ['']
    );
    const addedReminders = await insert(reminders, reminderRows);
    const reminderOk = await mine(reminders, reminders.id, reminders.userId, reminderRows, isOwner);
    const onReminder = (row: Row): boolean => reminderOk.has(String(row.reminderId));
    const addedReminderVehicles = await insert(
      reminderVehicles,
      gate(data.reminderVehicles ?? [], (row) => onReminder(row) && onCar(row))
    );
    const addedNotifications = await insert(
      reminderNotifications,
      gate(this.stampUserId(data.reminderNotifications, userId), onReminder)
    );

    const sources: Record<string, Set<string>> = {
      reminder: reminderOk,
      financing: financingOk,
      insurance_term: termOk,
    };
    const sourceOk = (row: Row): boolean =>
      row.sourceId == null ||
      row.sourceId === '' ||
      (EXPENSE_SOURCES.has(String(row.sourceType)) &&
        Boolean(sources[String(row.sourceType)]?.has(String(row.sourceId))));
    const expenseRows = this.keepMemberAuthors(
      gate(
        this.stampUserId(data.expenses, userId),
        (row) => onCar(row) && optional(driverOk, row.paidByDriverId) && sourceOk(row)
      ),
      consentedShares,
      (row) => [String(row.vehicleId)]
    );
    const addedExpenses = await insert(expenses, expenseRows);
    const expenseOk = await mine(expenses, expenses.id, expenses.userId, expenseRows, isOwner);
    const driven = (row: Row): boolean => onCar(row) && optional(driverOk, row.driverId);
    const odometerRows = this.keepMemberAuthors(
      gate(this.stampUserId(data.odometer, userId), driven),
      consentedShares,
      (row) => [String(row.vehicleId)]
    );
    const addedOdometer = await insert(odometerEntries, odometerRows);
    const odometerOk = await mine(
      odometerEntries,
      odometerEntries.id,
      odometerEntries.vehicleId,
      odometerRows,
      ownCar
    );
    const addedTrips = await insert(
      trips,
      this.keepMemberAuthors(
        gate(this.stampUserId(data.trips, userId), driven),
        consentedShares,
        (row) => [String(row.vehicleId)]
      )
    );
    const addedShares = await insert(
      vehicleShares,
      gate(data.vehicleShares ?? [], onCar)
        .filter((share) => knownUserIds.has(String(share.sharedWithId)))
        .map((share) => ({
          ...share,
          ownerId: userId,
          level: clampShareLevel(share.level),
          status: this.resolveShareStatus(share, consentedShares),
        }))
    );
    if (!merge) await this.grantAcceptedShareRoles(tx, userId);
    const ownedProviders = await this.ownedProviderIds(tx, userId);
    const addedPreferences = await insert(
      userPreferences,
      this.stampUserId(data.userPreferences, userId).map((row) =>
        this.withoutCommunityConsent(
          this.keepOwnedProviderSettings(row, currentPrefs, ownedProviders)
        )
      )
    );
    const addedSyncState = await insert(syncState, this.stampUserId(data.syncState, userId));
    const entryVehicle = new Map<string, string>(
      [...(data.expenses ?? []), ...(data.odometer ?? [])].map((row) => [
        String(row.id),
        String(row.vehicleId),
      ])
    );
    const photoVehicle = (row: Row): string =>
      row.entityType === 'vehicle'
        ? String(row.entityId)
        : (entryVehicle.get(String(row.entityId)) ?? '');
    const entities: Record<string, Set<string>> = {
      vehicle: carOk,
      expense: expenseOk,
      insurance_policy: policyOk,
      insurance_claim: claimOk,
      odometer_entry: odometerOk,
    };
    const photoRows = this.keepMemberAuthors(
      gate(this.stampUserId(data.photos, userId), (row) =>
        Boolean(entities[String(row.entityType)]?.has(String(row.entityId)))
      ),
      consentedShares,
      (row) => [photoVehicle(row)]
    );
    const addedPhotos = await insert(photos, photoRows);
    const photoOk = await mine(photos, photos.id, photos.userId, photoRows, isOwner);
    const refRows = await this.relinkPhotoRefs(
      tx,
      gate((data.photoRefs ?? []) as Row[], (ref) => photoOk.has(String(ref.photoId))),
      data.metadata.storageProviders ?? {},
      userId
    );
    const knownProviders = await this.knownProviderIds(tx, refRows, userId);
    const addedPhotoRefs = await insert(
      photoRefs,
      refRows.filter((ref) => knownProviders.has(String(ref.providerId)))
    );
    return {
      vehicles: addedVehicles,
      expenses: addedExpenses,
      financing: addedFinancing,
      insurance: addedPolicies,
      insuranceTerms: addedTerms,
      insuranceTermVehicles: addedTermVehicles,
      insuranceClaims: addedClaims,
      reminders: addedReminders,
      reminderVehicles: addedReminderVehicles,
      reminderNotifications: addedNotifications,
      odometer: addedOdometer,
      photos: addedPhotos,
      photoRefs: addedPhotoRefs,
      userPreferences: addedPreferences,
      syncState: addedSyncState,
      trips: addedTrips,
      vehicleShares: addedShares,
      vehicleDrivers: addedDrivers,
    };
  }

  private withoutCommunityConsent<T extends Record<string, unknown>>(row: T): T {
    const region = row.communityRegion;
    return {
      ...row,
      communityStatsOptIn: false,
      communityStatsConsentedAt: null,
      communityRegion: typeof region === 'string' && isKnownRegion(region) ? region : null,
    };
  }

  private currentProviderPrefs(
    tx: AsyncHandle,
    userId: string
  ): Promise<ProviderScopedPrefs | undefined> {
    return tx
      .select({
        backupConfig: userPreferences.backupConfig,
        storageConfig: userPreferences.storageConfig,
        providerDefaults: userPreferences.providerDefaults,
      })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .then(firstRow);
  }

  private async ownedProviderIds(tx: AsyncHandle, userId: string): Promise<Map<string, string>> {
    const rows = await tx
      .select({ id: userProviders.id, domain: userProviders.domain })
      .from(userProviders)
      .where(eq(userProviders.userId, userId));
    return new Map(rows.map((row) => [row.id, row.domain]));
  }

  private keepOwnedProviderSettings<T extends Record<string, unknown>>(
    row: T,
    current: ProviderScopedPrefs | undefined,
    owned: Map<string, string>
  ): T {
    const ownedEntries = <V>(entries: Record<string, V> | undefined): Record<string, V> =>
      Object.fromEntries(Object.entries(entries ?? {}).filter(([id]) => owned.has(id)));
    const restoredBackup = row.backupConfig as BackupConfig | null | undefined;
    const restoredStorage = row.storageConfig as StorageConfig | null | undefined;
    const currentStorage = current?.storageConfig;
    const categories = Object.keys(
      DEFAULT_STORAGE_CONFIG.defaults
    ) as (keyof StorageConfig['defaults'])[];
    const defaults = Object.fromEntries(
      categories.map((category) => [
        category,
        [currentStorage?.defaults?.[category], restoredStorage?.defaults?.[category]].find(
          (id) => id != null && owned.has(id)
        ) ?? null,
      ])
    ) as StorageConfig['defaults'];
    const restoredDefaults = row.providerDefaults as ProviderDefaults | null | undefined;
    const providerDefaults = Object.fromEntries(
      DEFAULT_PROVIDER_CAPABILITIES.map((capability) => [
        capability,
        [current?.providerDefaults?.[capability], restoredDefaults?.[capability]].find(
          (id) =>
            id != null &&
            (owned.get(id) === CAPABILITY_DOMAIN[capability] ||
              (capability === 'ai.vision' && id === LOCAL_OCR_PROVIDER_ID))
        ) ?? null,
      ])
    ) as ProviderDefaults;
    return {
      ...row,
      providerDefaults,
      backupConfig: {
        providers: {
          ...ownedEntries(restoredBackup?.providers),
          ...ownedEntries(current?.backupConfig?.providers),
        },
      },
      storageConfig: {
        defaults,
        providerCategories: {
          ...ownedEntries(restoredStorage?.providerCategories),
          ...ownedEntries(currentStorage?.providerCategories),
        },
      },
    };
  }

  private async grantAcceptedShareRoles(tx: AsyncHandle, userId: string): Promise<void> {
    const accepted = await tx
      .select()
      .from(vehicleShares)
      .where(and(eq(vehicleShares.ownerId, userId), eq(vehicleShares.status, 'accepted')));
    for (const share of accepted) {
      if (!share.sharedWithId) continue;
      await changeShareRole(tx, {
        vehicleId: share.vehicleId,
        sharedWithId: share.sharedWithId,
        level: share.level,
        grantedBy: userId,
      });
    }
  }

  private async consentedShareKeys(tx: AsyncHandle, userId: string): Promise<Set<string>> {
    const rows = await tx
      .select({ vehicleId: vehicleShares.vehicleId, sharedWithId: vehicleShares.sharedWithId })
      .from(vehicleShares)
      .where(and(eq(vehicleShares.ownerId, userId), eq(vehicleShares.status, 'accepted')));
    return new Set(
      rows.flatMap((row) =>
        row.sharedWithId ? [shareConsentKey(row.vehicleId, row.sharedWithId)] : []
      )
    );
  }

  private resolveShareStatus(share: Record<string, unknown>, consented: Set<string>): string {
    const key = shareConsentKey(String(share.vehicleId), String(share.sharedWithId));
    return consented.has(key) ? 'accepted' : 'pending';
  }

  private async relinkPhotoRefs(
    tx: AsyncHandle,
    refRows: Record<string, unknown>[],
    backupProviders: Record<string, string>,
    userId: string
  ): Promise<Record<string, unknown>[]> {
    const ownedByIdentity = new Map<string, string | null>();
    const ownedIds = new Set<string>();
    for (const provider of await tx
      .select()
      .from(userProviders)
      .where(and(eq(userProviders.userId, userId), eq(userProviders.domain, 'storage')))) {
      ownedIds.add(provider.id);
      const identity = storageProviderIdentity(provider);
      if (identity) {
        ownedByIdentity.set(identity, ownedByIdentity.has(identity) ? null : provider.id);
      }
    }
    const targetOf = (providerId: string): string | null | undefined => {
      if (ownedIds.has(providerId)) return providerId;
      const identity = backupProviders[providerId];
      return typeof identity === 'string'
        ? ownedByIdentity.get(normalizeStorageIdentity(identity))
        : undefined;
    };
    const seen = new Set<string>();
    const relinked: Record<string, unknown>[] = [];
    for (const ref of refRows) {
      const target = targetOf(String(ref.providerId));
      if (!target) {
        relinked.push(ref);
        continue;
      }
      const key = `${String(ref.photoId)}\u0000${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      relinked.push({ ...ref, providerId: target });
    }
    return relinked;
  }

  private async knownProviderIds(
    tx: AsyncHandle,
    refRows: Record<string, unknown>[],
    userId: string
  ): Promise<Set<string>> {
    // Ownership matters: the sync worker resolves a ref's provider by id alone.
    const providerIds = [...new Set(refRows.map((ref) => String(ref.providerId)))];
    const known = new Set<string>();
    for (const batch of chunk(providerIds)) {
      for (const row of await tx
        .select({ id: userProviders.id })
        .from(userProviders)
        .where(and(inArray(userProviders.id, batch), eq(userProviders.userId, userId)))) {
        known.add(row.id);
      }
    }
    return known;
  }
}

export const restoreService = new RestoreService();
