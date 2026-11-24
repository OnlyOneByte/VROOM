import { and, eq, inArray, ne } from 'drizzle-orm';
import { google, type sheets_v4 } from 'googleapis';
import { CONFIG } from '../../../config';
import { getDb } from '../../../db/connection';
import {
  expenses,
  insuranceClaims,
  insurancePolicies,
  insuranceTerms,
  insuranceTermVehicleSelectionOrder,
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
  vehicleFinancing,
  vehicleShares,
  vehicles,
} from '../../../db/schema';
import { NotFoundError, SyncError, SyncErrorCode, ValidationError } from '../../../errors';
import { logger } from '../../../utils/logger';
import { ownedVehiclesScope } from '../../../utils/vehicle-access';
import { decryptRefreshToken } from '../domains/storage/registry';
import { GoogleDriveService } from './google-drive-service';

// Hand-maintained: a schema column missing here is silently dropped from backups.
export const SHEET_HEADERS = {
  vehicles: [
    'id',
    'userId',
    'make',
    'model',
    'year',
    'vehicleType',
    'trackFuel',
    'trackCharging',
    'licensePlate',
    'nickname',
    'vin',
    'initialMileage',
    'purchasePrice',
    'purchaseDate',
    'unitPreferences',
    'catalogModelId',
    'vehicleKind',
    'createdAt',
    'updatedAt',
  ],
  expenses: [
    'id',
    'vehicleId',
    'userId',
    'createdBy',
    'clientId',
    'tags',
    'category',
    'expenseAmount',
    'volume',
    'fuelType',
    'missedFillup',
    'date',
    'mileage',
    'description',
    'location',
    'groupId',
    'groupTotal',
    'splitMethod',
    'sourceType',
    'sourceId',
    'createdAt',
    'updatedAt',
  ],
  insurance: ['id', 'userId', 'company', 'isActive', 'notes', 'createdAt', 'updatedAt'],
  insuranceTerms: [
    'id',
    'policyId',
    'startDate',
    'endDate',
    'policyNumber',
    'coverageDescription',
    'deductibleAmount',
    'coverageLimit',
    'agentName',
    'agentPhone',
    'agentEmail',
    'totalCost',
    'monthlyCost',
    'premiumFrequency',
    'paymentAmount',
    'createdAt',
    'updatedAt',
  ],
  insuranceTermVehicles: ['termId', 'vehicleId'],
  insuranceClaims: [
    'id',
    'policyId',
    'termId',
    'vehicleId',
    'claimDate',
    'claimType',
    'description',
    'status',
    'payoutAmount',
    'faultDesignation',
    'createdAt',
    'updatedAt',
  ],
  financing: [
    'id',
    'vehicleId',
    'financingType',
    'provider',
    'originalAmount',
    'apr',
    'termMonths',
    'startDate',
    'paymentAmount',
    'paymentFrequency',
    'paymentDayOfMonth',
    'paymentDayOfWeek',
    'residualValue',
    'mileageLimit',
    'excessMileageFee',
    'isActive',
    'endDate',
    'createdAt',
    'updatedAt',
  ],
  odometer: [
    'id',
    'vehicleId',
    'userId',
    'odometer',
    'recordedAt',
    'note',
    'sourceTripId',
    'createdBy',
    'createdAt',
    'updatedAt',
  ],
  photos: [
    'id',
    'userId',
    'entityType',
    'entityId',
    'fileName',
    'mimeType',
    'fileSize',
    'isCover',
    'sortOrder',
    'createdBy',
    'createdAt',
  ],
  photoRefs: [
    'id',
    'photoId',
    'providerId',
    'storageRef',
    'externalUrl',
    'status',
    'errorMessage',
    'retryCount',
    'syncedAt',
    'createdAt',
  ],
  userPreferences: [
    'userId',
    'unitPreferences',
    'currencyUnit',
    'themePreference',
    'businessMileageRate',
    'autoBackupEnabled',
    'backupFrequency',
    'syncOnInactivity',
    'syncInactivityMinutes',
    'storageConfig',
    'backupConfig',
    'providerDefaults',
    'communityStatsOptIn',
    'communityStatsConsentedAt',
    'communityRegion',
    'createdAt',
    'updatedAt',
  ],
  syncState: ['userId', 'lastSyncDate', 'lastDataChangeDate', 'lastBackupDate'],
  reminders: [
    'id',
    'userId',
    'name',
    'description',
    'type',
    'actionMode',
    'frequency',
    'intervalValue',
    'intervalUnit',
    'triggerMode',
    'intervalMileage',
    'lastServiceOdometer',
    'nextDueOdometer',
    'startDate',
    'endDate',
    'nextDueDate',
    'expenseCategory',
    'expenseTags',
    'expenseAmount',
    'expenseDescription',
    'expenseSplitConfig',
    'isActive',
    'lastTriggeredAt',
    'createdBy',
    'createdAt',
    'updatedAt',
  ],
  reminderVehicles: ['reminderId', 'vehicleId'],
  reminderNotifications: [
    'id',
    'reminderId',
    'userId',
    'dueDate',
    'dueOdometer',
    'isRead',
    'createdAt',
    'updatedAt',
  ],
  trips: [
    'id',
    'vehicleId',
    'userId',
    'startOdometer',
    'endOdometer',
    'purpose',
    'tripDate',
    'startLocation',
    'endLocation',
    'note',
    'createdBy',
    'createdAt',
    'updatedAt',
  ],
  vehicleShares: [
    'id',
    'vehicleId',
    'ownerId',
    'sharedWithId',
    'level',
    'status',
    'invitedEmail',
    'createdAt',
    'updatedAt',
  ],
} as const satisfies Record<string, readonly string[]>;

