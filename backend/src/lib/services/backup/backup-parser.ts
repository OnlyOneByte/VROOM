/**
 * Backup Parser - Handles parsing and validation of backup files
 */

import AdmZip from 'adm-zip';
import { parse } from 'csv-parse/sync';
import { logger } from '../../utils/logger';
import type { BackupMetadata, ParsedBackupData } from './types';

export class BackupParser {
  /**
   * Parse ZIP backup file and validate structure
   */
  async parseZipBackup(file: Buffer): Promise<ParsedBackupData> {
    logger.info('Parsing ZIP backup', { size: file.length });

    try {
      const zip = new AdmZip(file);
      const zipEntries = zip.getEntries();

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
      const metadata = JSON.parse(metadataContent) as BackupMetadata;

      // Parse CSV files using proper CSV parser
      const getCSVData = (fileName: string): Record<string, unknown>[] => {
        const entry = zip.getEntry(fileName);
        if (!entry) return [];
        const content = entry.getData().toString('utf-8');
        return this.parseCSV(content);
      };

      const parsedData = {
        metadata,
        vehicles: getCSVData('vehicles.csv'),
        expenses: getCSVData('expenses.csv'),
        financing: getCSVData('vehicle_financing.csv'),
        financingPayments: getCSVData('vehicle_financing_payments.csv'),
        insurance: getCSVData('insurance.csv'),
      };

      logger.info('ZIP backup parsed successfully', {
        vehicles: parsedData.vehicles.length,
        expenses: parsedData.expenses.length,
      });

      return parsedData;
    } catch (error) {
      logger.error('Failed to parse ZIP backup', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      if (error instanceof Error) {
        throw new Error(`Failed to parse ZIP backup: ${error.message}`);
      }
      throw new Error('Failed to parse ZIP backup: Unknown error');
    }
  }

  /**
   * Parse CSV content using proper CSV parser that handles quoted values
   */
  private parseCSV(csvContent: string): Record<string, unknown>[] {
    if (!csvContent.trim()) {
      return [];
    }

    try {
      const records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_quotes: true,
        escape: '"',
        quote: '"',
      }) as Record<string, string>[];

      return records;
    } catch (error) {
      logger.error('CSV parsing failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new Error(
        `CSV parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}

export const backupParser = new BackupParser();
