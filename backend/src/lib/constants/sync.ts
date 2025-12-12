/**
 * Sync and backup configuration constants
 *
 * ARCHITECTURAL DECISION: Merged Sync Constants
 * ==============================================
 * This file consolidates two sync-related constants files:
 * - constants/backup.ts (backup configuration)
 * - services/sync/constants.ts (folder names, sync settings)
 *
 * Why merge?
 * - Both are sync/backup domain constants
 * - Eliminates duplication (both had similar configs)
 * - Single source for all sync-related configuration
 * - Easier to maintain consistency
 *
 * Contents:
 * - BACKUP_CONFIG: Backup file settings, versions, retention
 * - FOLDER_NAMES: Google Drive folder structure
 * - TABLE_SCHEMA_MAP: Database table to schema mappings
 * - Helper functions for backup operations
 */

import type { SQLiteTableWithColumns } from 'drizzle-orm/sqlite-core';
import {
  expenses,
  insurancePolicies,
  vehicleFinancing,
  vehicleFinancingPayments,
  vehicles,
} from '../../db/schema';

/**
 * Backup configuration
 */
export const BACKUP_CONFIG = {
  MAX_FILE_SIZE: 50 * 1024 * 1024, // 50MB
  CURRENT_VERSION: '1.0.0',
  SUPPORTED_MODES: ['preview', 'replace', 'merge'] as const,
  DEFAULT_RETENTION_COUNT: 10,
  MAX_RETENTION_COUNT: 50,
  MIN_RETENTION_COUNT: 1,
} as const;

export type RestoreMode = (typeof BACKUP_CONFIG.SUPPORTED_MODES)[number];

/**
 * Map of backup data keys to their corresponding table schemas
 * This is the single source of truth for which tables are included in backups
 */
// biome-ignore lint/suspicious/noExplicitAny: Generic table type requires any
export const TABLE_SCHEMA_MAP: Record<string, SQLiteTableWithColumns<any>> = {
  vehicles,
  expenses,
  financing: vehicleFinancing,
  financingPayments: vehicleFinancingPayments,
  insurance: insurancePolicies,
};

/**
 * Map of backup data keys to their CSV filenames
 */
export const TABLE_FILENAME_MAP: Record<string, string> = {
  vehicles: 'vehicles.csv',
  expenses: 'expenses.csv',
  financing: 'vehicle_financing.csv',
  financingPayments: 'vehicle_financing_payments.csv',
  insurance: 'insurance.csv',
};

/**
 * Get all backup table keys (excluding metadata)
 */
export function getBackupTableKeys(): string[] {
  return Object.keys(TABLE_SCHEMA_MAP);
}

/**
 * Get all required CSV filenames for backup validation
 */
export function getRequiredBackupFiles(): string[] {
  return ['metadata.json', ...Object.values(TABLE_FILENAME_MAP)];
}