export const SHEET_TABS = {
  vehicles: 'Vehicles',
  expenses: 'Expenses',
  insurance: 'Insurance Policies',
  insuranceTerms: 'Insurance Terms',
  insuranceTermVehicles: 'Insurance Term Vehicles',
  insuranceClaims: 'Insurance Claims',
  financing: 'Vehicle Financing',
  odometer: 'Odometer',
  photos: 'Photos',
  photoRefs: 'Photo Refs',
  userPreferences: 'User Preferences',
  syncState: 'Sync State',
  reminders: 'Reminders',
  reminderVehicles: 'Reminder Vehicles',
  reminderNotifications: 'Reminder Notifications',
  trips: 'Trips',
  vehicleShares: 'Vehicle Shares',
} as const satisfies Record<keyof typeof SHEET_HEADERS, string>;

type SheetTableKey = keyof typeof SHEET_TABS;

const REQUIRED_SHEET_TABS = new Set<SheetTableKey>([
  'vehicles',
  'expenses',
  'insurance',
  'financing',
]);

export function columnLetter(columnNumber: number): string {
  let letters = '';
  for (let n = columnNumber; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return letters;
}

const SHEET_READ_LAST_COLUMN = 'ZZ';

export const SHEET_METADATA_TAB = 'Metadata';
const CENTS_FORMAT_VERSION = '2.0.0';
const PRE_CENTS_FORMAT_VERSION = '1.0.0';
const SHEET_METADATA_HEADERS = ['version', 'timestamp', 'userId'] as const;

const CENTS_ERA_EXPENSE_HEADER = 'createdBy';

// Order matters: the backup swap indexes each tab by position.
export const SHEET_NAMES: string[] = [...Object.values(SHEET_TABS), SHEET_METADATA_TAB];

// Keep titles space-free: ranges would otherwise need A1 quoting.
export const SHEET_STAGING_SUFFIX = '__vroom_staging';

interface SpreadsheetInfo {
  id: string;
  name: string;
  webViewLink: string;
  sheets: { id: number; title: string }[];
}

export interface GoogleSheetsClients {
  sheets: sheets_v4.Sheets;
  driveService: GoogleDriveService;
}

export class GoogleSheetsService {
  private sheets: sheets_v4.Sheets;
  private driveService: GoogleDriveService;

  constructor(refreshToken: string, clients?: GoogleSheetsClients) {
    if (clients) {
      this.sheets = clients.sheets;
      this.driveService = clients.driveService;
      return;
    }

    const oauth2Client = new google.auth.OAuth2(
      CONFIG.auth.googleClientId,
      CONFIG.auth.googleClientSecret,
      CONFIG.auth.googleStorageRedirectUri
    );

    oauth2Client.setCredentials({
      refresh_token: refreshToken,
    });

    this.sheets = google.sheets({ version: 'v4', auth: oauth2Client });
    this.driveService = new GoogleDriveService(refreshToken);
  }

  async createOrUpdateVroomSpreadsheet(
    userId: string,
    folderPath: string,
    displayName: string
  ): Promise<SpreadsheetInfo> {
    const targetFolderId = await this.resolveOrCreateFolderPath(folderPath);

    const spreadsheetName = `VROOM Data - ${displayName}`;
    const existingSpreadsheet = await this.findVroomSpreadsheet(targetFolderId, displayName);

    let spreadsheetId: string;
    if (existingSpreadsheet) {
      spreadsheetId = existingSpreadsheet.id;
    } else {
      const spreadsheet = await this.createSpreadsheet(spreadsheetName);
      if (!spreadsheet.spreadsheetId) {
        throw new SyncError(
          SyncErrorCode.NETWORK_ERROR,
          'Failed to create spreadsheet in Google Sheets'
        );
      }
      spreadsheetId = spreadsheet.spreadsheetId;

      await this.driveService.moveFile(spreadsheetId, targetFolderId, 'root');
    }

    await this.updateSpreadsheetWithUserData(spreadsheetId, userId);
    return this.getSpreadsheetInfo(spreadsheetId);
  }

  private async resolveOrCreateFolderPath(folderPath: string): Promise<string> {
    const segments = folderPath
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean);

    if (segments.length === 0) {
      throw new ValidationError('Backup folder path cannot be empty');
    }

    let parentId = '';
    for (const segment of segments) {
      const existing = await this.driveService.findFolder(segment, parentId || undefined);
      if (existing) {
        parentId = existing.id;
      } else {
        const created = await this.driveService.createFolder(segment, parentId || undefined);
        parentId = created.id;
      }
    }

    return parentId;
  }

  private async findVroomSpreadsheet(
    mainFolderId: string,
    userName: string
  ): Promise<{ id: string; name: string } | null> {
    const spreadsheetName = `VROOM Data - ${userName}`;
    const files = await this.driveService.listFilesInFolder(mainFolderId);
    const found = files.find(
      (file) =>
        file.name === spreadsheetName && file.mimeType === 'application/vnd.google-apps.spreadsheet'
    );
    return found ? { id: found.id, name: found.name } : null;
  }

  private async createSpreadsheet(title: string): Promise<sheets_v4.Schema$Spreadsheet> {
    const response = await this.sheets.spreadsheets.create({
      requestBody: {
        properties: { title },
        sheets: SHEET_NAMES.map((sheetTitle) => ({ properties: { title: sheetTitle } })),
      },
    });
    return response.data;
  }

  async getSpreadsheetInfo(spreadsheetId: string): Promise<SpreadsheetInfo> {
    const response = await this.sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'spreadsheetId,properties,sheets.properties',
    });

    const spreadsheet = response.data;
    if (!spreadsheet.spreadsheetId || !spreadsheet.properties?.title) {
      throw new ValidationError('Invalid spreadsheet data returned from Google Sheets');
    }

    return {
      id: spreadsheet.spreadsheetId,
      name: spreadsheet.properties.title,
      webViewLink: `https://docs.google.com/spreadsheets/d/${spreadsheet.spreadsheetId}`,
      sheets:
        spreadsheet.sheets?.map((sheet: sheets_v4.Schema$Sheet) => ({
          id: sheet.properties?.sheetId || 0,
          title: sheet.properties?.title || 'Untitled',
        })) || [],
    };
  }

  private async ensureRequiredSheets(spreadsheetId: string): Promise<void> {
    const info = await this.getSpreadsheetInfo(spreadsheetId);
    const existingTitles = new Set(info.sheets.map((s) => s.title));
    const missing = SHEET_NAMES.filter((name) => !existingTitles.has(name));

    if (missing.length > 0) {
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: missing.map((title) => ({
            addSheet: { properties: { title } },
          })),
        },
      });
    }
  }

  private async queryIfNonEmpty<T>(
    ids: readonly unknown[],
    query: () => Promise<T[]>
  ): Promise<T[]> {
    return ids.length > 0 ? query() : [];
  }

  private async updateSpreadsheetWithUserData(
    spreadsheetId: string,
    userId: string
  ): Promise<void> {
    await this.ensureRequiredSheets(spreadsheetId);
    const db = getDb();

    const [userVehicles, userExpenses, userInsurance, userFinancing, userOdometer] =
      await Promise.all([
        db.select().from(vehicles).where(ownedVehiclesScope(userId)),
        db.select().from(expenses).where(eq(expenses.userId, userId)),
        db.select().from(insurancePolicies).where(eq(insurancePolicies.userId, userId)),
        db
          .select()
          .from(vehicleFinancing)
          .innerJoin(vehicles, eq(vehicleFinancing.vehicleId, vehicles.id))
          .where(ownedVehiclesScope(userId)),
        db
          .select()
          .from(odometerEntries)
          .innerJoin(vehicles, eq(odometerEntries.vehicleId, vehicles.id))
          .where(ownedVehiclesScope(userId)),
      ]);

    const policyIds = userInsurance.map((p) => p.id);
    const userInsuranceTerms = await this.queryIfNonEmpty(policyIds, () =>
      db.select().from(insuranceTerms).where(inArray(insuranceTerms.policyId, policyIds))
    );

    const termIds = userInsuranceTerms.map((t) => t.id);
    const userInsuranceTermVehicles = await this.queryIfNonEmpty(termIds, () =>
      db
        .select()
        .from(insuranceTermVehicles)
        .where(inArray(insuranceTermVehicles.termId, termIds))
        .orderBy(insuranceTermVehicleSelectionOrder)
    );

    const userInsuranceClaims = await this.queryIfNonEmpty(policyIds, () =>
      db.select().from(insuranceClaims).where(inArray(insuranceClaims.policyId, policyIds))
    );

    const userPhotos = await db.select().from(photos).where(eq(photos.userId, userId));

    // SQLite caps bound parameters per statement; batch to stay under it.
    const photoIds = userPhotos.map((p) => p.id);
    const userPhotoRefs: (typeof photoRefs.$inferSelect)[] = [];
    const BATCH_SIZE = 500;
    for (let i = 0; i < photoIds.length; i += BATCH_SIZE) {
      const batch = photoIds.slice(i, i + BATCH_SIZE);
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
    const userReminderVehicles = await this.queryIfNonEmpty(reminderIds, () =>
      db.select().from(reminderVehicles).where(inArray(reminderVehicles.reminderId, reminderIds))
    );
    const userReminderNotifications = await db
      .select()
      .from(reminderNotifications)
      .where(eq(reminderNotifications.userId, userId));

    const userTrips = await db.select().from(trips).where(eq(trips.userId, userId));

    const userVehicleShares = await db
      .select()
      .from(vehicleShares)
      .where(and(eq(vehicleShares.ownerId, userId), eq(vehicleShares.status, 'accepted')));

    const rowsByTable: Record<SheetTableKey, Record<string, unknown>[]> = {
      vehicles: userVehicles,
      expenses: userExpenses,
      insurance: userInsurance,
      insuranceTerms: userInsuranceTerms,
      insuranceTermVehicles: userInsuranceTermVehicles,
      insuranceClaims: userInsuranceClaims,
      financing: userFinancing.map((f) => f.vehicle_financing),
      odometer: userOdometer.map((o) => o.odometer_entries),
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

    const tables = (Object.keys(SHEET_TABS) as SheetTableKey[]).map((key) => ({
      title: SHEET_TABS[key] as string,
      rows: rowsByTable[key],
      headers: SHEET_HEADERS[key] as readonly string[],
    }));
    tables.push({
      title: SHEET_METADATA_TAB,
      rows: [
        {
          version: CONFIG.backup.currentVersion,
          timestamp: new Date().toISOString(),
          userId,
        },
      ],
      headers: SHEET_METADATA_HEADERS,
    });

    await this.writeAllSheetsAtomically(spreadsheetId, tables);
  }

  private async writeAllSheetsAtomically(
    spreadsheetId: string,
    tables: { title: string; rows: Record<string, unknown>[]; headers: readonly string[] }[]
  ): Promise<void> {
    const stagingTitles = tables.map((t) => `${t.title}${SHEET_STAGING_SUFFIX}`);
    await this.deleteSheetsByTitle(spreadsheetId, stagingTitles);

    try {
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: stagingTitles.map((title) => ({ addSheet: { properties: { title } } })),
        },
      });
      await Promise.all(
        tables.map((t) =>
          this.writeSheetValues(
            spreadsheetId,
            `${t.title}${SHEET_STAGING_SUFFIX}`,
            t.rows,
            t.headers
          )
        )
      );
    } catch (err) {
      await this.deleteSheetsByTitle(spreadsheetId, stagingTitles).catch(() => undefined);
      throw err;
    }

    // Sheets appends new tabs at the end, so the index must be set explicitly.
    const info = await this.getSpreadsheetInfo(spreadsheetId);
    const idByTitle = new Map(info.sheets.map((s) => [s.title, s.id]));
    const requests: sheets_v4.Schema$Request[] = [];
    for (const t of tables) {
      const oldId = idByTitle.get(t.title);
      if (oldId !== undefined) {
        requests.push({ deleteSheet: { sheetId: oldId } });
      }
    }
    tables.forEach((t, index) => {
      const stagingId = idByTitle.get(`${t.title}${SHEET_STAGING_SUFFIX}`);
      if (stagingId !== undefined) {
        requests.push({
          updateSheetProperties: {
            properties: { sheetId: stagingId, title: t.title, index },
            fields: 'title,index',
          },
        });
      }
    });
    await this.sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
  }

  private async deleteSheetsByTitle(spreadsheetId: string, titles: string[]): Promise<void> {
    const info = await this.getSpreadsheetInfo(spreadsheetId);
    const wanted = new Set(titles);
    const requests = info.sheets
      .filter((s) => wanted.has(s.title))
      .map((s) => ({ deleteSheet: { sheetId: s.id } }));
    if (requests.length > 0) {
      await this.sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
    }
  }

  private async writeSheetValues<T extends Record<string, unknown>>(
    spreadsheetId: string,
    sheetName: string,
    data: T[],
    headers: readonly string[]
  ): Promise<void> {
    const values = [
      [...headers],
      ...data.map((row) => headers.map((header) => this.formatValue(row[header]))),
    ];

    await this.sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1:${columnLetter(headers.length)}${data.length + 1}`,
      // RAW, not USER_ENTERED: USER_ENTERED turns values like '=...' into formulas.
      valueInputOption: 'RAW',
      requestBody: { values },
    });
  }

  private formatValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  async readSheetData(
    spreadsheetId: string,
    range: string
  ): Promise<(string | number | boolean)[][]> {
    const response = await this.sheets.spreadsheets.values.get({ spreadsheetId, range });
    return response.data.values || [];
  }

  async readSpreadsheetData(
    spreadsheetId: string
  ): Promise<
    { metadata: { version: string; timestamp: string; userId: string } } & Record<
      SheetTableKey,
      Record<string, unknown>[]
    >
  > {
    const info = await this.getSpreadsheetInfo(spreadsheetId);
    const presentTabs = new Set(info.sheets.map((sheet) => sheet.title));
    const records = {} as Record<SheetTableKey, Record<string, unknown>[]>;
    let expenseHeaders: unknown[] = [];
    for (const key of Object.keys(SHEET_TABS) as SheetTableKey[]) {
      const title = SHEET_TABS[key];
      const absentOptionalTab = !REQUIRED_SHEET_TABS.has(key) && !presentTabs.has(title);
      const grid = absentOptionalTab
        ? []
        : await this.readSheetData(spreadsheetId, `${title}!A:${SHEET_READ_LAST_COLUMN}`);
      if (key === 'expenses') expenseHeaders = grid[0] ?? [];
      records[key] = this.parseSheetData(grid);
    }

    const [written] = presentTabs.has(SHEET_METADATA_TAB)
      ? this.parseSheetData(
          await this.readSheetData(
            spreadsheetId,
            `${SHEET_METADATA_TAB}!A:${SHEET_READ_LAST_COLUMN}`
          )
        )
      : [];
    const userId =
      records.vehicles.length > 0
        ? String(records.vehicles[0].userId)
        : String(written?.userId ?? '');

    const preCentsLayout =
      expenseHeaders.length > 0 && !expenseHeaders.includes(CENTS_ERA_EXPENSE_HEADER);
    const inferredVersion = preCentsLayout ? PRE_CENTS_FORMAT_VERSION : CENTS_FORMAT_VERSION;
    if (!written?.version) {
      logger.info('Sheets mirror has no recorded version; inferred it from its layout', {
        spreadsheetId,
        inferredVersion,
      });
    }

    return {
      metadata: {
        version: String(written?.version || inferredVersion),
        timestamp: String(written?.timestamp ?? new Date().toISOString()),
        userId,
      },
      ...records,
    };
  }

  private parseSheetData(sheetData: (string | number | boolean)[][]): Record<string, unknown>[] {
    if (sheetData.length === 0) return [];

    const headers = sheetData[0] as string[];
    const rows = sheetData.slice(1);

    return rows.map((row) => {
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < headers.length; i++) {
        const cell = row[i];
        obj[headers[i]] = cell === undefined || cell === '' ? null : String(cell);
      }
      return obj;
    });
  }
}

export async function createSheetsServiceForProvider(
  providerId: string,
  userId: string
): Promise<GoogleSheetsService> {
  const db = getDb();
  const providerRow = await db
    .select()
    .from(userProviders)
    .where(
      and(
        eq(userProviders.id, providerId),
        eq(userProviders.userId, userId),
        eq(userProviders.domain, 'storage'),
        ne(userProviders.status, 'disabled')
      )
    )
    .limit(1);

  if (!providerRow.length) {
    throw new NotFoundError('Provider');
  }

  return new GoogleSheetsService(decryptRefreshToken(providerRow[0]));
}
