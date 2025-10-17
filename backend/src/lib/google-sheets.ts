import { eq } from 'drizzle-orm';
import type { OAuth2Client } from 'google-auth-library';
import { google, type sheets_v4 } from 'googleapis';
import {
  expenses,
  insurancePolicies,
  users,
  vehicleFinancing,
  vehicleFinancingPayments,
  vehicles,
} from '../db/schema';
import { databaseService } from './database';
import { GoogleDriveService } from './google-drive';

export interface SheetData {
  range: string;
  values: (string | number | boolean)[][];
}

// Type for vehicle data from database (simple select)
type VehicleData = {
  id: string;
  make: string;
  model: string;
  year: number;
  vehicleType: string;
  licensePlate?: string | null;
  nickname?: string | null;
  initialMileage?: number | null;
  purchasePrice?: number | null;
  purchaseDate?: Date | null;
  userId: string;
  createdAt: Date | null;
  updatedAt: Date | null;
};

// Type for expense data from database (joined with vehicles)
type ExpenseData = {
  expenses: {
    id: string;
    amount: number;
    category: string;
    tags?: string | null;
    date: Date;
    description?: string | null;
    mileage?: number | null;
    volume?: number | null;
    charge?: number | null;
    currency: string;
    receiptUrl?: string | null;
    vehicleId: string;
    createdAt: Date | null;
    updatedAt: Date | null;
  };
  vehicles: {
    id: string;
    make: string;
    model: string;
    year: number;
    userId: string;
  };
};

// Type for insurance data from database (joined with vehicles)
type InsuranceData = {
  insurance_policies: {
    id: string;
    company: string;
    policyNumber: string | null;
    totalCost: number;
    startDate: Date;
    endDate: Date;
    vehicleId: string;
    termLengthMonths: number;
    monthlyCost: number;
    isActive: boolean;
    createdAt: Date | null;
    updatedAt: Date | null;
  };
  vehicles: {
    id: string;
    make: string;
    model: string;
    year: number;
    userId: string;
  };
};

// Type for financing data from database (joined with vehicles)
type FinancingData = {
  vehicle_financing: {
    id: string;
    financingType: string;
    provider: string;
    originalAmount: number;
    currentBalance: number;
    apr: number | null;
    termMonths: number;
    startDate: Date;
    vehicleId: string;
    paymentAmount: number;
    paymentFrequency: string;
    paymentDayOfMonth: number | null;
    paymentDayOfWeek: number | null;
    residualValue: number | null;
    mileageLimit: number | null;
    excessMileageFee: number | null;
    isActive: boolean;
    endDate: Date | null;
    createdAt: Date | null;
    updatedAt: Date | null;
  };
  vehicles: {
    id: string;
    make: string;
    model: string;
    year: number;
    userId: string;
  };
};

// Type for financing payment data from database (joined with financing and vehicles)
type FinancingPaymentData = {
  vehicle_financing_payments: {
    id: string;
    paymentAmount: number;
    paymentDate: Date;
    principalAmount: number;
    interestAmount: number;
    paymentNumber: number;
    financingId: string;
    remainingBalance: number;
    paymentType: string;
    isScheduled: boolean;
    createdAt: Date | null;
    updatedAt: Date | null;
  };
  vehicle_financing: {
    id: string;
    provider: string;
    financingType: string;
    vehicleId: string;
  };
  vehicles: {
    id: string;
    make: string;
    model: string;
    year: number;
    userId: string;
  };
};

export interface SpreadsheetInfo {
  id: string;
  name: string;
  webViewLink: string;
  sheets: {
    id: number;
    title: string;
  }[];
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

  /**
   * Create or update the main VROOM data spreadsheet
   */
  async createOrUpdateVroomSpreadsheet(userId: string, userName: string): Promise<SpreadsheetInfo> {
    try {
      // Check if spreadsheet already exists in VROOM folder
      const folderStructure = await this.driveService.createVroomFolderStructure(userName);
      const existingSpreadsheet = await this.findVroomSpreadsheet(
        folderStructure.mainFolder.id,
        userName
      );

      let spreadsheetId: string;
      let spreadsheetInfo: SpreadsheetInfo;

      if (existingSpreadsheet) {
        spreadsheetId = existingSpreadsheet.id;
        spreadsheetInfo = await this.getSpreadsheetInfo(spreadsheetId);
      } else {
        // Create new spreadsheet
        const spreadsheet = await this.createSpreadsheet(`VROOM Data - ${userName}`);
        if (!spreadsheet.spreadsheetId) {
          throw new Error('Failed to create spreadsheet - no ID returned');
        }
        spreadsheetId = spreadsheet.spreadsheetId;

        // Move to VROOM folder using Google Drive API directly
        const drive = google.drive({ version: 'v3', auth: this.oauth2Client });
        await drive.files.update({
          fileId: spreadsheetId,
          addParents: folderStructure.mainFolder.id,
          removeParents: 'root',
        });

        spreadsheetInfo = await this.getSpreadsheetInfo(spreadsheetId);
      }

      // Update spreadsheet with current data
      await this.updateSpreadsheetWithUserData(spreadsheetId, userId);

      return spreadsheetInfo;
    } catch (error) {
      console.error('Error creating/updating VROOM spreadsheet:', error);
      throw new Error('Failed to create or update VROOM spreadsheet');
    }
  }

