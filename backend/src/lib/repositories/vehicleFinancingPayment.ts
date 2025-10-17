import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import type { NewVehicleFinancingPayment, VehicleFinancingPayment } from '../../db/schema.js';
import { vehicleFinancingPayments } from '../../db/schema.js';
import { BaseRepository } from './base.js';
import type { IVehicleFinancingPaymentRepository } from './interfaces.js';

export class VehicleFinancingPaymentRepository
  extends BaseRepository<VehicleFinancingPayment, NewVehicleFinancingPayment>
  implements IVehicleFinancingPaymentRepository
{
  constructor() {
    super(vehicleFinancingPayments);
  }

  async findByFinancingId(financingId: string): Promise<VehicleFinancingPayment[]> {
    try {
      const result = await this.database
        .select()
        .from(vehicleFinancingPayments)
        .where(eq(vehicleFinancingPayments.financingId, financingId))
        .orderBy(desc(vehicleFinancingPayments.paymentDate));
      return result;
    } catch (error) {
      console.error(`Error finding payments for financing ${financingId}:`, error);
      throw new Error('Failed to find payments for financing');
    }
  }

  async findByFinancingIdAndDateRange(
    financingId: string,
    startDate: Date,
    endDate: Date
  ): Promise<VehicleFinancingPayment[]> {
    try {
      const result = await this.database
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
      console.error(`Error finding payments for financing ${financingId} in date range:`, error);
      throw new Error('Failed to find payments for date range');
    }
  }

  async getLastPayment(financingId: string): Promise<VehicleFinancingPayment | null> {
    try {
      const result = await this.database
        .select()
        .from(vehicleFinancingPayments)
        .where(eq(vehicleFinancingPayments.financingId, financingId))
        .orderBy(desc(vehicleFinancingPayments.paymentDate))
        .limit(1);
      return result[0] || null;
    } catch (error) {
      console.error(`Error finding last payment for financing ${financingId}:`, error);
      throw new Error('Failed to find last payment');
    }
  }

  async getPaymentCount(financingId: string): Promise<number> {
    try {
      const result = await this.database
        .select({
          count: sql<number>`count(*)`.as('count'),
        })
        .from(vehicleFinancingPayments)
        .where(eq(vehicleFinancingPayments.financingId, financingId));

      return Number(result[0]?.count) || 0;
    } catch (error) {
      console.error(`Error getting payment count for financing ${financingId}:`, error);
      throw new Error('Failed to get payment count');
    }
  }
}
