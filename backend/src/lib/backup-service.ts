import AdmZip from 'adm-zip';
import { eq } from 'drizzle-orm';
import {
  type Expense,
  expenses,
  type InsurancePolicy,
  insurancePolicies,
  type LoanPayment,
  loanPayments,
  type Vehicle,
  type VehicleLoan,
  vehicleLoans,
  vehicles,
} from '../db/schema';
import { databaseService } from './database';
import type { GoogleDriveService } from './google-drive';

export interface BackupData {
  version: string;
  timestamp: string;
  userId: string;
  vehicles: Vehicle[];
  expenses: Expense[];
  loans: VehicleLoan[];
  loanPayments: LoanPayment[];
  insurance: InsurancePolicy[];
}

export class BackupService {
  /**
   * Create a complete backup of user data
   */
  async createBackup(userId: string): Promise<BackupData> {
    const db = databaseService.getDatabase();

    const [userVehicles, userExpenses, userLoans, userLoanPayments, userInsurance] =
      await Promise.all([
        db.select().from(vehicles).where(eq(vehicles.userId, userId)),
        db
          .select()
          .from(expenses)
          .innerJoin(vehicles, eq(expenses.vehicleId, vehicles.id))
          .where(eq(vehicles.userId, userId))
          .then((results) => results.map((r) => r.expenses)),
        db
          .select()
          .from(vehicleLoans)
          .innerJoin(vehicles, eq(vehicleLoans.vehicleId, vehicles.id))
          .where(eq(vehicles.userId, userId))
          .then((results) => results.map((r) => r.vehicle_loans)),
        db
          .select()
          .from(loanPayments)
          .innerJoin(vehicleLoans, eq(loanPayments.loanId, vehicleLoans.id))
          .innerJoin(vehicles, eq(vehicleLoans.vehicleId, vehicles.id))
          .where(eq(vehicles.userId, userId))
          .then((results) => results.map((r) => r.loan_payments)),
        db
          .select()
          .from(insurancePolicies)
          .innerJoin(vehicles, eq(insurancePolicies.vehicleId, vehicles.id))
          .where(eq(vehicles.userId, userId))
          .then((results) => results.map((r) => r.insurance_policies)),
      ]);

    return {
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      userId,
      vehicles: userVehicles,
      expenses: userExpenses,
      loans: userLoans,
      loanPayments: userLoanPayments,
      insurance: userInsurance,
    };
  }

  /**
   * Export backup as JSON
   */
  async exportAsJson(userId: string): Promise<Buffer> {
    const backup = await this.createBackup(userId);
    return Buffer.from(JSON.stringify(backup, null, 2), 'utf-8');
  }

  /**
   * Export backup as CSV files in a ZIP
   */
  async exportAsZip(userId: string): Promise<Buffer> {
    const backup = await this.createBackup(userId);
    const zip = new AdmZip();

    // Add metadata
    zip.addFile(
      'metadata.json',
      Buffer.from(
        JSON.stringify(
          {
            version: backup.version,
            timestamp: backup.timestamp,
            userId: backup.userId,
          },
          null,
          2
        ),
        'utf-8'
      )
    );

    // Add vehicles CSV
    const vehiclesCsv = this.convertToCSV(backup.vehicles, [
      'id',
      'make',
      'model',
      'year',
      'licensePlate',
      'nickname',
      'initialMileage',
      'purchasePrice',
      'purchaseDate',
      'createdAt',
      'updatedAt',
    ]);
    zip.addFile('vehicles.csv', Buffer.from(vehiclesCsv, 'utf-8'));

    // Add expenses CSV
    const expensesCsv = this.convertToCSV(backup.expenses, [
      'id',
      'vehicleId',
      'category',
      'tags',
      'amount',
      'currency',
      'date',
      'mileage',
      'gallons',
      'description',
      'receiptUrl',
      'createdAt',
      'updatedAt',
    ]);
    zip.addFile('expenses.csv', Buffer.from(expensesCsv, 'utf-8'));

    // Add loans CSV
    const loansCsv = this.convertToCSV(backup.loans, [
      'id',
      'vehicleId',
      'lender',
      'originalAmount',
      'currentBalance',
      'apr',
      'termMonths',
      'startDate',
      'paymentAmount',
      'paymentFrequency',
      'isActive',
      'createdAt',
      'updatedAt',
    ]);
    zip.addFile('loans.csv', Buffer.from(loansCsv, 'utf-8'));

    // Add loan payments CSV
    const loanPaymentsCsv = this.convertToCSV(backup.loanPayments, [
      'id',
      'loanId',
      'paymentDate',
      'paymentAmount',
      'principalAmount',
      'interestAmount',
      'remainingBalance',
      'paymentNumber',
      'paymentType',
      'createdAt',
      'updatedAt',
    ]);
    zip.addFile('loan_payments.csv', Buffer.from(loanPaymentsCsv, 'utf-8'));

    // Add insurance CSV
    const insuranceCsv = this.convertToCSV(backup.insurance, [
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
    ]);
    zip.addFile('insurance.csv', Buffer.from(insuranceCsv, 'utf-8'));

    return zip.toBuffer();
  }

