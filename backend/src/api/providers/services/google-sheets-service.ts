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
  insurancePolicyVehicles,
  odometerEntries,
  photoRefs,
  photos,
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
    folderName: string
  ): Promise<SpreadsheetInfo> {
    const folderStructure = await this.driveService.createVroomFolderStructure(folderName);
    const existingSpreadsheet = await this.findVroomSpreadsheet(
      folderStructure.mainFolder.id,
      folderName
    );

    let spreadsheetId: string;
    if (existingSpreadsheet) {
      spreadsheetId = existingSpreadsheet.id;
    } else {
      const spreadsheet = await this.createSpreadsheet(`VROOM Data - ${folderName}`);
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
        addParents: folderStructure.mainFolder.id,
        removeParents: 'root',
      });
    }

    await this.updateSpreadsheetWithUserData(spreadsheetId, userId);
    return this.getSpreadsheetInfo(spreadsheetId);
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
          { properties: { title: 'Insurance Policy Vehicles' } },
          { properties: { title: 'Vehicle Financing' } },
          { properties: { title: 'Odometer' } },
          { properties: { title: 'Photos' } },
          { properties: { title: 'Photo Refs' } },
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
      'Insurance Policy Vehicles',
      'Vehicle Financing',
      'Odometer',
      'Photos',
      'Photo Refs',
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

    // Query junction rows for user's insurance policies
    const policyIds = userInsurance.map((p) => p.id);
    const userInsurancePolicyVehicles =
      policyIds.length > 0
        ? await db
            .select()
            .from(insurancePolicyVehicles)
            .where(inArray(insurancePolicyVehicles.policyId, policyIds))
        : [];

    // Query photos for all user-owned entities
    const vehicleIds = userVehicles.map((v) => v.id);
    const expenseIds = userExpenses.map((e) => e.id);
    const odometerEntryIds = userOdometer.map((o) => o.odometer_entries.id);

    const userPhotos = await this.queryUserPhotos(db, {
      vehicleIds,
      expenseIds,
      policyIds,
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
        'Insurance Policy Vehicles',
        userInsurancePolicyVehicles,
        this.getInsurancePolicyVehiclesHeaders()
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
      'fuelAmount',
      'fuelType',
      'isFinancingPayment',
      'missedFillup',
      'date',
      'mileage',
      'description',
      'receiptUrl',
      'groupId',
      'groupTotal',
      'splitMethod',
      'insurancePolicyId',
      'insuranceTermId',
      'createdAt',
      'updatedAt',
    ];
  }

  private getInsuranceHeaders() {
    return [
      'id',
      'userId',
      'company',
      'isActive',
      'currentTermStart',
      'currentTermEnd',
      'terms',
      'notes',
      'createdAt',
      'updatedAt',
    ];
  }

  private getInsurancePolicyVehiclesHeaders() {
    return ['policyId', 'termId', 'vehicleId'];
  }

  private getFinancingHeaders() {
    return [
      'id',
      'vehicleId',
      'financingType',
      'provider',
      'originalAmount',
      'currentBalance',
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
      'linkedEntityType',
      'linkedEntityId',
      'createdAt',
      'updatedAt',
    ];
  }

  private getPhotoHeaders() {
    return [
      'id',
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

  private async queryUserPhotos(
    db: ReturnType<typeof getDb>,
    entityIds: {
      vehicleIds: string[];
      expenseIds: string[];
      policyIds: string[];
      odometerEntryIds: string[];
    }
  ) {
    const allPhotos = [];

    const entityQueries: { type: string; ids: string[] }[] = [
      { type: 'vehicle', ids: entityIds.vehicleIds },
      { type: 'expense', ids: entityIds.expenseIds },
      { type: 'insurance_policy', ids: entityIds.policyIds },
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
    insurancePolicyVehicles: Record<string, unknown>[];
    photos: Record<string, unknown>[];
    odometer: Record<string, unknown>[];
    photoRefs: Record<string, unknown>[];
  }> {
    const [
      vehiclesData,
      expensesData,
      insuranceData,
      insurancePolicyVehiclesData,
      financingData,
      photosData,
      odometerData,
      photoRefsData,
    ] = await Promise.all([
      this.readSheetData(spreadsheetId, 'Vehicles!A:Z'),
      this.readSheetData(spreadsheetId, 'Expenses!A:Z'),
      this.readSheetData(spreadsheetId, 'Insurance Policies!A:Z'),
      this.readSheetData(spreadsheetId, 'Insurance Policy Vehicles!A:Z'),
      this.readSheetData(spreadsheetId, 'Vehicle Financing!A:Z'),
      this.readSheetData(spreadsheetId, 'Photos!A:Z').catch(() => []),
      this.readSheetData(spreadsheetId, 'Odometer!A:Z').catch(() => []),
      this.readSheetData(spreadsheetId, 'Photo Refs!A:Z').catch(() => []),
    ]);

    const vehicleRecords = this.parseSheetData(vehiclesData);
    const expenseRecords = this.parseSheetData(expensesData);
    const insurance = this.parseSheetData(insuranceData);
    const insurancePolicyVehicles = this.parseSheetData(insurancePolicyVehiclesData);
    const financing = this.parseSheetData(financingData);
    const photoRecords = this.parseSheetData(photosData);
    const odometer = this.parseSheetData(odometerData);
    const photoRefs = this.parseSheetData(photoRefsData);

    const userId = vehicleRecords.length > 0 ? (vehicleRecords[0].userId as string) : '';

    return {
      metadata: { version: '1.0.0', timestamp: new Date().toISOString(), userId },
      vehicles: vehicleRecords,
      expenses: expenseRecords,
      financing,
      insurance,
      insurancePolicyVehicles,
      photos: photoRecords,
      odometer,
      photoRefs,
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
