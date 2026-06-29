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

/**
 * Update shape for a term. Differs from CreateTermInput: the nullable value
 * columns accept `null` to CLEAR them (vs `undefined`/absent = leave unchanged).
 * startDate/endDate map to NOT NULL columns, so they're optional but never null.
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
  // null clears the notes column (vs undefined = leave unchanged).
  notes?: string | null;
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
  vehicleIds: string[];
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
   * Validate that all vehicleIds belong to the given userId. Delegates to the shared
   * assertVehiclesOwned (C376) — ONE source of truth for the cross-tenant ownership query shared with
   * the expense split path; the insurance term writes run inside a tx, hence the dbOrTx handle.
   */
  private async validateVehicleOwnership(
    dbOrTx: AppDatabase | DrizzleTransaction,
    vehicleIds: string[],
    userId: string
  ): Promise<void> {
    await assertVehiclesOwned(dbOrTx, vehicleIds, userId);
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
   * SYNCHRONOUS sibling of insertJunctionRows (#127 class, C504). bun-sqlite is a sync dialect, so the
   * create/addTerm/updateTerm transactions run their callbacks synchronously for real atomic rollback — an
   * async callback autocommits each write alone (the C151 footgun), which could leave a term with partial
   * or zero vehicle coverage (updateTerm wipes coverage then re-inserts). `.run()` executes inline in tx.
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
   * Fetch a policy's terms (newest endDate first) + the term→vehicle junction coverage, and derive the
   * unique vehicleIds. The byte-identical "select terms by policyId ordered by endDate desc → select the
   * junction rows for those termIds → dedupe vehicleIds" block was hand-repeated at FOUR sites
   * (attachTermsAndCoverage + the create/update-policy, add-term, and update-term transactions, C304
   * dedup). Takes the active handle (`this.db` OR a transaction `tx`) so the in-tx callers read their own
   * uncommitted writes; pure assembly otherwise. One source of truth for the response's coverage shape so
   * a junction-schema change can't drift across the four. NOTE: callers spread the result alongside their
   * own policy row (and some add a `newTermId`), so this returns the three coverage fields only.
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

  /**
   * Attach terms and coverage to a policy, returning InsurancePolicyWithVehicles.
   */
  private async attachTermsAndCoverage(
    policy: InsurancePolicy
  ): Promise<InsurancePolicyWithVehicles> {
    const coverage = await this.fetchTermsAndCoverage(this.db, policy.id);
    return { ...policy, ...coverage };
  }

  // --------------------------------------------------------------------------
  // Policy CRUD
  // --------------------------------------------------------------------------

  async create(data: CreatePolicyData, userId: string): Promise<InsurancePolicyWithVehicles> {
    try {
      // Validate vehicle ownership across all terms BEFORE the tx — a pure read precondition independent
      // of the writes, so it does not belong inside the (now synchronous) write transaction.
      const allVehicleIds = [...new Set(data.terms.flatMap((t) => t.vehicleCoverage.vehicleIds))];
      await this.validateVehicleOwnership(this.db, allVehicleIds, userId);

      // SYNCHRONOUS transaction (#127 class, C504): policy insert THEN per-term inserts + junction rows.
      // Under the old async callback a throw mid-loop left an orphan policy with partial/zero terms (the
      // junction insert could fail after the policy committed). Running synchronously (.returning().get() /
      // insertJunctionRowsSync inline) keeps every insert in ONE real transaction that rolls back atomically.
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Policy creation requires sequential steps within a transaction
      return this.db.transaction((tx) => {
        // Insert policy row
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

        // Insert terms and junction rows
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

        // Fetch terms and coverage for the response (shared assembly, C304)
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

  // --------------------------------------------------------------------------
  // Term CRUD
  // --------------------------------------------------------------------------

  async addTerm(
    policyId: string,
    term: CreateTermInput,
    userId: string
  ): Promise<InsurancePolicyWithVehicles & { newTermId: string }> {
    try {
      // Validate vehicle ownership BEFORE the tx — a pure read precondition (see create()).
      await this.validateVehicleOwnership(this.db, term.vehicleCoverage.vehicleIds, userId);

      // SYNCHRONOUS transaction (#127 class, C504): term insert + junction rows + policy bump must be
      // atomic — under the old async callback a throw on the junction insert left a term persisted with
      // partial/zero coverage. Running synchronously keeps them in ONE real transaction.
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

        // Insert term row
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

        // Insert junction rows
        this.insertJunctionRowsSync(tx, termId, term.vehicleCoverage.vehicleIds);

        // Update policy updatedAt
        tx.update(insurancePolicies)
          .set({ updatedAt: now })
          .where(eq(insurancePolicies.id, policyId))
          .run();
      });

      // Assemble the response from now-committed data (reads, outside the write tx).
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
      // Validate vehicle ownership BEFORE the tx when coverage is changing — a pure read precondition.
      const { vehicleCoverage, ...termFields } = updates;
      if (vehicleCoverage) {
        await this.validateVehicleOwnership(this.db, vehicleCoverage.vehicleIds, userId);
      }

      // SYNCHRONOUS transaction (#127 class, C504): the coverage change DELETEs all junction rows then
      // re-inserts — under the old async callback a throw on the re-insert left the term with ZERO
      // coverage (the #114/#110 money-facing class). Running synchronously keeps the term update +
      // junction replace + policy bump in ONE real transaction that rolls back atomically.
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Term update requires field-by-field mapping and junction management
      this.db.transaction((tx) => {
        // Verify policy exists
        const existing = tx
          .select()
          .from(insurancePolicies)
          .where(eq(insurancePolicies.id, policyId))
          .limit(1)
          .all();

        if (existing.length === 0) {
          throw new NotFoundError('Insurance policy');
        }

        // Verify term exists and belongs to this policy
        const termRows = tx
          .select()
          .from(insuranceTerms)
          .where(and(eq(insuranceTerms.id, termId), eq(insuranceTerms.policyId, policyId)))
          .limit(1)
          .all();

        if (termRows.length === 0) {
          throw new NotFoundError('Term');
        }

        // Build update fields
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

        // Handle vehicle coverage changes (ownership already validated above)
        if (vehicleCoverage) {
          // Delete old junction rows and insert new ones
          tx.delete(insuranceTermVehicles).where(eq(insuranceTermVehicles.termId, termId)).run();
          this.insertJunctionRowsSync(tx, termId, vehicleCoverage.vehicleIds);
        }

        // Update policy updatedAt
        tx.update(insurancePolicies)
          .set({ updatedAt: new Date() })
          .where(eq(insurancePolicies.id, policyId))
          .run();
      });

      // Assemble the response from now-committed data (reads, outside the write tx).
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
   * Find terms expiring within a date range, for ACTIVE policies only.
   *
   * The `insurancePolicies.isActive` filter (#26c) excludes terms of CANCELLED policies: this
   * backs GET /expiring-soon (upcoming-renewal nags), and a policy the user has cancelled must
   * not resurface there as "expiring" — they're not renewing it. Mirrors the active-only filter
   * the per-vehicle coverage query already uses below.
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