  /**
   * Convert array of objects to CSV
   */
  private convertToCSV(data: Record<string, unknown>[], columns: string[]): string {
    if (data.length === 0) {
      return `${columns.join(',')}\n`;
    }

    const header = columns.join(',');
    const rows = data.map((item) => {
      return columns
        .map((col) => {
          const value = item[col];
          if (value === null || value === undefined) return '';
          if (value instanceof Date) return value.toISOString();
          if (typeof value === 'string' && value.includes(',')) {
            return `"${value.replace(/"/g, '""')}"`;
          }
          return String(value);
        })
        .join(',');
    });

    return [header, ...rows].join('\n');
  }

  /**
   * Upload backup to Google Drive
   */
  async uploadToGoogleDrive(
    userId: string,
    driveService: GoogleDriveService,
    backupFolderId: string,
    format: 'json' | 'zip' = 'zip'
  ): Promise<{ fileId: string; fileName: string; webViewLink: string }> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `vroom-backup-${timestamp}.${format}`;

    let fileContent: Buffer;
    let mimeType: string;

    if (format === 'json') {
      fileContent = await this.exportAsJson(userId);
      mimeType = 'application/json';
    } else {
      fileContent = await this.exportAsZip(userId);
      mimeType = 'application/zip';
    }

    const uploadedFile = await driveService.uploadFile(
      fileName,
      fileContent,
      mimeType,
      backupFolderId
    );

    return {
      fileId: uploadedFile.id,
      fileName: uploadedFile.name,
      webViewLink: uploadedFile.webViewLink || '',
    };
  }

  /**
   * List backups in Google Drive folder
   */
  async listBackupsInDrive(
    driveService: GoogleDriveService,
    backupFolderId: string
  ): Promise<
    Array<{
      id: string;
      name: string;
      size: string;
      createdTime: string;
      modifiedTime: string;
      webViewLink: string;
    }>
  > {
    const files = await driveService.listFilesInFolder(backupFolderId);

    return files
      .filter(
        (file) =>
          file.name.startsWith('vroom-backup-') &&
          (file.name.endsWith('.json') || file.name.endsWith('.zip'))
      )
      .map((file) => ({
        id: file.id,
        name: file.name,
        size: file.size || '0',
        createdTime: file.createdTime || '',
        modifiedTime: file.modifiedTime || '',
        webViewLink: file.webViewLink || '',
      }))
      .sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
  }

  /**
   * Delete old backups (keep only the last N backups)
   */
  async cleanupOldBackups(
    driveService: GoogleDriveService,
    backupFolderId: string,
    keepCount: number = 10
  ): Promise<number> {
    const backups = await this.listBackupsInDrive(driveService, backupFolderId);

    if (backups.length <= keepCount) {
      return 0;
    }

    const toDelete = backups.slice(keepCount);
    let deletedCount = 0;

    for (const backup of toDelete) {
      try {
        await driveService.deleteFile(backup.id);
        deletedCount++;
      } catch (error) {
        console.error(`Failed to delete backup ${backup.name}:`, error);
      }
    }

    return deletedCount;
  }
}

export const backupService = new BackupService();
