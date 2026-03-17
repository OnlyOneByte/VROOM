/**
 * Google Sheets Service - Syncs VROOM data to Google Sheets
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { OAuth2Client } from 'google-auth-library';
import { google, type sheets_v4 } from 'googleapis';
import { getDb } from '../../../db/connection';
import {
  expenses,
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
  userPreferences,
  vehicleFinancing,
  vehicles,
} from '../../../db/schema';
import { SyncError, SyncErrorCode } from '../../../errors';
import { GoogleDriveService } from './google-drive-service';

export interface SpreadsheetInfo {
  id: string;
  name: string;
  webViewLink: string;
  sheets: { id: number; title: string }[];
}

export class GoogleSheetsService {
  private oauth2Client: OAuth2Client;
  private sheets: sheets_v4.Sheets;
  private driveService: GoogleDriveService;

  constructor(refreshToken: string) {
    this.oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    this.oauth2Client.setCredentials({
      refresh_token: refreshToken,
    });

    this.sheets = google.sheets({ version: 'v4', auth: this.oauth2Client });
    this.driveService = new GoogleDriveService(refreshToken);
  }

  async createOrUpdateVroomSpreadsheet(
    userId: string,
    folderPath: string,
    displayName: string
  ): Promise<SpreadsheetInfo> {
    // Walk the folder path segments (e.g. "VROOM/Backups") to find-or-create each folder
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

      const drive = google.drive({ version: 'v3', auth: this.oauth2Client });
      await drive.files.update({
        fileId: spreadsheetId,
        addParents: targetFolderId,
        removeParents: 'root',
      });
    }

    await this.updateSpreadsheetWithUserData(spreadsheetId, userId);
    return this.getSpreadsheetInfo(spreadsheetId);
  }

  /**
   * Walk a slash-separated folder path (e.g. "VROOM/Backups"), finding or creating
   * each segment in the Drive hierarchy. Returns the leaf folder's ID.
   */
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
        sheets: [
          { properties: { title: 'Vehicles' } },
          { properties: { title: 'Expenses' } },
          { properties: { title: 'Insurance Policies' } },
          { properties: { title: 'Insurance Terms' } },
          { properties: { title: 'Insurance Term Vehicles' } },
          { properties: { title: 'Vehicle Financing' } },
          { properties: { title: 'Odometer' } },
          { properties: { title: 'Photos' } },
          { properties: { title: 'Photo Refs' } },
          { properties: { title: 'User Preferences' } },
          { properties: { title: 'Sync State' } },
          { properties: { title: 'Reminders' } },
          { properties: { title: 'Reminder Vehicles' } },
          { properties: { title: 'Reminder Notifications' } },
        ],
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
    const requiredSheets = [
      'Vehicles',
      'Expenses',
      'Insurance Policies',
      'Insurance Terms',
      'Insurance Term Vehicles',
      'Vehicle Financing',
      'Odometer',
      'Photos',
      'Photo Refs',
      'User Preferences',
      'Sync State',
      'Reminders',
      'Reminder Vehicles',
      'Reminder Notifications',
    ];
    const info = await this.getSpreadsheetInfo(spreadsheetId);
    const existingTitles = new Set(info.sheets.map((s) => s.title));
    const missing = requiredSheets.filter((name) => !existingTitles.has(name));

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

    await Promise.all([
      this.updateSheet(spreadsheetId, 'Vehicles', userVehicles, this.getVehicleHeaders()),
      this.updateSheet(spreadsheetId, 'Expenses', userExpenses, this.getExpenseHeaders()),
      this.updateSheet(
        spreadsheetId,
        'Insurance Policies',
        userInsurance,
        this.getInsuranceHeaders()
      ),
      this.updateSheet(
        spreadsheetId,
        'Insurance Terms',
        userInsuranceTerms,
        this.getInsuranceTermHeaders()
      ),
      this.updateSheet(
        spreadsheetId,
        'Insurance Term Vehicles',
        userInsuranceTermVehicles,
        this.getInsuranceTermVehiclesHeaders()
      ),
      this.updateSheet(
        spreadsheetId,
        'Vehicle Financing',
        userFinancing.map((f) => f.vehicle_financing),
        this.getFinancingHeaders()
      ),
      this.updateSheet(spreadsheetId, 'Photos', userPhotos, this.getPhotoHeaders()),
      this.updateSheet(spreadsheetId, 'Photo Refs', userPhotoRefs, this.getPhotoRefHeaders()),
      this.updateSheet(
        spreadsheetId,
        'Odometer',
        userOdometer.map((o) => o.odometer_entries),
        this.getOdometerHeaders()
      ),
      this.updateSheet(
        spreadsheetId,
        'User Preferences',
        userPreferencesRows,
        this.getUserPreferencesHeaders()
      ),
      this.updateSheet(spreadsheetId, 'Sync State', syncStateRows, this.getSyncStateHeaders()),
      this.updateSheet(spreadsheetId, 'Reminders', userReminders, this.getReminderHeaders()),
      this.updateSheet(
        spreadsheetId,
        'Reminder Vehicles',
        userReminderVehicles,
        this.getReminderVehicleHeaders()
      ),
      this.updateSheet(
        spreadsheetId,
        'Reminder Notifications',
        userReminderNotifications,
        this.getReminderNotificationHeaders()
      ),
    ]);
  }

  private getVehicleHeaders() {
    return [
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
    ];
  }

  private getExpenseHeaders() {
    return [
      'id',
      'vehicleId',
      'userId',
      'tags',
      'category',
      'expenseAmount',
      'volume',
      'fuelType',
      'missedFillup',
      'date',
      'mileage',
      'description',
      'groupId',
      'groupTotal',
      'splitMethod',
      'sourceType',
      'sourceId',
      'createdAt',
      'updatedAt',
    ];
  }

  private getInsuranceHeaders() {
    return ['id', 'userId', 'company', 'isActive', 'notes', 'createdAt', 'updatedAt'];
  }

  private getInsuranceTermHeaders() {
    return [
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
    ];
  }

  private getInsuranceTermVehiclesHeaders() {
    return ['termId', 'vehicleId'];
  }

  private getFinancingHeaders() {
    return [
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
    ];
  }

  private getOdometerHeaders() {
    return [
      'id',
      'vehicleId',
      'userId',
      'odometer',
      'recordedAt',
      'note',
      'createdAt',
      'updatedAt',
    ];
  }

  private getPhotoHeaders() {
    return [
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
    ];
  }

  private getPhotoRefHeaders() {
    return [
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
    ];
  }

  private getUserPreferencesHeaders() {
    return [
      'userId',
      'unitPreferences',
      'currencyUnit',
      'autoBackupEnabled',
      'backupFrequency',
      'syncOnInactivity',
      'syncInactivityMinutes',
      'storageConfig',
      'backupConfig',
      'createdAt',
      'updatedAt',
    ];
  }

  private getSyncStateHeaders() {
    return ['userId', 'lastSyncDate', 'lastDataChangeDate', 'lastBackupDate'];
  }

  private getReminderHeaders() {
    return [
      'id',
      'userId',
      'name',
      'description',
      'type',
      'actionMode',
      'frequency',
      'intervalValue',
      'intervalUnit',
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
    ];
  }

  private getReminderVehicleHeaders() {
    return ['reminderId', 'vehicleId'];
  }

  private getReminderNotificationHeaders() {
    return ['id', 'reminderId', 'userId', 'dueDate', 'isRead', 'createdAt', 'updatedAt'];
  }

  private async updateSheet<T extends Record<string, unknown>>(
    spreadsheetId: string,
    sheetName: string,
    data: T[],
    headers: string[]
  ): Promise<void> {
    // Clear existing data before writing to remove stale rows
    await this.sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${sheetName}!A:Z`,
    });

    const values = [
      headers,
      ...data.map((row) => headers.map((header) => this.formatValue(row[header]))),
    ];

    await this.sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1:${String.fromCharCode(64 + headers.length)}${data.length + 1}`,
      valueInputOption: 'USER_ENTERED',
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

  async readSpreadsheetData(spreadsheetId: string): Promise<{
    metadata: { version: string; timestamp: string; userId: string };
    vehicles: Record<string, unknown>[];
    expenses: Record<string, unknown>[];
    financing: Record<string, unknown>[];
    insurance: Record<string, unknown>[];
    insuranceTerms: Record<string, unknown>[];
    insuranceTermVehicles: Record<string, unknown>[];
    photos: Record<string, unknown>[];
    odometer: Record<string, unknown>[];
    photoRefs: Record<string, unknown>[];
    userPreferences: Record<string, unknown>[];
    syncState: Record<string, unknown>[];
    reminders: Record<string, unknown>[];
    reminderVehicles: Record<string, unknown>[];
    reminderNotifications: Record<string, unknown>[];
  }> {
    const [
      vehiclesData,
      expensesData,
      insuranceData,
      insuranceTermsData,
      insuranceTermVehiclesData,
      financingData,
      photosData,
      odometerData,
      photoRefsData,
      userPreferencesData,
      syncStateData,
      remindersData,
      reminderVehiclesData,
      reminderNotificationsData,
    ] = await Promise.all([
      this.readSheetData(spreadsheetId, 'Vehicles!A:Z'),
      this.readSheetData(spreadsheetId, 'Expenses!A:Z'),
      this.readSheetData(spreadsheetId, 'Insurance Policies!A:Z'),
      this.readSheetData(spreadsheetId, 'Insurance Terms!A:Z').catch(() => []),
      this.readSheetData(spreadsheetId, 'Insurance Term Vehicles!A:Z').catch(() => []),
      this.readSheetData(spreadsheetId, 'Vehicle Financing!A:Z'),
      this.readSheetData(spreadsheetId, 'Photos!A:Z').catch(() => []),
      this.readSheetData(spreadsheetId, 'Odometer!A:Z').catch(() => []),
      this.readSheetData(spreadsheetId, 'Photo Refs!A:Z').catch(() => []),
      this.readSheetData(spreadsheetId, 'User Preferences!A:Z').catch(() => []),
      this.readSheetData(spreadsheetId, 'Sync State!A:Z').catch(() => []),
      this.readSheetData(spreadsheetId, 'Reminders!A:Z').catch(() => []),
      this.readSheetData(spreadsheetId, 'Reminder Vehicles!A:Z').catch(() => []),
      this.readSheetData(spreadsheetId, 'Reminder Notifications!A:Z').catch(() => []),
    ]);

    const vehicleRecords = this.parseSheetData(vehiclesData);
    const expenseRecords = this.parseSheetData(expensesData);
    const insurance = this.parseSheetData(insuranceData);
    const insuranceTermsRecords = this.parseSheetData(insuranceTermsData);
    const insuranceTermVehiclesRecords = this.parseSheetData(insuranceTermVehiclesData);
    const financing = this.parseSheetData(financingData);
    const photoRecords = this.parseSheetData(photosData);
    const odometer = this.parseSheetData(odometerData);
    const photoRefs = this.parseSheetData(photoRefsData);
    const userPreferencesRecords = this.parseSheetData(userPreferencesData);
    const syncStateRecords = this.parseSheetData(syncStateData);
    const remindersRecords = this.parseSheetData(remindersData);
    const reminderVehiclesRecords = this.parseSheetData(reminderVehiclesData);
    const reminderNotificationsRecords = this.parseSheetData(reminderNotificationsData);

    const userId = vehicleRecords.length > 0 ? (vehicleRecords[0].userId as string) : '';

    return {
      metadata: { version: '1.0.0', timestamp: new Date().toISOString(), userId },
      vehicles: vehicleRecords,
      expenses: expenseRecords,
      financing,
      insurance,
      insuranceTerms: insuranceTermsRecords,
      insuranceTermVehicles: insuranceTermVehiclesRecords,
      photos: photoRecords,
      odometer,
      photoRefs,
      userPreferences: userPreferencesRecords,
      syncState: syncStateRecords,
      reminders: remindersRecords,
      reminderVehicles: reminderVehiclesRecords,
      reminderNotifications: reminderNotificationsRecords,
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

/**
 * Create a GoogleSheetsService for a specific provider.
 * Queries DB by providerId + userId (ownership check), decrypts credentials.
 * Used by the restore path only — backup strategy instantiates directly.
 */
export async function createSheetsServiceForProvider(
  providerId: string,
  userId: string
): Promise<GoogleSheetsService> {
  const { userProviders } = await import('../../../db/schema');
  const { decrypt } = await import('../../../utils/encryption');
  const { NotFoundError, ValidationError } = await import('../../../errors');

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
