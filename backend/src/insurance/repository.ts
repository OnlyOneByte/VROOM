import { and, eq, lte } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { getDb } from '../db/connection';
import type { InsurancePolicy, NewInsurancePolicy } from '../db/schema';
import { insurancePolicies, vehicles } from '../db/schema';
import { BaseRepository } from '../utils/base-repository';
import { logger } from '../utils/logger';

export class InsurancePolicyRepository extends BaseRepository<InsurancePolicy, NewInsurancePolicy> {
  constructor(db: BunSQLiteDatabase<Record<string, unknown>>) {
    super(db, insurancePolicies);
  }

  async findByVehicleId(vehicleId: string): Promise<InsurancePolicy[]> {
    try {
      const result = await this.db
        .select()
        .from(insurancePolicies)
        .where(eq(insurancePolicies.vehicleId, vehicleId))
        .orderBy(insurancePolicies.startDate);
      return result;
    } catch (error) {
      logger.error('Error finding insurance policies for vehicle', { vehicleId, error });
      throw new Error('Failed to find insurance policies for vehicle');
    }
  }

  async findActiveByVehicleId(vehicleId: string): Promise<InsurancePolicy | null> {
    try {
      const whereClause = and(
        eq(insurancePolicies.vehicleId, vehicleId),
        eq(insurancePolicies.isActive, true)
      );
      if (!whereClause) {
        throw new Error('Invalid where clause');
      }
      return await this.queryBuilder.findOne(insurancePolicies, whereClause);
    } catch (error) {
      logger.error('Error finding active insurance policy for vehicle', { vehicleId, error });
      throw new Error('Failed to find active insurance policy');
    }
  }

  async findExpiringPolicies(userId: string, daysFromNow: number): Promise<InsurancePolicy[]> {
    try {
      const expirationDate = new Date();
      expirationDate.setDate(expirationDate.getDate() + daysFromNow);

      const result = await this.db
        .select({
          id: insurancePolicies.id,
          vehicleId: insurancePolicies.vehicleId,
          company: insurancePolicies.company,
          policyNumber: insurancePolicies.policyNumber,
          totalCost: insurancePolicies.totalCost,
          termLengthMonths: insurancePolicies.termLengthMonths,
          startDate: insurancePolicies.startDate,
          endDate: insurancePolicies.endDate,
          monthlyCost: insurancePolicies.monthlyCost,
          isActive: insurancePolicies.isActive,
          createdAt: insurancePolicies.createdAt,
          updatedAt: insurancePolicies.updatedAt,
        })
        .from(insurancePolicies)
        .innerJoin(vehicles, eq(insurancePolicies.vehicleId, vehicles.id))
        .where(
          and(
            eq(vehicles.userId, userId),
            eq(insurancePolicies.isActive, true),
            lte(insurancePolicies.endDate, expirationDate)
          )
        )
        .orderBy(insurancePolicies.endDate);
      return result;
    } catch (error) {
      logger.error('Error finding expiring insurance policies', { error });
      throw new Error('Failed to find expiring insurance policies');
    }
  }

  async markAsInactive(id: string): Promise<InsurancePolicy> {
    try {
      const result = await this.db
        .update(insurancePolicies)
        .set({
          isActive: false,
          updatedAt: new Date(),
        })
        .where(eq(insurancePolicies.id, id))
        .returning();

      if (result.length === 0) {
        throw new Error(`Insurance policy with id ${id} not found`);
      }

      return result[0];
    } catch (error) {
      logger.error('Error marking insurance policy as inactive', { id, error });
      throw new Error('Failed to mark insurance policy as inactive');
    }
  }
}

// Export singleton instance
export const insurancePolicyRepository = new InsurancePolicyRepository(getDb());
