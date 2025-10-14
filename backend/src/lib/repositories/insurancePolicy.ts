import { eq, and, lte, sql } from 'drizzle-orm';
import { db } from '../../db/connection.js';
import { insurancePolicies, vehicles } from '../../db/schema.js';
import type { InsurancePolicy, NewInsurancePolicy } from '../../db/schema.js';
import type { IInsurancePolicyRepository } from './interfaces.js';
import { BaseRepository } from './base.js';

export class InsurancePolicyRepository extends BaseRepository<InsurancePolicy, NewInsurancePolicy> implements IInsurancePolicyRepository {
  constructor() {
    super(insurancePolicies);
  }

  async findByVehicleId(vehicleId: string): Promise<InsurancePolicy[]> {
    try {
      const result = await db
        .select()
        .from(insurancePolicies)
        .where(eq(insurancePolicies.vehicleId, vehicleId))
        .orderBy(insurancePolicies.startDate);
      return result;
    } catch (error) {
      console.error(`Error finding insurance policies for vehicle ${vehicleId}:`, error);
      throw new Error('Failed to find insurance policies for vehicle');
    }
  }

  async findActiveByVehicleId(vehicleId: string): Promise<InsurancePolicy | null> {
    try {
      const result = await db
        .select()
        .from(insurancePolicies)
        .where(
          and(
            eq(insurancePolicies.vehicleId, vehicleId),
            eq(insurancePolicies.isActive, true)
          )
        )
        .limit(1);
      return result[0] || null;
    } catch (error) {
      console.error(`Error finding active insurance policy for vehicle ${vehicleId}:`, error);
      throw new Error('Failed to find active insurance policy');
    }
  }

  async findExpiringPolicies(userId: string, daysFromNow: number): Promise<InsurancePolicy[]> {
    try {
      const expirationDate = new Date();
      expirationDate.setDate(expirationDate.getDate() + daysFromNow);
      
      const result = await db
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
      console.error(`Error finding expiring insurance policies:`, error);
      throw new Error('Failed to find expiring insurance policies');
    }
  }

  async markAsInactive(id: string): Promise<InsurancePolicy> {
    try {
      const result = await db
        .update(insurancePolicies)
        .set({ 
          isActive: false,
          updatedAt: new Date()
        })
        .where(eq(insurancePolicies.id, id))
        .returning();
      
      if (result.length === 0) {
        throw new Error(`Insurance policy with id ${id} not found`);
      }
      
      return result[0];
    } catch (error) {
      console.error(`Error marking insurance policy ${id} as inactive:`, error);
      throw new Error('Failed to mark insurance policy as inactive');
    }
  }
}