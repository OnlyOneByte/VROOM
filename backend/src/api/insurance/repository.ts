import { createId } from '@paralleldrive/cuid2';
import { and, between, desc, eq, inArray } from 'drizzle-orm';
import type { AppDatabase } from '../../db/connection';
import { getDb } from '../../db/connection';
import type { InsurancePolicy, InsuranceTerm } from '../../db/schema';
import {
  insurancePolicies,
  insuranceTerms,
  insuranceTermVehicles,
  vehicles,
} from '../../db/schema';
import type { DrizzleTransaction } from '../../db/types';
import { DatabaseError, NotFoundError } from '../../errors';
import { logger } from '../../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface CreateTermInput {
  startDate: Date;
  endDate: Date;
  policyNumber?: string;
  coverageDescription?: string;
  deductibleAmount?: number;
  coverageLimit?: number;
  agentName?: string;
  agentPhone?: string;
  agentEmail?: string;
  totalCost?: number;
  monthlyCost?: number;
  premiumFrequency?: string;
  paymentAmount?: number;
  vehicleCoverage: { vehicleIds: string[] };
}

export interface CreatePolicyData {
  company: string;
  terms: CreateTermInput[];
  notes?: string;
  isActive?: boolean;
}

export interface UpdatePolicyData {
  company?: string;
  notes?: string;
  isActive?: boolean;
}

export interface TermCoverageRow {
  termId: string;
  vehicleId: string;
}

/** Policy with terms from insurance_terms table and junction coverage. */
export type InsurancePolicyWithVehicles = InsurancePolicy & {
  terms: InsuranceTerm[];
  termVehicleCoverage: TermCoverageRow[];
};

// ============================================================================
// Repository
// ============================================================================

export class InsurancePolicyRepository {
  private db: AppDatabase;

