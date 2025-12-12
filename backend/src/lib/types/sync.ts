/**
 * Shared types for sync and backup services
 * Consolidated from lib/services/sync/types.ts
 */

import type {
  Expense,
  InsurancePolicy,
  Vehicle,
  VehicleFinancing,
  VehicleFinancingPayment,
} from '../../db/schema';

export interface BackupMetadata {
  version: string;
  timestamp: string;
  userId: string;
}

export interface BackupData {
  metadata: BackupMetadata;
  vehicles: Vehicle[];
  expenses: Expense[];
  financing: VehicleFinancing[];
  financingPayments: VehicleFinancingPayment[];
  insurance: InsurancePolicy[];
}

export interface ParsedBackupData {
  metadata: BackupMetadata;
  vehicles: Record<string, unknown>[];
  expenses: Record<string, unknown>[];
  financing: Record<string, unknown>[];
  financingPayments: Record<string, unknown>[];
  insurance: Record<string, unknown>[];
}
