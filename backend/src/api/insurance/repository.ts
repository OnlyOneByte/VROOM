import { createId } from '@paralleldrive/cuid2';
import { and, between, desc, eq, inArray } from 'drizzle-orm';
import type { AppDatabase } from '../../db/connection';
import { getDb } from '../../db/connection';
import type { InsurancePolicy, InsuranceTerm } from '../../db/schema';
import { insurancePolicies, insuranceTerms, insuranceTermVehicles } from '../../db/schema';
import type { DrizzleTransaction } from '../../db/types';
import { DatabaseError, NotFoundError } from '../../errors';
import { logger } from '../../utils/logger';
import { assertVehiclesOwned } from '../../utils/vehicle-ownership';

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

/**
 * Nullable columns accept null to clear them. startDate and endDate are NOT NULL, so they are never null.
 */
export interface UpdateTermInput {
  startDate?: Date;
  endDate?: Date;
  policyNumber?: string | null;
  coverageDescription?: string | null;
  deductibleAmount?: number | null;
  coverageLimit?: number | null;
  agentName?: string | null;
  agentPhone?: string | null;
  agentEmail?: string | null;
  totalCost?: number | null;
  monthlyCost?: number | null;
  premiumFrequency?: string | null;
  paymentAmount?: number | null;
  vehicleCoverage?: { vehicleIds: string[] };
}

export interface CreatePolicyData {
  company: string;
  terms: CreateTermInput[];
  notes?: string;
  isActive?: boolean;
}

export interface UpdatePolicyData {
  company?: string;
  notes?: string | null;
  isActive?: boolean;
}

export interface TermCoverageRow {
  termId: string;
  vehicleId: string;
}

export type InsurancePolicyWithVehicles = InsurancePolicy & {
  terms: InsuranceTerm[];
  termVehicleCoverage: TermCoverageRow[];
  vehicleIds: string[];
};

export class InsurancePolicyRepository {
  private db: AppDatabase;

  constructor(db: AppDatabase) {
    this.db = db;
  }

  /**
   * Accepts a transaction handle so the check can run inside a write.
   */
  private async validateVehicleOwnership(
    dbOrTx: AppDatabase | DrizzleTransaction,
    vehicleIds: string[],
    userId: string
  ): Promise<void> {
    await assertVehiclesOwned(dbOrTx, vehicleIds, userId);
  }

  /**
   * Must stay synchronous: an async transaction callback under bun-sqlite autocommits each write on its own,
   * which could leave a term with partial coverage.
   */
  private insertJunctionRowsSync(
    tx: DrizzleTransaction,
    termId: string,
    vehicleIds: string[]
  ): void {
    for (const vehicleId of vehicleIds) {
      tx.insert(insuranceTermVehicles).values({ termId, vehicleId }).run();
    }
  }

  /**
   * Loads a policy's terms and coverage. Accepts a transaction handle so in-transaction callers see their own writes.
   */
  private async fetchTermsAndCoverage(
    handle: AppDatabase | DrizzleTransaction,
    policyId: string
  ): Promise<{
    terms: InsuranceTerm[];
    termVehicleCoverage: TermCoverageRow[];
    vehicleIds: string[];
  }> {
    const terms = await handle
      .select()
      .from(insuranceTerms)
      .where(eq(insuranceTerms.policyId, policyId))
      .orderBy(desc(insuranceTerms.endDate));

    const termIds = terms.map((t) => t.id);
    let termVehicleCoverage: TermCoverageRow[] = [];
    if (termIds.length > 0) {
      termVehicleCoverage = await handle
        .select({
          termId: insuranceTermVehicles.termId,
          vehicleId: insuranceTermVehicles.vehicleId,
        })
        .from(insuranceTermVehicles)
        .where(inArray(insuranceTermVehicles.termId, termIds));
    }

    const vehicleIds = [...new Set(termVehicleCoverage.map((tc) => tc.vehicleId))];
    return { terms, termVehicleCoverage, vehicleIds };
  }

  private async attachTermsAndCoverage(
    policy: InsurancePolicy
  ): Promise<InsurancePolicyWithVehicles> {
    const coverage = await this.fetchTermsAndCoverage(this.db, policy.id);
    return { ...policy, ...coverage };
  }

