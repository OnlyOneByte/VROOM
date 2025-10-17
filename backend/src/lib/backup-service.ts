import AdmZip from 'adm-zip';
import { eq } from 'drizzle-orm';
import {
  type Expense,
  expenses,
  type InsurancePolicy,
  insurancePolicies,
  type Vehicle,
  type VehicleFinancing,
  type VehicleFinancingPayment,
  vehicleFinancing,
  vehicleFinancingPayments,
  vehicles,
} from '../db/schema';
import { databaseService } from './database';
import type { GoogleDriveService } from './google-drive';

export interface BackupData {
  metadata: {
    version: string;
    timestamp: string;
    userId: string;
  };
  vehicles: Vehicle[];
  expenses: Expense[];
  financing: VehicleFinancing[];
  financingPayments: VehicleFinancingPayment[];
  insurance: InsurancePolicy[];
}

export interface ParsedBackupData {
  metadata: {
    version: string;
    timestamp: string;
    userId: string;
  };
  vehicles: Record<string, unknown>[];
  expenses: Record<string, unknown>[];
  financing: Record<string, unknown>[];
  financingPayments: Record<string, unknown>[];
  insurance: Record<string, unknown>[];
}

export class BackupService {
  /**
   * Create a complete backup of user data
   */
  async createBackup(userId: string): Promise<BackupData> {
    const db = databaseService.getDatabase();

    const [userVehicles, userExpenses, userFinancing, userFinancingPayments, userInsurance] =
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
          .from(vehicleFinancing)
          .innerJoin(vehicles, eq(vehicleFinancing.vehicleId, vehicles.id))
          .where(eq(vehicles.userId, userId))
          .then((results) => results.map((r) => r.vehicle_financing)),
        db
          .select()
          .from(vehicleFinancingPayments)
          .innerJoin(
            vehicleFinancing,
            eq(vehicleFinancingPayments.financingId, vehicleFinancing.id)
          )
          .innerJoin(vehicles, eq(vehicleFinancing.vehicleId, vehicles.id))
          .where(eq(vehicles.userId, userId))
          .then((results) => results.map((r) => r.vehicle_financing_payments)),
        db
          .select()
          .from(insurancePolicies)
          .innerJoin(vehicles, eq(insurancePolicies.vehicleId, vehicles.id))
          .where(eq(vehicles.userId, userId))
          .then((results) => results.map((r) => r.insurance_policies)),
      ]);

    return {
      metadata: {
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        userId,
      },
      vehicles: userVehicles,
      expenses: userExpenses,
      financing: userFinancing,
      financingPayments: userFinancingPayments,
      insurance: userInsurance,
    };
  }

  /**
   * Export backup as CSV files in a ZIP
   */
  async exportAsZip(userId: string): Promise<Buffer> {
    const backup = await this.createBackup(userId);
    const zip = new AdmZip();

    // Add metadata
    zip.addFile('metadata.json', Buffer.from(JSON.stringify(backup.metadata, null, 2), 'utf-8'));

    // Add vehicles CSV
    const vehiclesCsv = this.convertToCSV(backup.vehicles, [
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

    // Add vehicle_financing CSV
    const financingCsv = this.convertToCSV(backup.financing, [
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
    ]);
    zip.addFile('vehicle_financing.csv', Buffer.from(financingCsv, 'utf-8'));

    // Add vehicle_financing_payments CSV
    const financingPaymentsCsv = this.convertToCSV(backup.financingPayments, [
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
    ]);
    zip.addFile('vehicle_financing_payments.csv', Buffer.from(financingPaymentsCsv, 'utf-8'));

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
   * Parse ZIP backup file and validate structure
   */
  async parseZipBackup(file: Buffer): Promise<ParsedBackupData> {
    try {
      const zip = new AdmZip(file);
      const zipEntries = zip.getEntries();

      // Check for required files
      const requiredFiles = [
        'metadata.json',
        'vehicles.csv',
        'expenses.csv',
        'insurance.csv',
        'vehicle_financing.csv',
        'vehicle_financing_payments.csv',
      ];

      const fileNames = zipEntries.map((entry) => entry.entryName);
      const missingFiles = requiredFiles.filter((file) => !fileNames.includes(file));

      if (missingFiles.length > 0) {
        throw new Error(`Missing required files: ${missingFiles.join(', ')}`);
      }

      // Parse metadata
      const metadataEntry = zip.getEntry('metadata.json');
      if (!metadataEntry) {
        throw new Error('metadata.json not found in backup');
      }

      const metadataContent = metadataEntry.getData().toString('utf-8');
      const metadata = JSON.parse(metadataContent) as {
        version: string;
        timestamp: string;
        userId: string;
      };

      // Parse CSV files
      const parseCSV = (csvContent: string): Record<string, unknown>[] => {
        const lines = csvContent.trim().split('\n');
        if (lines.length < 2) return [];

        const headers = lines[0].split(',');
        return lines.slice(1).map((line) => {
          const values = line.split(',');
          const obj: Record<string, unknown> = {};
          headers.forEach((header, index) => {
            obj[header] = values[index] || '';
          });
          return obj;
        });
      };

      const getCSVData = (fileName: string): Record<string, unknown>[] => {
        const entry = zip.getEntry(fileName);
        if (!entry) return [];
        const content = entry.getData().toString('utf-8');
        return parseCSV(content);
      };

      return {
        metadata,
        vehicles: getCSVData('vehicles.csv'),
        expenses: getCSVData('expenses.csv'),
        financing: getCSVData('vehicle_financing.csv'),
        financingPayments: getCSVData('vehicle_financing_payments.csv'),
        insurance: getCSVData('insurance.csv'),
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to parse ZIP backup: ${error.message}`);
      }
      throw new Error('Failed to parse ZIP backup: Unknown error');
    }
  }

  /**
   * Upload backup to Google Drive (ZIP format only)
   */
  async uploadToGoogleDrive(
    userId: string,
    driveService: GoogleDriveService,
    backupFolderId: string
  ): Promise<{ fileId: string; fileName: string; webViewLink: string }> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `vroom-backup-${timestamp}.zip`;

    const fileContent = await this.exportAsZip(userId);
    const mimeType = 'application/zip';

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
      .filter((file) => file.name.startsWith('vroom-backup-') && file.name.endsWith('.zip'))
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
