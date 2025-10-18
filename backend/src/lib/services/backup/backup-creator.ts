/**
 * Backup Creator - Creates and exports backups
 */

import AdmZip from 'adm-zip';
import { stringify } from 'csv-stringify/sync';
import { databaseService } from '../../database';
import { BackupRepository } from '../../repositories/backup-repository';
import { logger } from '../../utils/logger';
import type { BackupData } from './types';

export class BackupCreator {
  /**
   * Create a complete backup of user data
   */
  async createBackup(userId: string): Promise<BackupData> {
    logger.info('Creating backup', { userId });

    // Get database instance at runtime to ensure we use the test database if set
    const db = databaseService.getDatabase();
    const repository = new BackupRepository(db);
    const userData = await repository.getAllUserData(userId);

    return {
      metadata: {
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        userId,
      },
      ...userData,
    };
  }

  /**
   * Export backup as CSV files in a ZIP
   */
  async exportAsZip(userId: string): Promise<Buffer> {
    logger.info('Exporting backup as ZIP', { userId });

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
      'volume',
      'charge',
      'description',
      'receiptUrl',
      'createdAt',
      'updatedAt',
    ]);
    zip.addFile('expenses.csv', Buffer.from(expensesCsv, 'utf-8'));

    // Add financing CSV
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

    // Add financing payments CSV
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

    logger.info('Backup ZIP created successfully', { userId, size: zip.toBuffer().length });

    return zip.toBuffer();
  }

  /**
   * Convert array of objects to CSV using proper CSV library
   */
  private convertToCSV(data: Record<string, unknown>[], columns: string[]): string {
    if (data.length === 0) {
      return `${columns.join(',')}\n`;
    }

    // Prepare data with proper formatting
    const formattedData = data.map((item) => {
      const row: Record<string, unknown> = {};
      for (const col of columns) {
        const value = item[col];
        if (value === null || value === undefined) {
          row[col] = '';
        } else if (value instanceof Date) {
          row[col] = value.toISOString();
        } else {
          row[col] = value;
        }
      }
      return row;
    });

    // Use csv-stringify for proper CSV generation
    return stringify(formattedData, {
      header: true,
      columns,
      quoted: true,
      quoted_empty: false,
    });
  }
}

export const backupCreator = new BackupCreator();