  async create(data: CreatePolicyData, userId: string): Promise<InsurancePolicyWithVehicles> {
    try {
      const allVehicleIds = [...new Set(data.terms.flatMap((t) => t.vehicleCoverage.vehicleIds))];
      await this.validateVehicleOwnership(this.db, allVehicleIds, userId);

      // Synchronous: see insertJunctionRowsSync.
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Policy creation requires sequential steps within a transaction
      return this.db.transaction((tx) => {
        const policyId = createId();
        const now = new Date();
        const isActive = data.isActive !== false;

        const policy = tx
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
          .returning()
          .get();

        const insertedTerms: InsuranceTerm[] = [];
        const termCoverage: TermCoverageRow[] = [];

        for (const term of data.terms) {
          const termId = createId();
          const insertedTerm = tx
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
            .returning()
            .get();

          insertedTerms.push(insertedTerm);

          this.insertJunctionRowsSync(tx, termId, term.vehicleCoverage.vehicleIds);
          for (const vid of term.vehicleCoverage.vehicleIds) {
            termCoverage.push({ termId, vehicleId: vid });
          }
        }

        return {
          ...policy,
          terms: insertedTerms,
          termVehicleCoverage: termCoverage,
          vehicleIds: [...new Set(termCoverage.map((tc) => tc.vehicleId))],
        };
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

        const coverage = await this.fetchTermsAndCoverage(tx, id);

        return { ...updatedResult[0], ...coverage };
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

  async addTerm(
    policyId: string,
    term: CreateTermInput,
    userId: string
  ): Promise<InsurancePolicyWithVehicles & { newTermId: string }> {
    try {
      await this.validateVehicleOwnership(this.db, term.vehicleCoverage.vehicleIds, userId);

      // Synchronous: see insertJunctionRowsSync.
      const termId = createId();
      this.db.transaction((tx) => {
        const existing = tx
          .select()
          .from(insurancePolicies)
          .where(eq(insurancePolicies.id, policyId))
          .limit(1)
          .all();

        if (existing.length === 0) {
          throw new NotFoundError('Insurance policy');
        }

        const now = new Date();
        tx.insert(insuranceTerms)
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
          .run();

        this.insertJunctionRowsSync(tx, termId, term.vehicleCoverage.vehicleIds);

        tx.update(insurancePolicies)
          .set({ updatedAt: now })
          .where(eq(insurancePolicies.id, policyId))
          .run();
      });

      const updatedPolicy = await this.db
        .select()
        .from(insurancePolicies)
        .where(eq(insurancePolicies.id, policyId))
        .limit(1);

      const coverage = await this.fetchTermsAndCoverage(this.db, policyId);

      return { ...updatedPolicy[0], ...coverage, newTermId: termId };
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
    updates: UpdateTermInput,
    userId: string
  ): Promise<InsurancePolicyWithVehicles> {
    try {
      const { vehicleCoverage, ...termFields } = updates;
      if (vehicleCoverage) {
        await this.validateVehicleOwnership(this.db, vehicleCoverage.vehicleIds, userId);
      }

      // Synchronous: see insertJunctionRowsSync. A coverage replace deletes then re-inserts junction rows.
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Term update requires field-by-field mapping and junction management
      this.db.transaction((tx) => {
        const existing = tx
          .select()
          .from(insurancePolicies)
          .where(eq(insurancePolicies.id, policyId))
          .limit(1)
          .all();

        if (existing.length === 0) {
          throw new NotFoundError('Insurance policy');
        }

        const termRows = tx
          .select()
          .from(insuranceTerms)
          .where(and(eq(insuranceTerms.id, termId), eq(insuranceTerms.policyId, policyId)))
          .limit(1)
          .all();

        if (termRows.length === 0) {
          throw new NotFoundError('Term');
        }

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

        tx.update(insuranceTerms).set(setFields).where(eq(insuranceTerms.id, termId)).run();

        if (vehicleCoverage) {
          tx.delete(insuranceTermVehicles).where(eq(insuranceTermVehicles.termId, termId)).run();
          this.insertJunctionRowsSync(tx, termId, vehicleCoverage.vehicleIds);
        }

        tx.update(insurancePolicies)
          .set({ updatedAt: new Date() })
          .where(eq(insurancePolicies.id, policyId))
          .run();
      });

      const updatedPolicy = await this.db
        .select()
        .from(insurancePolicies)
        .where(eq(insurancePolicies.id, policyId))
        .limit(1);

      const coverage = await this.fetchTermsAndCoverage(this.db, policyId);

      return { ...updatedPolicy[0], ...coverage };
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

        const termRows = await tx
          .select()
          .from(insuranceTerms)
          .where(and(eq(insuranceTerms.id, termId), eq(insuranceTerms.policyId, policyId)))
          .limit(1);

        if (termRows.length === 0) {
          throw new NotFoundError('Term');
        }

        // Premium expenses link by text columns, not an FK, so the caller must deleteBySource first.
        await tx.delete(insuranceTerms).where(eq(insuranceTerms.id, termId));

        await tx
          .update(insurancePolicies)
          .set({ updatedAt: new Date() })
          .where(eq(insurancePolicies.id, policyId));

        const updatedPolicy = await tx
          .select()
          .from(insurancePolicies)
          .where(eq(insurancePolicies.id, policyId))
          .limit(1);

        const coverage = await this.fetchTermsAndCoverage(tx, policyId);

        return { ...updatedPolicy[0], ...coverage };
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
   * Terms ending in the range, for active policies only. A cancelled policy must not show as expiring.
   */
  async findExpiringTerms(
    startDate: Date,
    endDate: Date,
    userId: string,
    limit = 100
  ): Promise<InsuranceTerm[]> {
    try {
      return await this.db
        .select({ term: insuranceTerms })
        .from(insuranceTerms)
        .innerJoin(insurancePolicies, eq(insuranceTerms.policyId, insurancePolicies.id))
        .where(
          and(
            between(insuranceTerms.endDate, startDate, endDate),
            eq(insurancePolicies.userId, userId),
            eq(insurancePolicies.isActive, true)
          )
        )
        .orderBy(insuranceTerms.endDate)
        .limit(limit)
        .then((rows) => rows.map((r) => r.term));
    } catch (error) {
      logger.error('Error finding expiring insurance terms', { error });
      throw new DatabaseError('Failed to find expiring insurance terms', error);
    }
  }

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

export const insurancePolicyRepository = new InsurancePolicyRepository(getDb());
