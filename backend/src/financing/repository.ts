/**
 * Merged Financing Repository
 *
 * This file consolidates two financing-related repositories:
 * - vehicleFinancing.ts (vehicle financing operations)
 * - vehicleFinancingPayment.ts (financing payment operations)
 *
 * All financing and payment operations are now in this single repository.
 */

import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { getDb } from '../db/connection';
import type {
  NewVehicleFinancing,
  NewVehicleFinancingPayment,
  VehicleFinancing,
  VehicleFinancingPayment,
} from '../db/schema';
import { vehicleFinancing, vehicleFinancingPayments } from '../db/schema';
import { logger } from '../utils/logger';
import { BaseRepository } from '../utils/repository';

export class FinancingRepository extends BaseRepository<VehicleFinancing, NewVehicleFinancing> {
  constructor(db: BunSQLiteDatabase<Record<string, unknown>>) {
    super(db, vehicleFinancing);
  }

  // ============================================================================
  // FINANCING OPERATIONS
  // ============================================================================

  async findByVehicleId(vehicleId: string): Promise<VehicleFinancing | null> {
    const result = await this.db
      .select()
      .from(vehicleFinancing)
      .where(eq(vehicleFinancing.vehicleId, vehicleId))
      .limit(1);
    return result[0] || null;
  }

  async findActiveFinancing(): Promise<VehicleFinancing[]> {
    return await this.db
      .select()
      .from(vehicleFinancing)
      .where(eq(vehicleFinancing.isActive, true))
      .orderBy(asc(vehicleFinancing.startDate));
  }

  async updateBalance(id: string, newBalance: number): Promise<VehicleFinancing> {
    try {
      const result = await this.db
        .update(vehicleFinancing)
        .set({
          currentBalance: newBalance,
          updatedAt: new Date(),
        })
        .where(eq(vehicleFinancing.id, id))
        .returning();

      if (result.length === 0) {
        throw new Error(`Vehicle financing with id ${id} not found`);
      }

      return result[0];
    } catch (error) {
      logger.error('Error updating balance for financing', { id, error });
      throw new Error('Failed to update financing balance');
    }
  }

  async markAsCompleted(id: string, endDate: Date): Promise<VehicleFinancing> {
    try {
      const result = await this.db
        .update(vehicleFinancing)
        .set({
          isActive: false,
          currentBalance: 0,
          endDate: endDate,
          updatedAt: new Date(),
        })
        .where(eq(vehicleFinancing.id, id))
        .returning();

      if (result.length === 0) {
        throw new Error(`Vehicle financing with id ${id} not found`);
      }

      return result[0];
    } catch (error) {
      logger.error('Error marking financing as completed', { id, error });
      throw new Error('Failed to mark financing as completed');
    }
  }

  // ============================================================================
  // PAYMENT OPERATIONS
  // ============================================================================

  async createPayment(payment: NewVehicleFinancingPayment): Promise<VehicleFinancingPayment> {
    try {
      const result = await this.db.insert(vehicleFinancingPayments).values(payment).returning();
      return result[0];
    } catch (error) {
      logger.error('Error creating financing payment', { payment, error });
      throw new Error('Failed to create financing payment');
    }
  }

  async findPaymentsByFinancingId(financingId: string): Promise<VehicleFinancingPayment[]> {
    try {
      const result = await this.db
        .select()
        .from(vehicleFinancingPayments)
        .where(eq(vehicleFinancingPayments.financingId, financingId))
        .orderBy(desc(vehicleFinancingPayments.paymentDate));
      return result;
    } catch (error) {
      logger.error('Error finding payments for financing', { financingId, error });
      throw new Error('Failed to find payments for financing');
    }
  }

  async findPaymentsByFinancingIdAndDateRange(
    financingId: string,
    startDate: Date,
    endDate: Date
  ): Promise<VehicleFinancingPayment[]> {
    try {
      const result = await this.db
        .select()
        .from(vehicleFinancingPayments)
        .where(
          and(
            eq(vehicleFinancingPayments.financingId, financingId),
            gte(vehicleFinancingPayments.paymentDate, startDate),
            lte(vehicleFinancingPayments.paymentDate, endDate)
          )
        )
        .orderBy(desc(vehicleFinancingPayments.paymentDate));
      return result;
    } catch (error) {
      logger.error('Error finding payments for financing in date range', { financingId, error });
      throw new Error('Failed to find payments for date range');
    }
  }

  async getLastPayment(financingId: string): Promise<VehicleFinancingPayment | null> {
    try {
      const result = await this.db
        .select()
        .from(vehicleFinancingPayments)
        .where(eq(vehicleFinancingPayments.financingId, financingId))
        .orderBy(desc(vehicleFinancingPayments.paymentDate))
        .limit(1);
      return result[0] || null;
    } catch (error) {
      logger.error('Error finding last payment for financing', { financingId, error });
      throw new Error('Failed to find last payment');
    }
  }

  async getPaymentCount(financingId: string): Promise<number> {
    try {
      const result = await this.db
        .select({
          count: sql<number>`count(*)`.as('count'),
        })
        .from(vehicleFinancingPayments)
        .where(eq(vehicleFinancingPayments.financingId, financingId));

      return Number(result[0]?.count) || 0;
    } catch (error) {
      logger.error('Error getting payment count for financing', { financingId, error });
      throw new Error('Failed to get payment count');
    }
  }

  async updatePayment(
    id: string,
    updates: Partial<NewVehicleFinancingPayment>
  ): Promise<VehicleFinancingPayment> {
    try {
      const result = await this.db
        .update(vehicleFinancingPayments)
        .set(updates)
        .where(eq(vehicleFinancingPayments.id, id))
        .returning();

      if (result.length === 0) {
        throw new Error(`Financing payment with id ${id} not found`);
      }

      return result[0];
    } catch (error) {
      logger.error('Error updating financing payment', { id, error });
      throw new Error('Failed to update financing payment');
    }
  }

  async deletePayment(id: string): Promise<void> {
    try {
      await this.db.delete(vehicleFinancingPayments).where(eq(vehicleFinancingPayments.id, id));
    } catch (error) {
      logger.error('Error deleting financing payment', { id, error });
      throw new Error('Failed to delete financing payment');
    }
  }
}

// Export singleton instance
export const financingRepository = new FinancingRepository(getDb());