  /**
   * Find existing VROOM spreadsheet in the main folder
   */
  private async findVroomSpreadsheet(
    mainFolderId: string,
    userName: string
  ): Promise<{ id: string; name: string } | null> {
    try {
      const spreadsheetName = `VROOM Data - ${userName}`;
      const files = await this.driveService.listFilesInFolder(mainFolderId);

      const found = files.find(
        (file) =>
          file.name === spreadsheetName &&
          file.mimeType === 'application/vnd.google-apps.spreadsheet'
      );

      return found ? { id: found.id, name: found.name } : null;
    } catch (error) {
      console.error('Error finding VROOM spreadsheet:', error);
      return null;
    }
  }

  /**
   * Create a new spreadsheet
   */
  private async createSpreadsheet(title: string): Promise<sheets_v4.Schema$Spreadsheet> {
    try {
      const response = await this.sheets.spreadsheets.create({
        requestBody: {
          properties: {
            title,
          },
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
    } catch (error) {
      console.error('Error creating spreadsheet:', error);
      throw new Error('Failed to create spreadsheet');
    }
  }

  /**
   * Get spreadsheet information
   */
  async getSpreadsheetInfo(spreadsheetId: string): Promise<SpreadsheetInfo> {
    try {
      const response = await this.sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'spreadsheetId,properties,sheets.properties',
      });

      const spreadsheet = response.data;

      if (!spreadsheet.spreadsheetId || !spreadsheet.properties?.title) {
        throw new Error('Invalid spreadsheet data received');
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
    } catch (error) {
      console.error('Error getting spreadsheet info:', error);
      throw new Error('Failed to get spreadsheet information');
    }
  }

  /**
   * Update spreadsheet with user's current data
   */
  private async updateSpreadsheetWithUserData(
    spreadsheetId: string,
    userId: string
  ): Promise<void> {
    try {
      const db = databaseService.getDatabase();

      // Get user data
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

      // Update each sheet
      await Promise.all([
        this.updateVehiclesSheet(spreadsheetId, userVehicles),
        this.updateExpensesSheet(spreadsheetId, userExpenses),
        this.updateInsurancePoliciesSheet(spreadsheetId, userInsurance),
        this.updateVehicleFinancingSheet(spreadsheetId, userFinancing),
        this.updateVehicleFinancingPaymentsSheet(spreadsheetId, userFinancingPayments),
      ]);
    } catch (error) {
      console.error('Error updating spreadsheet with user data:', error);
      throw new Error('Failed to update spreadsheet with user data');
    }
  }

  /**
   * Update Vehicles sheet with all database columns
   */
  private async updateVehiclesSheet(spreadsheetId: string, vehicles: VehicleData[]): Promise<void> {
    const headers = [
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

    const values = [
      headers,
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Data mapping requires checking multiple fields
      ...vehicles.map((vehicle) => [
        vehicle.id || '',
        vehicle.userId || '',
        vehicle.make || '',
        vehicle.model || '',
        vehicle.year || '',
        vehicle.vehicleType || '',
        vehicle.licensePlate || '',
        vehicle.nickname || '',
        vehicle.initialMileage || '',
        vehicle.purchasePrice || '',
        vehicle.purchaseDate ? new Date(vehicle.purchaseDate).toISOString() : '',
        vehicle.createdAt ? new Date(vehicle.createdAt).toISOString() : '',
        vehicle.updatedAt ? new Date(vehicle.updatedAt).toISOString() : '',
      ]),
    ];

    await this.updateSheetData(spreadsheetId, `Vehicles!A1:M${vehicles.length + 1}`, values);
  }

  /**
   * Update Expenses sheet with all database columns
   */
  private async updateExpensesSheet(spreadsheetId: string, expenses: ExpenseData[]): Promise<void> {
    const headers = [
      'id',
      'vehicleId',
      'tags',
      'category',
      'amount',
      'currency',
      'date',
      'mileage',
      'volume',
      'charge',
      'description',
      'receiptUrl',
      'createdAt',
      'updatedAt',
    ];

    const values = [
      headers,
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Data mapping requires checking multiple fields
      ...expenses.map((exp) => {
        const expense = exp.expenses;
        return [
          expense.id || '',
          expense.vehicleId || '',
          expense.tags || '',
          expense.category || '',
          expense.amount || '',
          expense.currency || '',
          expense.date ? new Date(expense.date).toISOString() : '',
          expense.mileage || '',
          expense.volume || '',
          expense.charge || '',
          expense.description || '',
          expense.receiptUrl || '',
          expense.createdAt ? new Date(expense.createdAt).toISOString() : '',
          expense.updatedAt ? new Date(expense.updatedAt).toISOString() : '',
        ];
      }),
    ];

    await this.updateSheetData(spreadsheetId, `Expenses!A1:M${expenses.length + 1}`, values);
  }

  /**
   * Update Insurance Policies sheet with all database columns
   */
  private async updateInsurancePoliciesSheet(
    spreadsheetId: string,
    insurance: InsuranceData[]
  ): Promise<void> {
    const headers = [
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

    const values = [
      headers,
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Data mapping requires checking multiple fields
      ...insurance.map((ins) => {
        const policy = ins.insurance_policies;
        return [
          policy.id || '',
          policy.vehicleId || '',
          policy.company || '',
          policy.policyNumber || '',
          policy.totalCost || '',
          policy.termLengthMonths || '',
          policy.startDate ? new Date(policy.startDate).toISOString() : '',
          policy.endDate ? new Date(policy.endDate).toISOString() : '',
          policy.monthlyCost || '',
          policy.isActive ? 'true' : 'false',
          policy.createdAt ? new Date(policy.createdAt).toISOString() : '',
          policy.updatedAt ? new Date(policy.updatedAt).toISOString() : '',
        ];
      }),
    ];

    await this.updateSheetData(
      spreadsheetId,
      `Insurance Policies!A1:L${insurance.length + 1}`,
      values
    );
  }

  /**
   * Update Vehicle Financing sheet with all database columns
   */
  private async updateVehicleFinancingSheet(
    spreadsheetId: string,
    financing: FinancingData[]
  ): Promise<void> {
    const headers = [
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

    const values = [
      headers,
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Data mapping requires checking multiple fields
      ...financing.map((fin) => {
        const finData = fin.vehicle_financing;
        return [
          finData.id || '',
          finData.vehicleId || '',
          finData.financingType || '',
          finData.provider || '',
          finData.originalAmount || '',
          finData.currentBalance || '',
          finData.apr || '',
          finData.termMonths || '',
          finData.startDate ? new Date(finData.startDate).toISOString() : '',
          finData.paymentAmount || '',
          finData.paymentFrequency || '',
          finData.paymentDayOfMonth || '',
          finData.paymentDayOfWeek || '',
          finData.residualValue || '',
          finData.mileageLimit || '',
          finData.excessMileageFee || '',
          finData.isActive ? 'true' : 'false',
          finData.endDate ? new Date(finData.endDate).toISOString() : '',
          finData.createdAt ? new Date(finData.createdAt).toISOString() : '',
          finData.updatedAt ? new Date(finData.updatedAt).toISOString() : '',
        ];
      }),
    ];

    await this.updateSheetData(
      spreadsheetId,
      `Vehicle Financing!A1:T${financing.length + 1}`,
      values
    );
  }

  /**
   * Update Vehicle Financing Payments sheet with all database columns
   */
  private async updateVehicleFinancingPaymentsSheet(
    spreadsheetId: string,
    payments: FinancingPaymentData[]
  ): Promise<void> {
    const headers = [
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

    const values = [
      headers,
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Data mapping requires checking multiple fields
      ...payments.map((payment) => {
        const paymentData = payment.vehicle_financing_payments;
        return [
          paymentData.id || '',
          paymentData.financingId || '',
          paymentData.paymentDate ? new Date(paymentData.paymentDate).toISOString() : '',
          paymentData.paymentAmount || '',
          paymentData.principalAmount || '',
          paymentData.interestAmount || '',
          paymentData.remainingBalance || '',
          paymentData.paymentNumber || '',
          paymentData.paymentType || '',
          paymentData.isScheduled ? 'true' : 'false',
          paymentData.createdAt ? new Date(paymentData.createdAt).toISOString() : '',
          paymentData.updatedAt ? new Date(paymentData.updatedAt).toISOString() : '',
        ];
      }),
    ];

    await this.updateSheetData(
      spreadsheetId,
      `Vehicle Financing Payments!A1:L${payments.length + 1}`,
      values
    );
  }

  /**
   * Update sheet data
   */
  private async updateSheetData(
    spreadsheetId: string,
    range: string,
    values: (string | number | boolean)[][]
  ): Promise<void> {
    try {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values,
        },
      });
    } catch (error) {
      console.error(`Error updating sheet data for range ${range}:`, error);
      throw new Error(`Failed to update sheet data for range ${range}`);
    }
  }

  /**
   * Read data from a sheet
   */
  async readSheetData(
    spreadsheetId: string,
    range: string
  ): Promise<(string | number | boolean)[][]> {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId,
        range,
      });

      return response.data.values || [];
    } catch (error) {
      console.error(`Error reading sheet data for range ${range}:`, error);
      throw new Error(`Failed to read sheet data for range ${range}`);
    }
  }

