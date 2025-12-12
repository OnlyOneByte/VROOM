/**
 * Repository for backup-related database operations
 */

import { eq } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
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

export class BackupRepository {
  constructor(private db: BunSQLiteDatabase<Record<string, unknown>>) {}

  /**
   * Get all vehicles for a user
   */
  async getUserVehicles(userId: string): Promise<Vehicle[]> {
    return this.db.select().from(vehicles).where(eq(vehicles.userId, userId));
  }

  /**
   * Get all expenses for a user
   */
  async getUserExpenses(userId: string): Promise<Expense[]> {
    const results = await this.db
      .select()
      .from(expenses)
      .innerJoin(vehicles, eq(expenses.vehicleId, vehicles.id))
      .where(eq(vehicles.userId, userId));

    return results.map((r) => r.expenses);
  }

  /**
   * Get all financing for a user
   */
  async getUserFinancing(userId: string): Promise<VehicleFinancing[]> {
    const results = await this.db
      .select()
      .from(vehicleFinancing)
      .innerJoin(vehicles, eq(vehicleFinancing.vehicleId, vehicles.id))
      .where(eq(vehicles.userId, userId));

    return results.map((r) => r.vehicle_financing);
  }

  /**
   * Get all financing payments for a user
   */
  async getUserFinancingPayments(userId: string): Promise<VehicleFinancingPayment[]> {
    const results = await this.db
      .select()
      .from(vehicleFinancingPayments)
      .innerJoin(vehicleFinancing, eq(vehicleFinancingPayments.financingId, vehicleFinancing.id))
      .innerJoin(vehicles, eq(vehicleFinancing.vehicleId, vehicles.id))
      .where(eq(vehicles.userId, userId));

    return results.map((r) => r.vehicle_financing_payments);
  }

  /**
   * Get all insurance policies for a user
   */
  async getUserInsurance(userId: string): Promise<InsurancePolicy[]> {
    const results = await this.db
      .select()
      .from(insurancePolicies)
      .innerJoin(vehicles, eq(insurancePolicies.vehicleId, vehicles.id))
      .where(eq(vehicles.userId, userId));

    return results.map((r) => r.insurance_policies);
  }

  /**
   * Get all user data in one call
   */
  async getAllUserData(userId: string): Promise<{
    vehicles: Vehicle[];
    expenses: Expense[];
    financing: VehicleFinancing[];
    financingPayments: VehicleFinancingPayment[];
    insurance: InsurancePolicy[];
  }> {
    const [userVehicles, userExpenses, userFinancing, userFinancingPayments, userInsurance] =
      await Promise.all([
        this.getUserVehicles(userId),
        this.getUserExpenses(userId),
        this.getUserFinancing(userId),
        this.getUserFinancingPayments(userId),
        this.getUserInsurance(userId),
      ]);

    return {
      vehicles: userVehicles,
      expenses: userExpenses,
      financing: userFinancing,
      financingPayments: userFinancingPayments,
      insurance: userInsurance,
    };
  }
}
