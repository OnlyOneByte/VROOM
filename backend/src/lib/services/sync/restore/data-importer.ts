/**
 * Data Importer - Handles importing data into database with proper type conversion
 */

import { eq, inArray } from 'drizzle-orm';
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

// Proper transaction type from Drizzle
type DrizzleTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export class DataImporter {
  /**
   * Delete all user data (for replace mode)
   *
   * Deletes all data associated with a user in the correct order to respect
   * foreign key constraints. This is used in 'replace' mode before importing
   * backup data.
   *
   * @param tx - Database transaction to execute deletions within
   * @param userId - The user ID whose data should be deleted
   *
   * @remarks
   * Deletion order (respects foreign keys):
   * 1. Expenses (references vehicles)
   * 2. Insurance Policies (references vehicles)
   * 3. Financing Payments (references financing)
   * 4. Vehicle Financing (references vehicles)
   * 5. Vehicles (references user)
   */
  async deleteUserData(tx: DrizzleTransaction, userId: string): Promise<void> {
    logger.info('Deleting user data for replace mode', { userId });

    // Get all vehicle IDs for the user
    const userVehicles = await tx.select().from(vehicles).where(eq(vehicles.userId, userId));

    if (userVehicles.length === 0) {
      logger.info('No existing data to delete', { userId });
      return;
    }

    const vehicleIds = userVehicles.map((v) => v.id);

    // Delete in correct order (respecting foreign key constraints)
    await tx.delete(expenses).where(inArray(expenses.vehicleId, vehicleIds));

    await tx.delete(insurancePolicies).where(inArray(insurancePolicies.vehicleId, vehicleIds));

    // Get financing IDs before deleting
    const financingRecords = await tx
      .select()
      .from(vehicleFinancing)
      .where(inArray(vehicleFinancing.vehicleId, vehicleIds));

    if (financingRecords.length > 0) {
      const financingIds = financingRecords.map((f) => f.id);
      await tx
        .delete(vehicleFinancingPayments)
        .where(inArray(vehicleFinancingPayments.financingId, financingIds));
    }

    await tx.delete(vehicleFinancing).where(inArray(vehicleFinancing.vehicleId, vehicleIds));

    await tx.delete(vehicles).where(eq(vehicles.userId, userId));

    logger.info('User data deleted successfully', { userId, vehicleCount: vehicleIds.length });
  }

  /**
   * Insert backup data into database
   *
   * Imports all entities from parsed backup data into the database within a transaction.
   * Handles type conversion from CSV strings to proper database types (dates, numbers, booleans).
   *
   * @param tx - Database transaction to execute inserts within
   * @param data - Parsed backup data containing all entities
   *
   * @remarks
   * Insertion order (respects foreign keys):
   * 1. Vehicles (no dependencies)
   * 2. Expenses (depends on vehicles)
   * 3. Vehicle Financing (depends on vehicles)
   * 4. Financing Payments (depends on financing)
   * 5. Insurance Policies (depends on vehicles)
   *
   * All CSV string values are converted to proper types before insertion.
   */
  async insertBackupData(tx: DrizzleTransaction, data: ParsedBackupData): Promise<void> {
    logger.info('Inserting backup data', {
      vehicles: data.vehicles.length,
      expenses: data.expenses.length,
      financing: data.financing.length,
      financingPayments: data.financingPayments.length,
      insurance: data.insurance.length,
    });

    // Insert vehicles
    if (data.vehicles.length > 0) {
      const vehicleData = data.vehicles.map((v) => this.convertCSVRow(v));
      await tx.insert(vehicles).values(vehicleData as (typeof vehicles.$inferInsert)[]);
    }

    // Insert expenses
    if (data.expenses.length > 0) {
      const expenseData = data.expenses.map((e) => this.convertCSVRow(e));
      await tx.insert(expenses).values(expenseData as (typeof expenses.$inferInsert)[]);
    }

    // Insert financing
    if (data.financing.length > 0) {
      const financingData = data.financing.map((f) => this.convertCSVRow(f));
      await tx
        .insert(vehicleFinancing)
        .values(financingData as (typeof vehicleFinancing.$inferInsert)[]);
    }

    // Insert financing payments
    if (data.financingPayments.length > 0) {
      const paymentData = data.financingPayments.map((p) => this.convertCSVRow(p));
      await tx
        .insert(vehicleFinancingPayments)
        .values(paymentData as (typeof vehicleFinancingPayments.$inferInsert)[]);
    }

    // Insert insurance
    if (data.insurance.length > 0) {
      const insuranceData = data.insurance.map((i) => this.convertCSVRow(i));
      await tx
        .insert(insurancePolicies)
        .values(insuranceData as (typeof insurancePolicies.$inferInsert)[]);
    }

    logger.info('Backup data inserted successfully');
  }

  /**
   * Convert CSV row data to properly typed object
   */
  private convertCSVRow(row: Record<string, unknown>): Record<string, unknown> {
    const converted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      converted[key] = this.convertCSVValue(String(value), key);
    }
    return converted;
  }

  /**
   * Convert CSV string values to proper types
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Type conversion requires checking multiple field patterns
  private convertCSVValue(value: string, fieldName: string): unknown {
    if (value === '' || value === 'null' || value === 'undefined' || value === 'NULL') {
      return null;
    }

    // Date fields
    if (fieldName.endsWith('At') || fieldName.endsWith('Date') || fieldName === 'date') {
      try {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return null;
        return date;
      } catch {
        return null;
      }
    }

    // Boolean fields
    if (fieldName.startsWith('is') || fieldName === 'isActive' || fieldName === 'isScheduled') {
      return value === 'true' || value === '1' || value === 'TRUE';
    }

    // Numeric fields
    if (
      fieldName.includes('amount') ||
      fieldName.includes('Amount') ||
      fieldName.includes('price') ||
      fieldName.includes('Price') ||
      fieldName.includes('cost') ||
      fieldName.includes('Cost') ||
      fieldName.includes('balance') ||
      fieldName.includes('Balance') ||
      fieldName === 'apr' ||
      fieldName === 'volume' ||
      fieldName === 'charge' ||
      fieldName === 'mileage' ||
      fieldName === 'initialMileage' ||
      fieldName === 'mileageLimit' ||
      fieldName === 'excessMileageFee' ||
      fieldName === 'residualValue'
    ) {
      const num = Number.parseFloat(value);
      return Number.isNaN(num) ? null : num;
    }

    // Integer fields
    if (
      fieldName === 'year' ||
      fieldName === 'termMonths' ||
      fieldName === 'termLengthMonths' ||
      fieldName === 'paymentNumber' ||
      fieldName === 'paymentDayOfMonth' ||
      fieldName === 'paymentDayOfWeek'
    ) {
      const num = Number.parseInt(value, 10);
      return Number.isNaN(num) ? null : num;
    }

    return value;
  }
}