  constructor(db: AppDatabase) {
    this.db = db;
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Validate that all vehicleIds belong to the given userId.
   */
  private async validateVehicleOwnership(
    dbOrTx: AppDatabase | DrizzleTransaction,
    vehicleIds: string[],
    userId: string
  ): Promise<void> {
    if (vehicleIds.length === 0) return;

    const uniqueIds = [...new Set(vehicleIds)];
    const ownedVehicles = await dbOrTx
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(and(inArray(vehicles.id, uniqueIds), eq(vehicles.userId, userId)));

    if (ownedVehicles.length !== uniqueIds.length) {
      throw new NotFoundError('Vehicle');
    }
  }

  /**
   * Insert junction rows for a term's vehicle coverage.
   */
  private async insertJunctionRows(
    tx: DrizzleTransaction,
    termId: string,
    vehicleIds: string[]
  ): Promise<void> {
    for (const vehicleId of vehicleIds) {
      await tx.insert(insuranceTermVehicles).values({ termId, vehicleId });
    }
  }

  /**
   * Attach terms and coverage to a policy, returning InsurancePolicyWithVehicles.
   */
  private async attachTermsAndCoverage(
    policy: InsurancePolicy
  ): Promise<InsurancePolicyWithVehicles> {
    const terms = await this.db
      .select()
      .from(insuranceTerms)
      .where(eq(insuranceTerms.policyId, policy.id))
      .orderBy(desc(insuranceTerms.endDate));

    const termIds = terms.map((t) => t.id);
    let termVehicleCoverage: TermCoverageRow[] = [];
    if (termIds.length > 0) {
      const rows = await this.db
        .select({
          termId: insuranceTermVehicles.termId,
          vehicleId: insuranceTermVehicles.vehicleId,
        })
        .from(insuranceTermVehicles)
        .where(inArray(insuranceTermVehicles.termId, termIds));
      termVehicleCoverage = rows;
    }

    return { ...policy, terms, termVehicleCoverage };
  }

  // --------------------------------------------------------------------------
  // Policy CRUD
  // --------------------------------------------------------------------------

  async create(data: CreatePolicyData, userId: string): Promise<InsurancePolicyWithVehicles> {
    try {
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Policy creation requires sequential steps within a transaction
      return await this.db.transaction(async (tx) => {
        // Validate vehicle ownership across all terms
        const allVehicleIds = [...new Set(data.terms.flatMap((t) => t.vehicleCoverage.vehicleIds))];
        await this.validateVehicleOwnership(tx, allVehicleIds, userId);

        // Insert policy row
        const policyId = createId();
        const now = new Date();
        const isActive = data.isActive !== false;

        const policyResult = await tx
          .insert(insurancePolicies)
          .values({
            id: policyId,
            userId,
            company: data.company,
            isActive,
            notes: data.notes ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        const policy = policyResult[0];

        // Insert terms and junction rows
        const insertedTerms: InsuranceTerm[] = [];
        const termCoverage: TermCoverageRow[] = [];

        for (const term of data.terms) {
          const termId = createId();
          const termResult = await tx
            .insert(insuranceTerms)
            .values({
              id: termId,
              policyId,
              startDate: term.startDate,
              endDate: term.endDate,
              policyNumber: term.policyNumber ?? null,
              coverageDescription: term.coverageDescription ?? null,
              deductibleAmount: term.deductibleAmount ?? null,
              coverageLimit: term.coverageLimit ?? null,
              agentName: term.agentName ?? null,
              agentPhone: term.agentPhone ?? null,
              agentEmail: term.agentEmail ?? null,
              totalCost: term.totalCost ?? null,
              monthlyCost: term.monthlyCost ?? null,
              premiumFrequency: term.premiumFrequency ?? null,
              paymentAmount: term.paymentAmount ?? null,
              createdAt: now,
              updatedAt: now,
            })
            .returning();

          insertedTerms.push(termResult[0]);

          await this.insertJunctionRows(tx, termId, term.vehicleCoverage.vehicleIds);
          for (const vid of term.vehicleCoverage.vehicleIds) {
            termCoverage.push({ termId, vehicleId: vid });
          }
        }

        return { ...policy, terms: insertedTerms, termVehicleCoverage: termCoverage };
      });
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      logger.error('Failed to create insurance policy', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to create insurance policy', error);
    }
  }

  async findById(id: string): Promise<InsurancePolicyWithVehicles | null> {
    const result = await this.db
      .select()
      .from(insurancePolicies)
      .where(eq(insurancePolicies.id, id))
      .limit(1);

    const policy = result[0];
    if (!policy) return null;

    return this.attachTermsAndCoverage(policy);
  }

  async findByUserId(userId: string): Promise<InsurancePolicyWithVehicles[]> {
    try {
      const policies = await this.db
        .select()
        .from(insurancePolicies)
        .where(eq(insurancePolicies.userId, userId));

      return Promise.all(policies.map((p) => this.attachTermsAndCoverage(p)));
    } catch (error) {
      logger.error('Error finding insurance policies for user', { error });
      throw new DatabaseError('Failed to find insurance policies for user', error);
    }
  }

  async findByVehicleId(vehicleId: string): Promise<InsurancePolicyWithVehicles[]> {
    try {
      const result = await this.db
        .select({ policy: insurancePolicies })
        .from(insurancePolicies)
        .innerJoin(insuranceTerms, eq(insurancePolicies.id, insuranceTerms.policyId))
        .innerJoin(insuranceTermVehicles, eq(insuranceTerms.id, insuranceTermVehicles.termId))
        .where(eq(insuranceTermVehicles.vehicleId, vehicleId))
        .groupBy(insurancePolicies.id);

      const policies = result.map((r) => r.policy);
      return Promise.all(policies.map((p) => this.attachTermsAndCoverage(p)));
    } catch (error) {
      logger.error('Error finding insurance policies for vehicle', { vehicleId, error });
      throw new DatabaseError('Failed to find insurance policies for vehicle', error);
    }
  }

  async update(
    id: string,
    data: UpdatePolicyData,
    _userId: string
  ): Promise<InsurancePolicyWithVehicles> {
    try {
      return await this.db.transaction(async (tx) => {
        const existing = await tx
          .select()
          .from(insurancePolicies)
          .where(eq(insurancePolicies.id, id))
          .limit(1);

        if (existing.length === 0) {
          throw new NotFoundError('Insurance policy');
        }

        const fields: Record<string, unknown> = { updatedAt: new Date() };
        if (data.company !== undefined) fields.company = data.company;
        if (data.notes !== undefined) fields.notes = data.notes;
        if (data.isActive !== undefined) fields.isActive = data.isActive;

        const updatedResult = await tx
          .update(insurancePolicies)
          .set(fields)
          .where(eq(insurancePolicies.id, id))
          .returning();

        // Fetch terms and coverage for the response
        const terms = await tx
          .select()
          .from(insuranceTerms)
          .where(eq(insuranceTerms.policyId, id))
          .orderBy(desc(insuranceTerms.endDate));

        const termIds = terms.map((t) => t.id);
        let termVehicleCoverage: TermCoverageRow[] = [];
        if (termIds.length > 0) {
          termVehicleCoverage = await tx
            .select({
              termId: insuranceTermVehicles.termId,
              vehicleId: insuranceTermVehicles.vehicleId,
            })
            .from(insuranceTermVehicles)
            .where(inArray(insuranceTermVehicles.termId, termIds));
        }

        return { ...updatedResult[0], terms, termVehicleCoverage };
      });
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      logger.error('Failed to update insurance policy', {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to update insurance policy', error);
    }
  }

  async delete(id: string, _userId: string): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        const existing = await tx
          .select()
          .from(insurancePolicies)
          .where(eq(insurancePolicies.id, id))
          .limit(1);

        if (existing.length === 0) {
          throw new NotFoundError('Insurance policy');
        }

        // Delete the policy — terms and junction rows cascade via FK ON DELETE CASCADE
        await tx.delete(insurancePolicies).where(eq(insurancePolicies.id, id));
      });
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      logger.error('Failed to delete insurance policy', {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to delete insurance policy', error);
    }
  }

  // --------------------------------------------------------------------------
  // Term CRUD
  // --------------------------------------------------------------------------

  async addTerm(
    policyId: string,
    term: CreateTermInput,
    userId: string
  ): Promise<InsurancePolicyWithVehicles> {
    try {
      return await this.db.transaction(async (tx) => {
        const existing = await tx
          .select()
          .from(insurancePolicies)
          .where(eq(insurancePolicies.id, policyId))
          .limit(1);

        if (existing.length === 0) {
          throw new NotFoundError('Insurance policy');
        }

        // Validate vehicle ownership
        await this.validateVehicleOwnership(tx, term.vehicleCoverage.vehicleIds, userId);

        // Insert term row
        const termId = createId();
        const now = new Date();
        await tx.insert(insuranceTerms).values({
          id: termId,
          policyId,
          startDate: term.startDate,
          endDate: term.endDate,
          policyNumber: term.policyNumber ?? null,
          coverageDescription: term.coverageDescription ?? null,
          deductibleAmount: term.deductibleAmount ?? null,
          coverageLimit: term.coverageLimit ?? null,
          agentName: term.agentName ?? null,
          agentPhone: term.agentPhone ?? null,
          agentEmail: term.agentEmail ?? null,
          totalCost: term.totalCost ?? null,
          monthlyCost: term.monthlyCost ?? null,
          premiumFrequency: term.premiumFrequency ?? null,
          paymentAmount: term.paymentAmount ?? null,
          createdAt: now,
          updatedAt: now,
        });

        // Insert junction rows
        await this.insertJunctionRows(tx, termId, term.vehicleCoverage.vehicleIds);

        // Update policy updatedAt
        await tx
          .update(insurancePolicies)
          .set({ updatedAt: now })
          .where(eq(insurancePolicies.id, policyId));

        // Fetch full policy with terms for response
        const updatedPolicy = await tx
          .select()
          .from(insurancePolicies)
          .where(eq(insurancePolicies.id, policyId))
          .limit(1);

        const terms = await tx
          .select()
          .from(insuranceTerms)
          .where(eq(insuranceTerms.policyId, policyId))
          .orderBy(desc(insuranceTerms.endDate));

        const termIds = terms.map((t) => t.id);
        let termVehicleCoverage: TermCoverageRow[] = [];
        if (termIds.length > 0) {
          termVehicleCoverage = await tx
            .select({
              termId: insuranceTermVehicles.termId,
              vehicleId: insuranceTermVehicles.vehicleId,
            })
            .from(insuranceTermVehicles)
            .where(inArray(insuranceTermVehicles.termId, termIds));
        }

        return { ...updatedPolicy[0], terms, termVehicleCoverage };
      });
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      logger.error('Failed to add term to insurance policy', {
        policyId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to add term to insurance policy', error);
    }
  }

  async updateTerm(
    policyId: string,
    termId: string,
    updates: Partial<CreateTermInput>,
    userId: string
  ): Promise<InsurancePolicyWithVehicles> {
    try {
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Term update requires field-by-field mapping and junction management
      return await this.db.transaction(async (tx) => {
        // Verify policy exists
        const existing = await tx
          .select()
          .from(insurancePolicies)
          .where(eq(insurancePolicies.id, policyId))
          .limit(1);

        if (existing.length === 0) {
          throw new NotFoundError('Insurance policy');
        }

        // Verify term exists and belongs to this policy
        const termRows = await tx
          .select()
          .from(insuranceTerms)
          .where(and(eq(insuranceTerms.id, termId), eq(insuranceTerms.policyId, policyId)))
          .limit(1);

        if (termRows.length === 0) {
          throw new NotFoundError('Term');
        }

        // Build update fields
        const { vehicleCoverage, ...termFields } = updates;
        const setFields: Record<string, unknown> = { updatedAt: new Date() };
        if (termFields.startDate !== undefined) setFields.startDate = termFields.startDate;
        if (termFields.endDate !== undefined) setFields.endDate = termFields.endDate;
        if (termFields.policyNumber !== undefined) setFields.policyNumber = termFields.policyNumber;
        if (termFields.coverageDescription !== undefined)
          setFields.coverageDescription = termFields.coverageDescription;
        if (termFields.deductibleAmount !== undefined)
          setFields.deductibleAmount = termFields.deductibleAmount;
        if (termFields.coverageLimit !== undefined)
          setFields.coverageLimit = termFields.coverageLimit;
        if (termFields.agentName !== undefined) setFields.agentName = termFields.agentName;
        if (termFields.agentPhone !== undefined) setFields.agentPhone = termFields.agentPhone;
        if (termFields.agentEmail !== undefined) setFields.agentEmail = termFields.agentEmail;
        if (termFields.totalCost !== undefined) setFields.totalCost = termFields.totalCost;
        if (termFields.monthlyCost !== undefined) setFields.monthlyCost = termFields.monthlyCost;
        if (termFields.premiumFrequency !== undefined)
          setFields.premiumFrequency = termFields.premiumFrequency;
        if (termFields.paymentAmount !== undefined)
          setFields.paymentAmount = termFields.paymentAmount;

        await tx.update(insuranceTerms).set(setFields).where(eq(insuranceTerms.id, termId));

        // Handle vehicle coverage changes
        if (vehicleCoverage) {
          await this.validateVehicleOwnership(tx, vehicleCoverage.vehicleIds, userId);

          // Delete old junction rows and insert new ones
          await tx.delete(insuranceTermVehicles).where(eq(insuranceTermVehicles.termId, termId));
          await this.insertJunctionRows(tx, termId, vehicleCoverage.vehicleIds);
        }

        // Update policy updatedAt
        await tx
          .update(insurancePolicies)
          .set({ updatedAt: new Date() })
          .where(eq(insurancePolicies.id, policyId));

        // Fetch full policy with terms for response
        const updatedPolicy = await tx
          .select()
          .from(insurancePolicies)
          .where(eq(insurancePolicies.id, policyId))
          .limit(1);

        const terms = await tx
          .select()
          .from(insuranceTerms)
          .where(eq(insuranceTerms.policyId, policyId))
          .orderBy(desc(insuranceTerms.endDate));

        const termIds = terms.map((t) => t.id);
        let termVehicleCoverage: TermCoverageRow[] = [];
        if (termIds.length > 0) {
          termVehicleCoverage = await tx
            .select({
              termId: insuranceTermVehicles.termId,
              vehicleId: insuranceTermVehicles.vehicleId,
            })
            .from(insuranceTermVehicles)
            .where(inArray(insuranceTermVehicles.termId, termIds));
        }

        return { ...updatedPolicy[0], terms, termVehicleCoverage };
      });
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      logger.error('Failed to update term in insurance policy', {
        policyId,
        termId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to update term in insurance policy', error);
    }
  }

  async deleteTerm(
    policyId: string,
    termId: string,
    _userId: string
  ): Promise<InsurancePolicyWithVehicles> {
    try {
      return await this.db.transaction(async (tx) => {
        const existing = await tx
          .select()
          .from(insurancePolicies)
          .where(eq(insurancePolicies.id, policyId))
          .limit(1);

        if (existing.length === 0) {
          throw new NotFoundError('Insurance policy');
        }

        // Verify term exists
        const termRows = await tx
          .select()
          .from(insuranceTerms)
          .where(and(eq(insuranceTerms.id, termId), eq(insuranceTerms.policyId, policyId)))
          .limit(1);

        if (termRows.length === 0) {
          throw new NotFoundError('Term');
        }

        // Delete term — junction rows cascade, expenses get SET NULL via FK
        await tx.delete(insuranceTerms).where(eq(insuranceTerms.id, termId));

        // Update policy updatedAt
        await tx
          .update(insurancePolicies)
          .set({ updatedAt: new Date() })
          .where(eq(insurancePolicies.id, policyId));

        // Fetch full policy with remaining terms
        const updatedPolicy = await tx
          .select()
          .from(insurancePolicies)
          .where(eq(insurancePolicies.id, policyId))
          .limit(1);

        const terms = await tx
          .select()
          .from(insuranceTerms)
          .where(eq(insuranceTerms.policyId, policyId))
          .orderBy(desc(insuranceTerms.endDate));

        const termIds = terms.map((t) => t.id);
        let termVehicleCoverage: TermCoverageRow[] = [];
        if (termIds.length > 0) {
          termVehicleCoverage = await tx
            .select({
              termId: insuranceTermVehicles.termId,
              vehicleId: insuranceTermVehicles.vehicleId,
            })
            .from(insuranceTermVehicles)
            .where(inArray(insuranceTermVehicles.termId, termIds));
        }

        return { ...updatedPolicy[0], terms, termVehicleCoverage };
      });
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      logger.error('Failed to delete term from insurance policy', {
        policyId,
        termId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to delete term from insurance policy', error);
    }
  }

  // --------------------------------------------------------------------------
  // Derived queries
  // --------------------------------------------------------------------------

  /**
   * Get the current (latest) term dates for a policy.
   * Returns the term with the latest end_date.
   */
  async getCurrentTermDates(policyId: string): Promise<{ startDate: Date; endDate: Date } | null> {
    const result = await this.db
      .select({
        startDate: insuranceTerms.startDate,
        endDate: insuranceTerms.endDate,
      })
      .from(insuranceTerms)
      .where(eq(insuranceTerms.policyId, policyId))
      .orderBy(desc(insuranceTerms.endDate))
      .limit(1);

    if (result.length === 0) return null;
    return { startDate: result[0].startDate, endDate: result[0].endDate };
  }

  /**
   * Find terms expiring within a date range.
   */
  async findExpiringTerms(startDate: Date, endDate: Date): Promise<InsuranceTerm[]> {
    try {
      return await this.db
        .select()
        .from(insuranceTerms)
        .where(between(insuranceTerms.endDate, startDate, endDate))
        .orderBy(insuranceTerms.endDate);
    } catch (error) {
      logger.error('Error finding expiring insurance terms', { error });
      throw new DatabaseError('Failed to find expiring insurance terms', error);
    }
  }

  /**
   * Derive the active insurance policy ID for a vehicle via JOIN.
   * Returns the policy with the latest term end_date where is_active = 1.
   */
  async getActiveInsurancePolicyId(vehicleId: string): Promise<string | null> {
    try {
      const result = await this.db
        .select({ id: insurancePolicies.id })
        .from(insurancePolicies)
        .innerJoin(insuranceTerms, eq(insuranceTerms.policyId, insurancePolicies.id))
        .innerJoin(insuranceTermVehicles, eq(insuranceTermVehicles.termId, insuranceTerms.id))
        .where(
          and(eq(insuranceTermVehicles.vehicleId, vehicleId), eq(insurancePolicies.isActive, true))
        )
        .orderBy(desc(insuranceTerms.endDate))
        .limit(1);

      return result[0]?.id ?? null;
    } catch (error) {
      logger.error('Error deriving active insurance policy for vehicle', { vehicleId, error });
      throw new DatabaseError('Failed to derive active insurance policy', error);
    }
  }
}

// Export singleton instance
export const insurancePolicyRepository = new InsurancePolicyRepository(getDb());
