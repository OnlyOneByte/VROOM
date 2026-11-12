import { and, eq, inArray } from 'drizzle-orm';
import { google, type sheets_v4 } from 'googleapis';
import { getDb } from '../../../db/connection';
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
  vehicleFinancing,
  vehicleShares,
  vehicles,
} from '../../../db/schema';
import { NotFoundError, SyncError, SyncErrorCode, ValidationError } from '../../../errors';
import { decrypt } from '../../../utils/encryption';
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

// Order matters: the backup swap indexes each tab by position.
export const SHEET_NAMES = Object.values(SHEET_TABS);

// Keep titles space-free: ranges would otherwise need A1 quoting.
export const SHEET_STAGING_SUFFIX = '__vroom_staging';

export interface SpreadsheetInfo {
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
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
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
      throw new SyncError(SyncErrorCode.VALIDATION_ERROR, 'Backup folder path cannot be empty');
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
      throw new SyncError(
        SyncErrorCode.VALIDATION_ERROR,
        'Invalid spreadsheet data returned from Google Sheets'
      );
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
        db.select().from(vehicles).where(eq(vehicles.userId, userId)),
        db.select().from(expenses).where(eq(expenses.userId, userId)),
        db.select().from(insurancePolicies).where(eq(insurancePolicies.userId, userId)),
        db
          .select()
          .from(vehicleFinancing)
          .innerJoin(vehicles, eq(vehicleFinancing.vehicleId, vehicles.id))
          .where(eq(vehicles.userId, userId)),
        db
          .select()
          .from(odometerEntries)
          .innerJoin(vehicles, eq(odometerEntries.vehicleId, vehicles.id))
          .where(eq(vehicles.userId, userId)),
      ]);

    const policyIds = userInsurance.map((p) => p.id);
    const userInsuranceTerms = await this.queryIfNonEmpty(policyIds, () =>
      db.select().from(insuranceTerms).where(inArray(insuranceTerms.policyId, policyIds))
    );

    const termIds = userInsuranceTerms.map((t) => t.id);
    const userInsuranceTermVehicles = await this.queryIfNonEmpty(termIds, () =>
      db.select().from(insuranceTermVehicles).where(inArray(insuranceTermVehicles.termId, termIds))
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
      title: SHEET_TABS[key],
      rows: rowsByTable[key],
      headers: SHEET_HEADERS[key],
    }));

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
      range: `${sheetName}!A1:${String.fromCharCode(64 + headers.length)}${data.length + 1}`,
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

  private readTab(
    spreadsheetId: string,
    key: SheetTableKey,
    optional = false
  ): Promise<(string | number | boolean)[][]> {
    const read = this.readSheetData(spreadsheetId, `${SHEET_TABS[key]}!A:Z`);
    return optional ? read.catch(() => []) : read;
  }

  async readSpreadsheetData(spreadsheetId: string): Promise<{
    metadata: { version: string; timestamp: string; userId: string };
    vehicles: Record<string, unknown>[];
    expenses: Record<string, unknown>[];
    financing: Record<string, unknown>[];
    insurance: Record<string, unknown>[];
    insuranceTerms: Record<string, unknown>[];
    insuranceTermVehicles: Record<string, unknown>[];
    insuranceClaims: Record<string, unknown>[];
    photos: Record<string, unknown>[];
    odometer: Record<string, unknown>[];
    photoRefs: Record<string, unknown>[];
    userPreferences: Record<string, unknown>[];
    syncState: Record<string, unknown>[];
    reminders: Record<string, unknown>[];
    reminderVehicles: Record<string, unknown>[];
    reminderNotifications: Record<string, unknown>[];
    trips: Record<string, unknown>[];
    vehicleShares: Record<string, unknown>[];
  }> {
    const [
      vehiclesData,
      expensesData,
      insuranceData,
      insuranceTermsData,
      insuranceTermVehiclesData,
      insuranceClaimsData,
      financingData,
      photosData,
      odometerData,
      photoRefsData,
      userPreferencesData,
      syncStateData,
      remindersData,
      reminderVehiclesData,
      reminderNotificationsData,
      tripsData,
      vehicleSharesData,
    ] = await Promise.all([
      this.readTab(spreadsheetId, 'vehicles'),
      this.readTab(spreadsheetId, 'expenses'),
      this.readTab(spreadsheetId, 'insurance'),
      this.readTab(spreadsheetId, 'insuranceTerms', true),
      this.readTab(spreadsheetId, 'insuranceTermVehicles', true),
      this.readTab(spreadsheetId, 'insuranceClaims', true),
      this.readTab(spreadsheetId, 'financing'),
      this.readTab(spreadsheetId, 'photos', true),
      this.readTab(spreadsheetId, 'odometer', true),
      this.readTab(spreadsheetId, 'photoRefs', true),
      this.readTab(spreadsheetId, 'userPreferences', true),
      this.readTab(spreadsheetId, 'syncState', true),
      this.readTab(spreadsheetId, 'reminders', true),
      this.readTab(spreadsheetId, 'reminderVehicles', true),
      this.readTab(spreadsheetId, 'reminderNotifications', true),
      this.readTab(spreadsheetId, 'trips', true),
      this.readTab(spreadsheetId, 'vehicleShares', true),
    ]);

    const vehicleRecords = this.parseSheetData(vehiclesData);
    const expenseRecords = this.parseSheetData(expensesData);
    const insurance = this.parseSheetData(insuranceData);
    const insuranceTermsRecords = this.parseSheetData(insuranceTermsData);
    const insuranceTermVehiclesRecords = this.parseSheetData(insuranceTermVehiclesData);
    const insuranceClaimsRecords = this.parseSheetData(insuranceClaimsData);
    const financing = this.parseSheetData(financingData);
    const photoRecords = this.parseSheetData(photosData);
    const odometer = this.parseSheetData(odometerData);
    const photoRefs = this.parseSheetData(photoRefsData);
    const userPreferencesRecords = this.parseSheetData(userPreferencesData);
    const syncStateRecords = this.parseSheetData(syncStateData);
    const remindersRecords = this.parseSheetData(remindersData);
    const reminderVehiclesRecords = this.parseSheetData(reminderVehiclesData);
    const reminderNotificationsRecords = this.parseSheetData(reminderNotificationsData);
    const tripsRecords = this.parseSheetData(tripsData);
    const vehicleSharesRecords = this.parseSheetData(vehicleSharesData);

    const userId = vehicleRecords.length > 0 ? (vehicleRecords[0].userId as string) : '';

    return {
      metadata: { version: '1.0.0', timestamp: new Date().toISOString(), userId },
      vehicles: vehicleRecords,
      expenses: expenseRecords,
      financing,
      insurance,
      insuranceTerms: insuranceTermsRecords,
      insuranceTermVehicles: insuranceTermVehiclesRecords,
      insuranceClaims: insuranceClaimsRecords,
      photos: photoRecords,
      odometer,
      photoRefs,
      userPreferences: userPreferencesRecords,
      syncState: syncStateRecords,
      reminders: remindersRecords,
      reminderVehicles: reminderVehiclesRecords,
      reminderNotifications: reminderNotificationsRecords,
      trips: tripsRecords,
      vehicleShares: vehicleSharesRecords,
    };
  }

  private parseSheetData(sheetData: (string | number | boolean)[][]): Record<string, unknown>[] {
    if (sheetData.length === 0) return [];

    const headers = sheetData[0] as string[];
    const rows = sheetData.slice(1);

    return rows.map((row) => {
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < headers.length; i++) {
        obj[headers[i]] = this.parseValue(row[i]);
      }
      return obj;
    });
  }

  private parseValue(value: string | number | boolean | undefined): unknown {
    if (value === '' || value === null || value === undefined) return null;
    if (value === 'true' || value === 'false') return value === 'true';
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      if (!Number.isNaN(Number(value)) && value.trim() !== '') return Number(value);
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) return new Date(value);
    }
    return value;
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
        eq(userProviders.status, 'active')
      )
    )
    .limit(1);

  if (!providerRow.length) {
    throw new NotFoundError('Provider');
  }

  let credentials: { refreshToken?: string };
  try {
    credentials = JSON.parse(decrypt(providerRow[0].credentials)) as { refreshToken?: string };
  } catch {
    throw new ValidationError('Failed to decrypt provider credentials');
  }

  if (!credentials.refreshToken) {
    throw new ValidationError(
      'Provider has no refresh token. Please re-connect your Google account.'
    );
  }

  return new GoogleSheetsService(credentials.refreshToken);
}
