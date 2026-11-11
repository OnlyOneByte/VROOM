/**
 * Every query is scoped by policyId, so the route's policy-ownership check also covers claims.
 */

import { and, desc, eq } from 'drizzle-orm';
import type { AppDatabase } from '../../db/connection';
import { getDb } from '../../db/connection';
import type { InsuranceClaim } from '../../db/schema';
import { insuranceClaims, insurancePolicies } from '../../db/schema';
import { DatabaseError, NotFoundError } from '../../errors';
import { logger } from '../../utils/logger';

export interface CreateClaimInput {
  claimDate: Date;
  claimType: string;
  description?: string;
  status?: string;
  payoutAmount?: number;
  faultDesignation?: string;
  termId?: string;
  vehicleId?: string;
}

export interface UpdateClaimInput {
  claimDate?: Date;
  claimType?: string;
  // null clears a column; undefined leaves it unchanged.
  description?: string | null;
  status?: string;
  payoutAmount?: number | null;
  faultDesignation?: string | null;
  termId?: string | null;
  vehicleId?: string | null;
}

export class InsuranceClaimRepository {
  private db: AppDatabase;

  constructor(db: AppDatabase) {
    this.db = db;
  }

  async findByPolicyId(policyId: string): Promise<InsuranceClaim[]> {
    try {
      return await this.db
        .select()
        .from(insuranceClaims)
        .where(eq(insuranceClaims.policyId, policyId))
        .orderBy(desc(insuranceClaims.claimDate));
    } catch (error) {
      logger.error('Error fetching insurance claims', { policyId, error });
      throw new DatabaseError('Failed to fetch insurance claims', error);
    }
  }

  /**
   * Resolves the owning user through the claim's policy. Used for photo ownership checks when only claimId is known.
   */
  async findOwnerUserId(claimId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ userId: insurancePolicies.userId })
      .from(insuranceClaims)
      .innerJoin(insurancePolicies, eq(insuranceClaims.policyId, insurancePolicies.id))
      .where(eq(insuranceClaims.id, claimId))
      .limit(1);
    return row?.userId ?? null;
  }

  async findById(policyId: string, claimId: string): Promise<InsuranceClaim> {
    const [claim] = await this.db
      .select()
      .from(insuranceClaims)
      .where(and(eq(insuranceClaims.id, claimId), eq(insuranceClaims.policyId, policyId)));
    if (!claim) {
      throw new NotFoundError('Insurance claim');
    }
    return claim;
  }

  async create(policyId: string, data: CreateClaimInput): Promise<InsuranceClaim> {
    try {
      const [claim] = await this.db
        .insert(insuranceClaims)
        .values({
          policyId,
          claimDate: data.claimDate,
          claimType: data.claimType,
          description: data.description ?? null,
          status: data.status ?? 'filed',
          payoutAmount: data.payoutAmount ?? null,
          faultDesignation: data.faultDesignation ?? null,
          termId: data.termId ?? null,
          vehicleId: data.vehicleId ?? null,
        })
        .returning();
      if (!claim) {
        throw new DatabaseError('Failed to create insurance claim');
      }
      return claim;
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      logger.error('Error creating insurance claim', { policyId, error });
      throw new DatabaseError('Failed to create insurance claim', error);
    }
  }

  async update(
    policyId: string,
    claimId: string,
    updates: UpdateClaimInput
  ): Promise<InsuranceClaim> {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.claimDate !== undefined) patch.claimDate = updates.claimDate;
    if (updates.claimType !== undefined) patch.claimType = updates.claimType;
    if (updates.description !== undefined) patch.description = updates.description;
    if (updates.status !== undefined) patch.status = updates.status;
    if (updates.payoutAmount !== undefined) patch.payoutAmount = updates.payoutAmount;
    if (updates.faultDesignation !== undefined) patch.faultDesignation = updates.faultDesignation;
    if (updates.termId !== undefined) patch.termId = updates.termId;
    if (updates.vehicleId !== undefined) patch.vehicleId = updates.vehicleId;

    try {
      const [claim] = await this.db
        .update(insuranceClaims)
        .set(patch)
        .where(and(eq(insuranceClaims.id, claimId), eq(insuranceClaims.policyId, policyId)))
        .returning();
      if (!claim) {
        throw new NotFoundError('Insurance claim');
      }
      return claim;
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      logger.error('Error updating insurance claim', { policyId, claimId, error });
      throw new DatabaseError('Failed to update insurance claim', error);
    }
  }

  async delete(policyId: string, claimId: string): Promise<void> {
    await this.findById(policyId, claimId);
    try {
      await this.db
        .delete(insuranceClaims)
        .where(and(eq(insuranceClaims.id, claimId), eq(insuranceClaims.policyId, policyId)));
    } catch (error) {
      logger.error('Error deleting insurance claim', { policyId, claimId, error });
      throw new DatabaseError('Failed to delete insurance claim', error);
    }
  }
}

export const insuranceClaimRepository = new InsuranceClaimRepository(getDb());