  /**
   * Read all data from spreadsheet and parse into BackupData structure
   */
  async readSpreadsheetData(spreadsheetId: string): Promise<{
    metadata: { version: string; timestamp: string; userId: string };
    vehicles: Record<string, unknown>[];
    expenses: Record<string, unknown>[];
    financing: Record<string, unknown>[];
    financingPayments: Record<string, unknown>[];
    insurance: Record<string, unknown>[];
  }> {
    try {
      // Read all 5 sheets
      const [vehiclesData, expensesData, insuranceData, financingData, financingPaymentsData] =
        await Promise.all([
          this.readSheetData(spreadsheetId, 'Vehicles!A:Z'),
          this.readSheetData(spreadsheetId, 'Expenses!A:Z'),
          this.readSheetData(spreadsheetId, 'Insurance Policies!A:Z'),
          this.readSheetData(spreadsheetId, 'Vehicle Financing!A:Z'),
          this.readSheetData(spreadsheetId, 'Vehicle Financing Payments!A:Z'),
        ]);

      // Parse vehicles
      const vehicles = this.parseSheetData(vehiclesData);

      // Parse expenses
      const expenses = this.parseSheetData(expensesData);

      // Parse insurance
      const insurance = this.parseSheetData(insuranceData);

      // Parse financing
      const financing = this.parseSheetData(financingData);

      // Parse financing payments
      const financingPayments = this.parseSheetData(financingPaymentsData);

      // Extract userId from first vehicle (all data should belong to same user)
      const userId = vehicles.length > 0 ? (vehicles[0].userId as string) : '';

      return {
        metadata: {
          version: '1.0.0',
          timestamp: new Date().toISOString(),
          userId,
        },
        vehicles,
        expenses,
        financing,
        financingPayments,
        insurance,
      };
    } catch (error) {
      console.error('Error reading spreadsheet data:', error);
      throw new Error('Failed to read spreadsheet data');
    }
  }

