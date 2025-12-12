/**
 * Conflict Detector - Detects conflicts during merge operations
 */

import { inArray } from 'drizzle-orm';
import {
  expenses,
  insurancePolicies,
  vehicleFinancing,
  vehicleFinancingPayments,
  vehicles,
} from '../../../../db/schema';
import type { Database } from '../../../core/database';
import type { ParsedBackupData } from '../../../types/sync';
import { logger } from '../../../utils/logger';

export interface Conflict {
  table: string;
  id: string;
  localData: unknown;
  remoteData: unknown;
}

export class ConflictDetector {
  constructor(private db: Database) {}

  /**
   * Detect conflicts for merge mode across all tables
   *
   * Compares backup data with existing database records to identify conflicts.
   * A conflict occurs when a record with the same ID exists in both the backup
   * and the database, indicating potential data divergence.
   *
   * @param userId - The user ID (used for logging)
   * @param data - Parsed backup data to check for conflicts
   * @returns Array of conflicts found across all tables
   *
   * @remarks
   * This method checks all entity types:
   * - Vehicles
   * - Expenses
   * - Vehicle Financing
   * - Financing Payments
   * - Insurance Policies
   */
  async detectConflicts(userId: string, data: ParsedBackupData): Promise<Conflict[]> {
    logger.info('Detecting conflicts for merge operation', { userId });

    const conflicts: Conflict[] = [];

    // Check vehicle conflicts
    const vehicleConflicts = await this.detectVehicleConflicts(data.vehicles);
    conflicts.push(...vehicleConflicts);

    // Check expense conflicts
    const expenseConflicts = await this.detectExpenseConflicts(data.expenses);
    conflicts.push(...expenseConflicts);

    // Check financing conflicts
    const financingConflicts = await this.detectFinancingConflicts(data.financing);
    conflicts.push(...financingConflicts);

    // Check financing payment conflicts
    const paymentConflicts = await this.detectFinancingPaymentConflicts(data.financingPayments);
    conflicts.push(...paymentConflicts);

    // Check insurance conflicts
    const insuranceConflicts = await this.detectInsuranceConflicts(data.insurance);
    conflicts.push(...insuranceConflicts);

    logger.info('Conflict detection completed', { userId, conflictCount: conflicts.length });

    return conflicts;
  }

  /**
   * Detect vehicle conflicts
   */
  private async detectVehicleConflicts(
    remoteVehicles: Record<string, unknown>[]
  ): Promise<Conflict[]> {
    if (remoteVehicles.length === 0) return [];

    const vehicleIds = remoteVehicles.map((v) => String(v.id));
    const existingVehicles = await this.db
      .select()
      .from(vehicles)
      .where(inArray(vehicles.id, vehicleIds));

    return existingVehicles.map((existing) => {
      const remote = remoteVehicles.find((v) => v.id === existing.id);
      return {
        table: 'vehicles',
        id: existing.id,
        localData: existing,
        remoteData: remote,
      };
    });
  }

  /**
   * Detect expense conflicts
   */
  private async detectExpenseConflicts(
    remoteExpenses: Record<string, unknown>[]
  ): Promise<Conflict[]> {
    if (remoteExpenses.length === 0) return [];

    const expenseIds = remoteExpenses.map((e) => String(e.id));
    const existingExpenses = await this.db
      .select()
      .from(expenses)
      .where(inArray(expenses.id, expenseIds));

    return existingExpenses.map((existing) => {
      const remote = remoteExpenses.find((e) => e.id === existing.id);
      return {
        table: 'expenses',
        id: existing.id,
        localData: existing,
        remoteData: remote,
      };
    });
  }

  /**
   * Detect financing conflicts
   */
  private async detectFinancingConflicts(
    remoteFinancing: Record<string, unknown>[]
  ): Promise<Conflict[]> {
    if (remoteFinancing.length === 0) return [];

    const financingIds = remoteFinancing.map((f) => String(f.id));
    const existingFinancing = await this.db
      .select()
      .from(vehicleFinancing)
      .where(inArray(vehicleFinancing.id, financingIds));

    return existingFinancing.map((existing) => {
      const remote = remoteFinancing.find((f) => f.id === existing.id);
      return {
        table: 'vehicle_financing',
        id: existing.id,
        localData: existing,
        remoteData: remote,
      };
    });
  }

  /**
   * Detect financing payment conflicts
   */
  private async detectFinancingPaymentConflicts(
    remotePayments: Record<string, unknown>[]
  ): Promise<Conflict[]> {
    if (remotePayments.length === 0) return [];

    const paymentIds = remotePayments.map((p) => String(p.id));
    const existingPayments = await this.db
      .select()
      .from(vehicleFinancingPayments)
      .where(inArray(vehicleFinancingPayments.id, paymentIds));

    return existingPayments.map((existing) => {
      const remote = remotePayments.find((p) => p.id === existing.id);
      return {
        table: 'vehicle_financing_payments',
        id: existing.id,
        localData: existing,
        remoteData: remote,
      };
    });
  }

  /**
   * Detect insurance conflicts
   */
  private async detectInsuranceConflicts(
    remoteInsurance: Record<string, unknown>[]
  ): Promise<Conflict[]> {
    if (remoteInsurance.length === 0) return [];

    const insuranceIds = remoteInsurance.map((i) => String(i.id));
    const existingInsurance = await this.db
      .select()
      .from(insurancePolicies)
      .where(inArray(insurancePolicies.id, insuranceIds));

    return existingInsurance.map((existing) => {
      const remote = remoteInsurance.find((i) => i.id === existing.id);
      return {
        table: 'insurance_policies',
        id: existing.id,
        localData: existing,
        remoteData: remote,
      };
    });
  }
}
