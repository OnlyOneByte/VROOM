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
  licensePlate?: string | null;
  nickname?: string | null;
  currentMileage?: number | null;
  initialMileage?: number | null;
  purchasePrice?: number | null;
  purchaseDate?: Date | null;
  userId: string;
};

// Type for expense data from database (joined with vehicles)
type ExpenseData = {
  expenses: {
    id: string;
    amount: number;
    category: string;
    type?: string | null; // Deprecated
    tags?: string | null; // JSON string from database
    date: Date;
    description?: string | null;
    mileage?: number | null;
    gallons?: number | null;
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
    residualValue: number | null;
    mileageLimit: number | null;
    isActive: boolean;
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
            { properties: { title: 'Dashboard' } },
            { properties: { title: 'Vehicles' } },
            { properties: { title: 'Expenses' } },
            { properties: { title: 'Expense Categories' } },
            { properties: { title: 'Insurance' } },
            { properties: { title: 'Financing Details' } },
            { properties: { title: 'Financing Payments' } },
            { properties: { title: 'Monthly Summary' } },
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
        this.updateDashboardSheet(spreadsheetId, userVehicles, userExpenses),
        this.updateVehiclesSheet(spreadsheetId, userVehicles),
        this.updateExpensesSheet(spreadsheetId, userExpenses),
        this.updateExpenseCategoriesSheet(spreadsheetId, userExpenses),
        this.updateInsuranceSheet(spreadsheetId, userInsurance),
        this.updateFinancingDetailsSheet(spreadsheetId, userFinancing),
        this.updateFinancingPaymentsSheet(spreadsheetId, userFinancingPayments),
        this.updateMonthlySummarySheet(spreadsheetId, userExpenses),
      ]);
    } catch (error) {
      console.error('Error updating spreadsheet with user data:', error);
      throw new Error('Failed to update spreadsheet with user data');
    }
  }

  /**
   * Update Dashboard sheet
   */
  private async updateDashboardSheet(
    spreadsheetId: string,
    vehicles: VehicleData[],
    expenses: ExpenseData[]
  ): Promise<void> {
    const totalVehicles = vehicles.length;
    const totalExpenses = expenses.reduce((sum, exp) => sum + exp.expenses.amount, 0);
    const thisMonthExpenses = expenses
      .filter((exp) => {
        const expDate = new Date(exp.expenses.date);
        const now = new Date();
        return expDate.getMonth() === now.getMonth() && expDate.getFullYear() === now.getFullYear();
      })
      .reduce((sum, exp) => sum + exp.expenses.amount, 0);

    const values = [
      ['VROOM Car Tracker - Dashboard', '', '', ''],
      ['Generated:', new Date().toISOString(), '', ''],
      ['', '', '', ''],
      ['Summary Statistics', '', '', ''],
      ['Total Vehicles:', totalVehicles, '', ''],
      ['Total Expenses:', `$${totalExpenses.toFixed(2)}`, '', ''],
      ['This Month Expenses:', `$${thisMonthExpenses.toFixed(2)}`, '', ''],
      ['', '', '', ''],
      ['Quick Links', '', '', ''],
      ['• Vehicles Sheet', '', '', ''],
      ['• Expenses Sheet', '', '', ''],
      ['• Monthly Summary Sheet', '', '', ''],
    ];

    await this.updateSheetData(spreadsheetId, 'Dashboard!A1:D12', values);
  }

  /**
   * Update Vehicles sheet
   */
  private async updateVehiclesSheet(spreadsheetId: string, vehicles: VehicleData[]): Promise<void> {
    const headers = [
      'Make',
      'Model',
      'Year',
      'License Plate',
      'Nickname',
      'Purchase Date',
      'Purchase Price',
      'Initial Mileage',
    ];

    const values = [
      headers,
      ...vehicles.map((vehicle) => [
        vehicle.make || '',
        vehicle.model || '',
        vehicle.year || '',
        vehicle.licensePlate || '',
        vehicle.nickname || '',
        vehicle.purchaseDate ? new Date(vehicle.purchaseDate).toLocaleDateString() : '',
        vehicle.purchasePrice ? `$${vehicle.purchasePrice.toFixed(2)}` : '',
        vehicle.initialMileage || '',
      ]),
    ];

    await this.updateSheetData(spreadsheetId, `Vehicles!A1:H${vehicles.length + 1}`, values);
  }

  /**
   * Update Expenses sheet
   */
  private async updateExpensesSheet(spreadsheetId: string, expenses: ExpenseData[]): Promise<void> {
    const headers = [
      'Date',
      'Vehicle',
      'Type',
      'Category',
      'Description',
      'Amount',
      'Mileage',
      'Gallons',
      'MPG',
      'Cost/Mile',
    ];

    const values = [
      headers,
      ...expenses.map((exp) => {
        const expense = exp.expenses;
        const vehicle = exp.vehicles;
        const mpg =
          expense.gallons && expense.mileage ? (expense.mileage / expense.gallons).toFixed(2) : '';
        const costPerMile = expense.mileage ? (expense.amount / expense.mileage).toFixed(4) : '';

        return [
          new Date(expense.date).toLocaleDateString(),
          `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
          expense.tags ? JSON.parse(expense.tags).join(', ') : expense.type || '',
          expense.category,
          expense.description || '',
          `$${expense.amount.toFixed(2)}`,
          expense.mileage || '',
          expense.gallons || '',
          mpg,
          costPerMile ? `$${costPerMile}` : '',
        ];
      }),
    ];

    await this.updateSheetData(spreadsheetId, `Expenses!A1:J${expenses.length + 1}`, values);
  }

  /**
   * Update Expense Categories sheet
   */
  private async updateExpenseCategoriesSheet(
    spreadsheetId: string,
    expenses: ExpenseData[]
  ): Promise<void> {
    const categoryTotals = expenses.reduce(
      (acc, exp) => {
        const category = exp.expenses.category;
        acc[category] = (acc[category] || 0) + exp.expenses.amount;
        return acc;
      },
      {} as Record<string, number>
    );

    const headers = ['Category', 'Total Amount', 'Percentage'];
    const amounts = Object.values(categoryTotals) as number[];
    const totalAmount = amounts.reduce((sum, amount) => sum + amount, 0);

    const values = [
      headers,
      ...Object.entries(categoryTotals).map(([category, amount]) => [
        category,
        `$${amount.toFixed(2)}`,
        `${((amount / totalAmount) * 100).toFixed(1)}%`,
      ]),
    ];

    await this.updateSheetData(
      spreadsheetId,
      `Expense Categories!A1:C${Object.keys(categoryTotals).length + 1}`,
      values
    );
  }

  /**
   * Update Insurance sheet
   */
  private async updateInsuranceSheet(
    spreadsheetId: string,
    insurance: InsuranceData[]
  ): Promise<void> {
    const headers = [
      'Vehicle',
      'Company',
      'Policy Number',
      'Total Cost',
      'Term (Months)',
      'Start Date',
      'End Date',
      'Monthly Cost',
      'Active',
    ];

    const values = [
      headers,
      ...insurance.map((ins) => {
        const policy = ins.insurance_policies;
        const vehicle = ins.vehicles;

        return [
          `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
          policy.company,
          policy.policyNumber || '',
          `$${policy.totalCost.toFixed(2)}`,
          policy.termLengthMonths,
          new Date(policy.startDate).toLocaleDateString(),
          new Date(policy.endDate).toLocaleDateString(),
          `$${policy.monthlyCost.toFixed(2)}`,
          policy.isActive ? 'Yes' : 'No',
        ];
      }),
    ];

    await this.updateSheetData(spreadsheetId, `Insurance!A1:I${insurance.length + 1}`, values);
  }

  /**
   * Update Financing Details sheet
   */
  private async updateFinancingDetailsSheet(
    spreadsheetId: string,
    financing: FinancingData[]
  ): Promise<void> {
    const headers = [
      'Vehicle',
      'Provider',
      'Original Amount',
      'Current Balance',
      'APR',
      'Term (Months)',
      'Monthly Payment',
      'Start Date',
      'Active',
    ];

    const values = [
      headers,
      ...financing.map((fin) => {
        const finData = fin.vehicle_financing;
        const vehicle = fin.vehicles;

        return [
          `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
          finData.provider,
          `$${finData.originalAmount.toFixed(2)}`,
          `$${finData.currentBalance.toFixed(2)}`,
          `${finData.apr}%`,
          finData.termMonths,
          `$${finData.paymentAmount?.toFixed(2) || '0.00'}`,
          new Date(finData.startDate).toLocaleDateString(),
          finData.isActive ? 'Yes' : 'No',
        ];
      }),
    ];

    await this.updateSheetData(
      spreadsheetId,
      `Financing Details!A1:I${financing.length + 1}`,
      values
    );
  }

  /**
   * Update Financing Payments sheet
   */
  private async updateFinancingPaymentsSheet(
    spreadsheetId: string,
    payments: FinancingPaymentData[]
  ): Promise<void> {
    const headers = [
      'Vehicle',
      'Payment Date',
      'Payment #',
      'Amount',
      'Principal',
      'Interest',
      'Remaining Balance',
      'Payment Type',
    ];

    const values = [
      headers,
      ...payments.map((payment) => {
        const paymentData = payment.vehicle_financing_payments;
        const vehicle = payment.vehicles;

        return [
          `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
          new Date(paymentData.paymentDate).toLocaleDateString(),
          paymentData.paymentNumber,
          `$${paymentData.paymentAmount.toFixed(2)}`,
          `$${paymentData.principalAmount.toFixed(2)}`,
          `$${paymentData.interestAmount.toFixed(2)}`,
          `$${paymentData.remainingBalance.toFixed(2)}`,
          paymentData.paymentType,
        ];
      }),
    ];

    await this.updateSheetData(
      spreadsheetId,
      `Financing Payments!A1:H${payments.length + 1}`,
      values
    );
  }

  /**
   * Update Monthly Summary sheet
   */
  private async updateMonthlySummarySheet(
    spreadsheetId: string,
    expenses: ExpenseData[]
  ): Promise<void> {
    // Group expenses by month and category
    const monthlyData = expenses.reduce(
      (acc, exp) => {
        const expense = exp.expenses;
        const date = new Date(expense.date);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

        if (!acc[monthKey]) {
          acc[monthKey] = {};
        }

        const category = expense.category;
        acc[monthKey][category] = (acc[monthKey][category] || 0) + expense.amount;

        return acc;
      },
      {} as Record<string, Record<string, number>>
    );

    const allCategories = [...new Set(expenses.map((exp) => exp.expenses.category))];
    const headers = ['Month', ...allCategories, 'Total'];

    const values = [
      headers,
      ...Object.entries(monthlyData).map(([month, categories]) => {
        const amounts = Object.values(categories) as number[];
        const total = amounts.reduce((sum, amount) => sum + amount, 0);
        return [
          month,
          ...allCategories.map((cat) => `$${(categories[cat] || 0).toFixed(2)}`),
          `$${total.toFixed(2)}`,
        ];
      }),
    ];

    await this.updateSheetData(
      spreadsheetId,
      'Monthly Summary!A1:' +
        String.fromCharCode(65 + headers.length - 1) +
        (Object.keys(monthlyData).length + 1),
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
   * Export data in different formats
   */
  async exportData(
    spreadsheetId: string,
    format: 'json' | 'csv' | 'xlsx'
  ): Promise<Buffer | object> {
    try {
      switch (format) {
        case 'json':
          return await this.exportAsJson(spreadsheetId);
        case 'csv':
          return await this.exportAsCsv(spreadsheetId);
        case 'xlsx':
          return await this.exportAsXlsx(spreadsheetId);
        default:
          throw new Error('Unsupported export format');
      }
    } catch (error) {
      console.error('Error exporting data:', error);
      throw new Error(`Failed to export data as ${format}`);
    }
  }

  /**
   * Export as JSON
   */
  private async exportAsJson(spreadsheetId: string): Promise<object> {
    const info = await this.getSpreadsheetInfo(spreadsheetId);
    const data: Record<string, (string | number | boolean)[][]> = {};

    for (const sheet of info.sheets) {
      const sheetData = await this.readSheetData(spreadsheetId, `${sheet.title}!A:Z`);
      data[sheet.title] = sheetData;
    }

    return data;
  }

  /**
   * Export as CSV (expenses sheet only)
   */
  private async exportAsCsv(spreadsheetId: string): Promise<Buffer> {
    const expensesData = await this.readSheetData(spreadsheetId, 'Expenses!A:Z');
    const csvContent = expensesData.map((row) => row.join(',')).join('\n');
    return Buffer.from(csvContent, 'utf-8');
  }

  /**
   * Export as XLSX
   */
  private async exportAsXlsx(spreadsheetId: string): Promise<Buffer> {
    try {
      const drive = google.drive({ version: 'v3', auth: this.oauth2Client });
      const response = await drive.files.export({
        fileId: spreadsheetId,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

      return Buffer.from(response.data as string);
    } catch (error) {
      console.error('Error exporting as XLSX:', error);
      throw new Error('Failed to export as XLSX');
    }
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