  /**
   * Parse sheet data into array of objects
   * First row is headers, subsequent rows are data
   */
  private parseSheetData(sheetData: (string | number | boolean)[][]): Record<string, unknown>[] {
    if (sheetData.length === 0) {
      return [];
    }

    const headers = sheetData[0] as string[];
    const rows = sheetData.slice(1);

    return rows.map((row) => {
      const obj: Record<string, unknown> = {};

      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Data parsing requires type checking multiple conditions
      headers.forEach((header, index) => {
        const value = row[index];

        // Handle empty values
        if (value === '' || value === null || value === undefined) {
          obj[header] = null;
          return;
        }

        // Parse booleans
        if (value === 'true' || value === 'false') {
          obj[header] = value === 'true';
          return;
        }

        // Parse numbers
        if (typeof value === 'number') {
          obj[header] = value;
          return;
        }

        // Try to parse as number if it looks like one
        if (typeof value === 'string' && !Number.isNaN(Number(value)) && value.trim() !== '') {
          obj[header] = Number(value);
          return;
        }

        // Parse ISO dates
        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
          obj[header] = new Date(value);
          return;
        }

        // Default: keep as string
        obj[header] = value;
      });

      return obj;
    });
  }
}

/**
 * Create a Google Sheets service instance for a user
 */
export async function createSheetsServiceForUser(userId: string): Promise<GoogleSheetsService> {
  const db = databaseService.getDatabase();

  const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);

  if (!user.length || !user[0].googleRefreshToken) {
    throw new Error('User not found or Google Sheets access not available');
  }

  // For now, we'll use the refresh token as access token
  // In a production app, you'd want to properly refresh the access token
  return new GoogleSheetsService(user[0].googleRefreshToken, user[0].googleRefreshToken);
}
