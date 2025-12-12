/**
 * Google Sheets Service - Syncs VROOM data to Google Sheets
 */

import { eq } from 'drizzle-orm';
import type { OAuth2Client } from 'google-auth-library';
import { google, type sheets_v4 } from 'googleapis';
import { getDb } from '../../db/connection';
import {
  expenses,
  insurancePolicies,
  users,
  vehicleFinancing,
  vehicleFinancingPayments,
  vehicles,
} from '../../db/schema';
import { GoogleDriveService } from './google-drive';

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

  constructor(accessToken: string, refreshToken?: string) {
    this.oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    this.oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    this.sheets = google.sheets({ version: 'v4', auth: this.oauth2Client });
    this.driveService = new GoogleDriveService(accessToken, refreshToken);
  }

  async createOrUpdateVroomSpreadsheet(userId: string, userName: string): Promise<SpreadsheetInfo> {
    const folderStructure = await this.driveService.createVroomFolderStructure(userName);
    const existingSpreadsheet = await this.findVroomSpreadsheet(
      folderStructure.mainFolder.id,
      userName
    );

    let spreadsheetId: string;
    if (existingSpreadsheet) {
      spreadsheetId = existingSpreadsheet.id;
    } else {
      const spreadsheet = await this.createSpreadsheet(`VROOM Data - ${userName}`);
      if (!spreadsheet.spreadsheetId) {
        throw new Error('Failed to create spreadsheet');
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
          { properties: { title: 'Vehicle Financing' } },
          { properties: { title: 'Vehicle Financing Payments' } },
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
      throw new Error('Invalid spreadsheet data');
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

  private async updateSpreadsheetWithUserData(
    spreadsheetId: string,
    userId: string
  ): Promise<void> {
    const db = getDb();

    const [userVehicles, userExpenses, userInsurance, userFinancing, userFinancingPayments] =
      await Promise.all([
        db.select().from(vehicles).where(eq(vehicles.userId, userId)),
        db
          .select()
          .from(expenses)
          .innerJoin(vehicles, eq(expenses.vehicleId, vehicles.id))
          .where(eq(vehicles.userId, userId)),
        db
          .select()
          .from(insurancePolicies)
          .innerJoin(vehicles, eq(insurancePolicies.vehicleId, vehicles.id))
          .where(eq(vehicles.userId, userId)),
        db
          .select()
          .from(vehicleFinancing)
          .innerJoin(vehicles, eq(vehicleFinancing.vehicleId, vehicles.id))
          .where(eq(vehicles.userId, userId)),
        db
          .select()
          .from(vehicleFinancingPayments)
          .innerJoin(
            vehicleFinancing,
            eq(vehicleFinancingPayments.financingId, vehicleFinancing.id)
          )
          .innerJoin(vehicles, eq(vehicleFinancing.vehicleId, vehicles.id))
          .where(eq(vehicles.userId, userId)),
      ]);

    await Promise.all([
      this.updateSheet(spreadsheetId, 'Vehicles', userVehicles, this.getVehicleHeaders()),
      this.updateSheet(
        spreadsheetId,
        'Expenses',
        userExpenses.map((e) => e.expenses),
        this.getExpenseHeaders()
      ),
      this.updateSheet(
        spreadsheetId,
        'Insurance Policies',
        userInsurance.map((i) => i.insurance_policies),
        this.getInsuranceHeaders()
      ),
      this.updateSheet(
        spreadsheetId,
        'Vehicle Financing',
        userFinancing.map((f) => f.vehicle_financing),
        this.getFinancingHeaders()
      ),
      this.updateSheet(
        spreadsheetId,
        'Vehicle Financing Payments',
        userFinancingPayments.map((p) => p.vehicle_financing_payments),
        this.getPaymentHeaders()
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
      'licensePlate',
      'nickname',
      'initialMileage',
      'purchasePrice',
      'purchaseDate',
      'createdAt',
      'updatedAt',
    ];
  }

  private getExpenseHeaders() {
    return [
      'id',
      'vehicleId',
      'tags',
      'category',
      'expenseAmount',
      'fuelAmount',
      'fuelType',
      'date',
      'mileage',
      'description',
      'receiptUrl',
      'createdAt',
      'updatedAt',
    ];
  }

  private getInsuranceHeaders() {
    return [
      'id',
      'vehicleId',
      'company',
      'policyNumber',
      'totalCost',
      'termLengthMonths',
      'startDate',
      'endDate',
      'monthlyCost',
      'isActive',
      'createdAt',
      'updatedAt',
    ];
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

  private getPaymentHeaders() {
    return [
      'id',
      'financingId',
      'paymentDate',
      'paymentAmount',
      'principalAmount',
      'interestAmount',
      'remainingBalance',
      'paymentNumber',
      'paymentType',
      'isScheduled',
      'createdAt',
      'updatedAt',
    ];
  }

  private async updateSheet<T extends Record<string, unknown>>(
    spreadsheetId: string,
    sheetName: string,
    data: T[],
    headers: string[]
  ): Promise<void> {
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
    if (Array.isArray(value)) return value.join(', ');
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
    financingPayments: Record<string, unknown>[];
    insurance: Record<string, unknown>[];
  }> {
    const [vehiclesData, expensesData, insuranceData, financingData, financingPaymentsData] =
      await Promise.all([
        this.readSheetData(spreadsheetId, 'Vehicles!A:Z'),
        this.readSheetData(spreadsheetId, 'Expenses!A:Z'),
        this.readSheetData(spreadsheetId, 'Insurance Policies!A:Z'),
        this.readSheetData(spreadsheetId, 'Vehicle Financing!A:Z'),
        this.readSheetData(spreadsheetId, 'Vehicle Financing Payments!A:Z'),
      ]);

    const vehicles = this.parseSheetData(vehiclesData);
    const expenses = this.parseSheetData(expensesData);
    const insurance = this.parseSheetData(insuranceData);
    const financing = this.parseSheetData(financingData);
    const financingPayments = this.parseSheetData(financingPaymentsData);

    const userId = vehicles.length > 0 ? (vehicles[0].userId as string) : '';

    return {
      metadata: { version: '1.0.0', timestamp: new Date().toISOString(), userId },
      vehicles,
      expenses,
      financing,
      financingPayments,
      insurance,
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

async function getUserToken(userId: string): Promise<string> {
  const db = getDb();
  const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user.length || !user[0].googleRefreshToken) {
    throw new Error('User not found or Google Sheets access not available');
  }
  return user[0].googleRefreshToken;
}

export async function createSheetsServiceForUser(userId: string): Promise<GoogleSheetsService> {
  const token = await getUserToken(userId);
  return new GoogleSheetsService(token, token);
}
