import { createId } from '@paralleldrive/cuid2';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { getDb } from '../../db/connection';
import type {
  ExpenseGroup,
  InsurancePolicy,
  NewExpenseGroup,
  PolicyTerm,
  SplitConfig,
} from '../../db/schema';
import {
  expenseGroups,
  expenses,
  insurancePolicies,
  insurancePolicyVehicles,
  vehicles,
} from '../../db/schema';
import type { DrizzleTransaction } from '../../db/types';
import { ConflictError, DatabaseError, NotFoundError } from '../../errors';
import { logger } from '../../utils/logger';
import { expenseSplitService } from '../expenses/split-service';

// ============================================================================
// Types
// ============================================================================

export interface TermVehicleCoverage {
  vehicleIds: string[];
  splitMethod?: 'even' | 'absolute' | 'percentage';
  allocations?: Array<{ vehicleId: string; amount?: number; percentage?: number }>;
}

export interface CreatePolicyData {
  company: string;
  terms: Array<PolicyTerm & { vehicleCoverage: TermVehicleCoverage }>;
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

// Policy with vehicleIds and per-term coverage attached (returned from queries)
export type InsurancePolicyWithVehicles = InsurancePolicy & {
  vehicleIds: string[];
  termVehicleCoverage: TermCoverageRow[];
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Find the latest term by endDate and sync currentTermStart/currentTermEnd.
 */
function syncDenormalizedFields(terms: PolicyTerm[]): {
  currentTermStart: Date | null;
  currentTermEnd: Date | null;
} {
  if (terms.length === 0) {
    return { currentTermStart: null, currentTermEnd: null };
  }

  let latestTerm = terms[0];
  for (const term of terms) {
    if (new Date(term.endDate).getTime() > new Date(latestTerm.endDate).getTime()) {
      latestTerm = term;
    }
  }

  return {
    currentTermStart: new Date(latestTerm.startDate),
    currentTermEnd: new Date(latestTerm.endDate),
  };
}

/**
 * Build a SplitConfig from TermVehicleCoverage input.
 */
function buildSplitConfig(coverage: TermVehicleCoverage): SplitConfig {
  const method = coverage.splitMethod ?? 'even';
  if (method === 'even') {
    return { method: 'even', vehicleIds: coverage.vehicleIds };
  }
  if (method === 'absolute') {
    return {
      method: 'absolute',
      allocations:
        coverage.allocations?.map((a) => ({
          vehicleId: a.vehicleId,
          amount: a.amount ?? 0,
        })) ?? coverage.vehicleIds.map((id) => ({ vehicleId: id, amount: 0 })),
    };
  }
  // percentage
  return {
    method: 'percentage',
    allocations:
      coverage.allocations?.map((a) => ({
        vehicleId: a.vehicleId,
        percentage: a.percentage ?? 0,
      })) ?? coverage.vehicleIds.map((id) => ({ vehicleId: id, percentage: 0 })),
  };
}

/**
 * Strip vehicleCoverage from a term, returning a clean PolicyTerm for JSON storage.
 */
function stripVehicleCoverage(
  term: PolicyTerm & { vehicleCoverage?: TermVehicleCoverage }
): PolicyTerm {
  const { vehicleCoverage: _, ...cleanTerm } = term;
  return cleanTerm;
}

/**
 * Get vehicleIds for the latest (current) term from coverage rows.
 */
function getLatestTermVehicleIds(terms: PolicyTerm[], termCoverage: TermCoverageRow[]): string[] {
  if (terms.length === 0) return [];
  let latest = terms[0];
  for (const t of terms) {
    if (new Date(t.endDate).getTime() > new Date(latest.endDate).getTime()) {
      latest = t;
    }
  }
  return [...new Set(termCoverage.filter((r) => r.termId === latest.id).map((r) => r.vehicleId))];
}

// ============================================================================
// Repository
// ============================================================================

export class InsurancePolicyRepository {
  private db: BunSQLiteDatabase<Record<string, unknown>>;

  constructor(db: BunSQLiteDatabase<Record<string, unknown>>) {
    this.db = db;
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Update currentInsurancePolicyId on vehicles based on policy active state.
   */
  private async syncVehicleReferences(
    tx: DrizzleTransaction,
    policyId: string,
    vehicleIds: string[],
    isActive: boolean
  ): Promise<void> {
    if (vehicleIds.length === 0) return;

    if (isActive) {
      await tx
        .update(vehicles)
        .set({ currentInsurancePolicyId: policyId, updatedAt: new Date() })
        .where(inArray(vehicles.id, vehicleIds));
    } else {
      await tx
        .update(vehicles)
        .set({ currentInsurancePolicyId: null, updatedAt: new Date() })
        .where(
          and(inArray(vehicles.id, vehicleIds), eq(vehicles.currentInsurancePolicyId, policyId))
        );
    }
  }

  /**
   * Insert junction rows for a term's vehicle coverage.
   */
  private async insertJunctionRows(
    tx: DrizzleTransaction,
    policyId: string,
    termId: string,
    vehicleIds: string[]
  ): Promise<void> {
    for (const vehicleId of vehicleIds) {
      await tx.insert(insurancePolicyVehicles).values({ policyId, termId, vehicleId });
    }
  }

  /**
   * Create an expense group and materialize children for a term with totalCost.
   */
  private async createExpenseGroupForTerm(
    tx: DrizzleTransaction,
    policyId: string,
    company: string,
    term: PolicyTerm,
    coverage: TermVehicleCoverage,
    userId: string
  ): Promise<ExpenseGroup | null> {
    if (term.financeDetails?.totalCost == null || term.financeDetails.totalCost <= 0) {
      return null;
    }

    if (coverage.vehicleIds.length === 0) {
      return null;
    }

    const splitConfig = buildSplitConfig(coverage);

    const groupData: NewExpenseGroup = {
      id: createId(),
      userId,
      splitConfig,
      category: 'financial',
      tags: ['insurance'],
      date: new Date(term.startDate),
      description: `Insurance: ${company} (${term.startDate} to ${term.endDate})`,
      totalAmount: term.financeDetails.totalCost,
      insurancePolicyId: policyId,
      insuranceTermId: term.id,
    };

    const [group] = await tx.insert(expenseGroups).values(groupData).returning();
    await expenseSplitService.materializeChildren(tx, group);
    return group;
  }

  /**
   * Get distinct vehicleIds for a policy from the junction table.
   */
  private async getVehicleIdsForPolicy(
    db: BunSQLiteDatabase<Record<string, unknown>> | DrizzleTransaction,
    policyId: string
  ): Promise<string[]> {
    const rows = await db
      .select({ vehicleId: insurancePolicyVehicles.vehicleId })
      .from(insurancePolicyVehicles)
      .where(eq(insurancePolicyVehicles.policyId, policyId));
    // Return distinct vehicle IDs
    return [...new Set(rows.map((r) => r.vehicleId))];
  }

  /**
   * Public accessor for vehicle IDs linked to a policy.
   */
  async getVehicleIds(policyId: string): Promise<string[]> {
    return this.getVehicleIdsForPolicy(this.db, policyId);
  }

  /**
   * Validate that all vehicleIds belong to the given userId.
   */
  private async validateVehicleOwnership(
    db: BunSQLiteDatabase<Record<string, unknown>> | DrizzleTransaction,
    vehicleIds: string[],
    userId: string
  ): Promise<void> {
    if (vehicleIds.length === 0) return;

    const uniqueIds = [...new Set(vehicleIds)];
    const ownedVehicles = await db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(and(inArray(vehicles.id, uniqueIds), eq(vehicles.userId, userId)));

    if (ownedVehicles.length !== uniqueIds.length) {
      throw new NotFoundError('Vehicle');
    }
  }

  /**
   * Get term vehicle coverage rows from the junction table.
   */
  private async getTermVehicleCoverage(
    db: BunSQLiteDatabase<Record<string, unknown>> | DrizzleTransaction,
    policyId: string
  ): Promise<TermCoverageRow[]> {
    const rows = await db
      .select({
        termId: insurancePolicyVehicles.termId,
        vehicleId: insurancePolicyVehicles.vehicleId,
      })
      .from(insurancePolicyVehicles)
      .where(eq(insurancePolicyVehicles.policyId, policyId));
    return rows;
  }

  /**
   * Attach vehicleIds and termVehicleCoverage to a policy result.
   */
  private async attachVehicleIds(policy: InsurancePolicy): Promise<InsurancePolicyWithVehicles> {
    const termCoverage = await this.getTermVehicleCoverage(this.db, policy.id);
    const terms = (policy.terms ?? []) as PolicyTerm[];
    const vehicleIds = getLatestTermVehicleIds(terms, termCoverage);
    return { ...policy, vehicleIds, termVehicleCoverage: termCoverage };
  }

  // --------------------------------------------------------------------------
  // CRUD Methods
  // --------------------------------------------------------------------------

  /**
   * Create a policy with per-term vehicle coverage, junction rows, expense groups, and vehicle references.
   */
  async create(data: CreatePolicyData, userId: string): Promise<InsurancePolicyWithVehicles> {
    try {
      return await this.db.transaction(async (tx) => {
        // 1. Collect all vehicle IDs across all terms and validate ownership
        const allVehicleIds = [...new Set(data.terms.flatMap((t) => t.vehicleCoverage.vehicleIds))];
        await this.validateVehicleOwnership(tx, allVehicleIds, userId);

        // 2. Compute denormalized fields from terms
        const strippedTerms = data.terms.map(stripVehicleCoverage);
        const { currentTermStart, currentTermEnd } = syncDenormalizedFields(strippedTerms);

        // 3. Insert policy row
        const policyId = createId();
        const now = new Date();
        const isActive = data.isActive !== false;

        const policyResult = await tx
          .insert(insurancePolicies)
          .values({
            id: policyId,
            company: data.company,
            isActive,
            currentTermStart,
            currentTermEnd,
            terms: strippedTerms,
            notes: data.notes ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        const policy = policyResult[0];

        // 4. Insert junction rows and create expense groups per term
        const termCoverage: TermCoverageRow[] = [];
        for (const term of data.terms) {
          const coverage = term.vehicleCoverage;
          // Insert junction rows for this term
          await this.insertJunctionRows(tx, policyId, term.id, coverage.vehicleIds);
          for (const vid of coverage.vehicleIds) {
            termCoverage.push({ termId: term.id, vehicleId: vid });
          }

          // Create expense group if term has totalCost
          const cleanTerm = stripVehicleCoverage(term);
          await this.createExpenseGroupForTerm(
            tx,
            policyId,
            data.company,
            cleanTerm,
            coverage,
            userId
          );
        }

        // 5. Sync vehicle references if active
        if (isActive) {
          await this.syncVehicleReferences(tx, policyId, allVehicleIds, true);
        }

        const vehicleIds = getLatestTermVehicleIds(strippedTerms, termCoverage);
        return { ...policy, vehicleIds, termVehicleCoverage: termCoverage };
      });
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      logger.error('Failed to create insurance policy', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to create insurance policy', error);
    }
  }

  /**
   * Find a single policy by ID with parsed terms, vehicleIds, and termVehicleCoverage.
   */
  async findById(id: string): Promise<InsurancePolicyWithVehicles | null> {
    const result = await this.db
      .select()
      .from(insurancePolicies)
      .where(eq(insurancePolicies.id, id))
      .limit(1);

    const policy = result[0];
    if (!policy) return null;

    return this.attachVehicleIds(policy);
  }

  /**
   * Find all policies for a vehicle via junction join.
   */
  async findByVehicleId(vehicleId: string): Promise<InsurancePolicyWithVehicles[]> {
    try {
      const result = await this.db
        .select({ policy: insurancePolicies })
        .from(insurancePolicies)
        .innerJoin(
          insurancePolicyVehicles,
          eq(insurancePolicies.id, insurancePolicyVehicles.policyId)
        )
        .where(eq(insurancePolicyVehicles.vehicleId, vehicleId))
        .groupBy(insurancePolicies.id)
        .orderBy(insurancePolicies.currentTermEnd);

      const policies = result.map((r) => r.policy);
      return Promise.all(policies.map((p) => this.attachVehicleIds(p)));
    } catch (error) {
      logger.error('Error finding insurance policies for vehicle', { vehicleId, error });
      throw new DatabaseError('Failed to find insurance policies for vehicle', error);
    }
  }

  /**
   * Find all policies for a user via vehicle → junction join.
   */
  async findByUserId(userId: string): Promise<InsurancePolicyWithVehicles[]> {
    try {
      const result = await this.db
        .select({ policy: insurancePolicies })
        .from(insurancePolicies)
        .innerJoin(
          insurancePolicyVehicles,
          eq(insurancePolicies.id, insurancePolicyVehicles.policyId)
        )
        .innerJoin(vehicles, eq(insurancePolicyVehicles.vehicleId, vehicles.id))
        .where(eq(vehicles.userId, userId))
        .groupBy(insurancePolicies.id);

      const policies = result.map((r) => r.policy);
      return Promise.all(policies.map((p) => this.attachVehicleIds(p)));
    } catch (error) {
      logger.error('Error finding insurance policies for user', { error });
      throw new DatabaseError('Failed to find insurance policies for user', error);
    }
  }

  /**
   * Build the set of fields to update on the policy row.
   */
  private buildUpdateFields(data: UpdatePolicyData): Record<string, unknown> {
    const fields: Record<string, unknown> = { updatedAt: new Date() };
    if (data.company !== undefined) fields.company = data.company;
    if (data.notes !== undefined) fields.notes = data.notes;
    if (data.isActive !== undefined) fields.isActive = data.isActive;
    return fields;
  }

  /**
   * Update a policy. Vehicle assignment is per-term only — no vehicleIds on UpdatePolicyData.
   */
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

        const policy = existing[0];
        const currentVehicleIds = await this.getVehicleIdsForPolicy(tx, id);

        const updatedResult = await tx
          .update(insurancePolicies)
          .set(this.buildUpdateFields(data))
          .where(eq(insurancePolicies.id, id))
          .returning();

        // Sync vehicle references if isActive changed
        const newIsActive = data.isActive ?? policy.isActive;
        const wasActive = policy.isActive;
        if (newIsActive && !wasActive) {
          await this.syncVehicleReferences(tx, id, currentVehicleIds, true);
        } else if (!newIsActive && wasActive) {
          await this.syncVehicleReferences(tx, id, currentVehicleIds, false);
        }

        const termCoverage = await this.getTermVehicleCoverage(tx, id);
        const terms = (updatedResult[0].terms ?? []) as PolicyTerm[];
        return {
          ...updatedResult[0],
          vehicleIds: getLatestTermVehicleIds(terms, termCoverage),
          termVehicleCoverage: termCoverage,
        };
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

  /**
   * Append a term to the policy's terms JSON array with per-term vehicle coverage.
   */
  async addTerm(
    policyId: string,
    term: PolicyTerm & { vehicleCoverage: TermVehicleCoverage },
    userId: string
  ): Promise<InsurancePolicyWithVehicles> {
    try {
      return await this.db.transaction(async (tx) => {
        // 1. Fetch existing policy
        const existing = await tx
          .select()
          .from(insurancePolicies)
          .where(eq(insurancePolicies.id, policyId))
          .limit(1);

        if (existing.length === 0) {
          throw new NotFoundError('Insurance policy');
        }

        const policy = existing[0];
        const currentTerms = (policy.terms ?? []) as PolicyTerm[];

        // 2. Check for duplicate term ID
        if (currentTerms.some((t) => t.id === term.id)) {
          throw new ConflictError('Term with this ID already exists');
        }

        // 3. Validate vehicle ownership
        await this.validateVehicleOwnership(tx, term.vehicleCoverage.vehicleIds, userId);

        // 4. Strip vehicleCoverage and append term
        const cleanTerm = stripVehicleCoverage(term);
        const updatedTerms = [...currentTerms, cleanTerm];
        const { currentTermStart, currentTermEnd } = syncDenormalizedFields(updatedTerms);

        // 5. Update policy
        const updatedResult = await tx
          .update(insurancePolicies)
          .set({
            terms: updatedTerms,
            currentTermStart,
            currentTermEnd,
            updatedAt: new Date(),
          })
          .where(eq(insurancePolicies.id, policyId))
          .returning();

        // 6. Insert junction rows for the new term
        await this.insertJunctionRows(tx, policyId, term.id, term.vehicleCoverage.vehicleIds);

        // 7. Create expense group if totalCost is defined
        await this.createExpenseGroupForTerm(
          tx,
          policyId,
          policy.company,
          cleanTerm,
          term.vehicleCoverage,
          userId
        );

        // 8. Sync vehicle references if policy is active
        if (policy.isActive) {
          await this.syncVehicleReferences(tx, policyId, term.vehicleCoverage.vehicleIds, true);
        }

        const termCoverage = await this.getTermVehicleCoverage(tx, policyId);
        const vehicleIds = getLatestTermVehicleIds(updatedTerms, termCoverage);
        return { ...updatedResult[0], vehicleIds, termVehicleCoverage: termCoverage };
      });
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof ConflictError) throw error;
      logger.error('Failed to add term to insurance policy', {
        policyId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to add term to insurance policy', error);
    }
  }

  /**
   * Handle vehicleCoverage changes for a term update: re-sync junction rows,
   * update/create expense groups, and clear stale vehicle references.
   */
  private async handleCoverageUpdate(
    tx: DrizzleTransaction,
    policyId: string,
    termId: string,
    vehicleCoverage: TermVehicleCoverage,
    updatedTerm: PolicyTerm,
    policy: InsurancePolicy,
    userId: string
  ): Promise<void> {
    await this.validateVehicleOwnership(tx, vehicleCoverage.vehicleIds, userId);

    // Get old vehicle IDs for this term before deleting junction rows
    const oldTermRows = await tx
      .select({ vehicleId: insurancePolicyVehicles.vehicleId })
      .from(insurancePolicyVehicles)
      .where(
        and(
          eq(insurancePolicyVehicles.policyId, policyId),
          eq(insurancePolicyVehicles.termId, termId)
        )
      );
    const oldVehicleIds = oldTermRows.map((r) => r.vehicleId);

    // Delete old junction rows for this term and insert new ones
    await tx
      .delete(insurancePolicyVehicles)
      .where(
        and(
          eq(insurancePolicyVehicles.policyId, policyId),
          eq(insurancePolicyVehicles.termId, termId)
        )
      );
    await this.insertJunctionRows(tx, policyId, termId, vehicleCoverage.vehicleIds);

    // Update or create expense group
    await this.syncExpenseGroupForTerm(
      tx,
      policyId,
      termId,
      vehicleCoverage,
      updatedTerm,
      policy.company,
      userId
    );

    // Clear currentInsurancePolicyId for removed vehicles not covered by other terms
    await this.clearRemovedVehicleRefs(tx, policyId, oldVehicleIds, vehicleCoverage.vehicleIds);

    // Sync references for newly added vehicles if policy is active
    if (policy.isActive) {
      const newVehicleIds = vehicleCoverage.vehicleIds.filter(
        (vid) => !oldVehicleIds.includes(vid)
      );
      if (newVehicleIds.length > 0) {
        await this.syncVehicleReferences(tx, policyId, newVehicleIds, true);
      }
    }
  }

  /**
   * Update or create an expense group for a term based on coverage changes.
   */
  private async syncExpenseGroupForTerm(
    tx: DrizzleTransaction,
    policyId: string,
    termId: string,
    coverage: TermVehicleCoverage,
    term: PolicyTerm,
    company: string,
    userId: string
  ): Promise<void> {
    const existingGroups = await tx
      .select()
      .from(expenseGroups)
      .where(
        and(
          eq(expenseGroups.insurancePolicyId, policyId),
          eq(expenseGroups.insuranceTermId, termId)
        )
      );

    if (existingGroups.length > 0) {
      const group = existingGroups[0];
      const newSplitConfig = buildSplitConfig(coverage);
      const newTotalAmount = term.financeDetails?.totalCost ?? undefined;
      await expenseSplitService.updateSplit(tx, group.id, newSplitConfig, newTotalAmount);
    } else if (term.financeDetails?.totalCost != null) {
      await this.createExpenseGroupForTerm(tx, policyId, company, term, coverage, userId);
    }
  }

  /**
   * Clear currentInsurancePolicyId for vehicles removed from a term
   * that aren't covered by other terms of the same policy.
   */
  private async clearRemovedVehicleRefs(
    tx: DrizzleTransaction,
    policyId: string,
    oldVehicleIds: string[],
    newVehicleIds: string[]
  ): Promise<void> {
    const removedVehicleIds = oldVehicleIds.filter((vid) => !newVehicleIds.includes(vid));
    if (removedVehicleIds.length === 0) return;

    const stillCoveredRows = await tx
      .select({ vehicleId: insurancePolicyVehicles.vehicleId })
      .from(insurancePolicyVehicles)
      .where(
        and(
          eq(insurancePolicyVehicles.policyId, policyId),
          inArray(insurancePolicyVehicles.vehicleId, removedVehicleIds)
        )
      );
    const stillCoveredIds = new Set(stillCoveredRows.map((r) => r.vehicleId));
    const trulyRemovedIds = removedVehicleIds.filter((vid) => !stillCoveredIds.has(vid));

    if (trulyRemovedIds.length > 0) {
      await tx
        .update(vehicles)
        .set({ currentInsurancePolicyId: null, updatedAt: new Date() })
        .where(
          and(
            inArray(vehicles.id, trulyRemovedIds),
            eq(vehicles.currentInsurancePolicyId, policyId)
          )
        );
    }
  }

  /**
   * Update a specific term in the policy's terms JSON array by termId.
   * If vehicleCoverage is provided, re-sync junction rows and regenerate expense children.
   */
  async updateTerm(
    policyId: string,
    termId: string,
    termData: Partial<PolicyTerm> & { vehicleCoverage?: TermVehicleCoverage },
    userId: string
  ): Promise<InsurancePolicyWithVehicles> {
    try {
      return await this.db.transaction(async (tx) => {
        // 1. Fetch existing policy
        const existing = await tx
          .select()
          .from(insurancePolicies)
          .where(eq(insurancePolicies.id, policyId))
          .limit(1);

        if (existing.length === 0) {
          throw new NotFoundError('Insurance policy');
        }

        const policy = existing[0];
        const currentTerms = (policy.terms ?? []) as PolicyTerm[];

        // 2. Find and update the specific term
        const termIndex = currentTerms.findIndex((t) => t.id === termId);
        if (termIndex === -1) {
          throw new NotFoundError('Term');
        }

        const { vehicleCoverage, ...termFields } = termData;
        const updatedTerms = [...currentTerms];
        updatedTerms[termIndex] = {
          ...currentTerms[termIndex],
          ...termFields,
          id: termId,
        };

        // 3. Sync denormalized fields
        const { currentTermStart, currentTermEnd } = syncDenormalizedFields(updatedTerms);

        // 4. Update policy
        const updatedResult = await tx
          .update(insurancePolicies)
          .set({
            terms: updatedTerms,
            currentTermStart,
            currentTermEnd,
            updatedAt: new Date(),
          })
          .where(eq(insurancePolicies.id, policyId))
          .returning();

        // 5. Handle vehicleCoverage changes
        if (vehicleCoverage) {
          await this.handleCoverageUpdate(
            tx,
            policyId,
            termId,
            vehicleCoverage,
            updatedTerms[termIndex],
            policy,
            userId
          );
        }

        const termCoverage = await this.getTermVehicleCoverage(tx, policyId);
        const vehicleIds = getLatestTermVehicleIds(updatedTerms, termCoverage);
        return { ...updatedResult[0], vehicleIds, termVehicleCoverage: termCoverage };
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

  /**
   * Delete a specific term from a policy's terms JSON array.
   * Removes junction rows, nullifies expense FKs, and clears vehicle references for the term.
   */
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

        const policy = existing[0];
        const currentTerms = (policy.terms ?? []) as PolicyTerm[];
        const termIndex = currentTerms.findIndex((t) => t.id === termId);
        if (termIndex === -1) {
          throw new NotFoundError('Term');
        }

        // Get vehicle IDs for this term before removing junction rows
        const termVehicleRows = await tx
          .select({ vehicleId: insurancePolicyVehicles.vehicleId })
          .from(insurancePolicyVehicles)
          .where(
            and(
              eq(insurancePolicyVehicles.policyId, policyId),
              eq(insurancePolicyVehicles.termId, termId)
            )
          );
        const termVehicleIds = termVehicleRows.map((r) => r.vehicleId);

        // Remove the term from the array
        const updatedTerms = currentTerms.filter((t) => t.id !== termId);
        const { currentTermStart, currentTermEnd } = syncDenormalizedFields(updatedTerms);

        // Update policy
        const updatedResult = await tx
          .update(insurancePolicies)
          .set({
            terms: updatedTerms,
            currentTermStart,
            currentTermEnd,
            updatedAt: new Date(),
          })
          .where(eq(insurancePolicies.id, policyId))
          .returning();

        // Delete junction rows for this term
        await tx
          .delete(insurancePolicyVehicles)
          .where(
            and(
              eq(insurancePolicyVehicles.policyId, policyId),
              eq(insurancePolicyVehicles.termId, termId)
            )
          );

        // Nullify expense FK references for this term
        await tx
          .update(expenses)
          .set({
            insurancePolicyId: null,
            insuranceTermId: null,
            updatedAt: new Date(),
          })
          .where(
            and(eq(expenses.insurancePolicyId, policyId), eq(expenses.insuranceTermId, termId))
          );

        // Delete expense groups for this term
        await tx
          .delete(expenseGroups)
          .where(
            and(
              eq(expenseGroups.insurancePolicyId, policyId),
              eq(expenseGroups.insuranceTermId, termId)
            )
          );

        // Clear vehicle references if no longer covered by other terms
        await this.clearRemovedVehicleRefs(tx, policyId, termVehicleIds, []);

        const termCoverage = await this.getTermVehicleCoverage(tx, policyId);
        const vehicleIds = getLatestTermVehicleIds(updatedTerms, termCoverage);
        return { ...updatedResult[0], vehicleIds, termVehicleCoverage: termCoverage };
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

  /**
   * Delete a policy. Clears currentInsurancePolicyId on vehicles and nullifies expense FKs.
   * Junction rows are cascade-deleted by the DB.
   */
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

        // Get vehicle IDs before deletion (junction will be cascade-deleted)
        const vehicleIds = await this.getVehicleIdsForPolicy(tx, id);

        // Clear currentInsurancePolicyId on vehicles that reference this policy
        if (vehicleIds.length > 0) {
          await tx
            .update(vehicles)
            .set({ currentInsurancePolicyId: null, updatedAt: new Date() })
            .where(
              and(inArray(vehicles.id, vehicleIds), eq(vehicles.currentInsurancePolicyId, id))
            );
        }

        // Nullify expense FK references (preserve expenses)
        await tx
          .update(expenses)
          .set({
            insurancePolicyId: null,
            insuranceTermId: null,
            updatedAt: new Date(),
          })
          .where(eq(expenses.insurancePolicyId, id));

        // Delete the policy (junction rows cascade)
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

  /**
   * Find active policies where currentTermEnd is within N days from now.
   */
  async findExpiringPolicies(
    userId: string,
    daysFromNow: number
  ): Promise<InsurancePolicyWithVehicles[]> {
    try {
      const now = new Date();
      const expirationDate = new Date();
      expirationDate.setDate(expirationDate.getDate() + daysFromNow);

      const result = await this.db
        .select({ policy: insurancePolicies })
        .from(insurancePolicies)
        .innerJoin(
          insurancePolicyVehicles,
          eq(insurancePolicies.id, insurancePolicyVehicles.policyId)
        )
        .innerJoin(vehicles, eq(insurancePolicyVehicles.vehicleId, vehicles.id))
        .where(
          and(
            eq(vehicles.userId, userId),
            eq(insurancePolicies.isActive, true),
            gte(insurancePolicies.currentTermEnd, now),
            lte(insurancePolicies.currentTermEnd, expirationDate)
          )
        )
        .groupBy(insurancePolicies.id)
        .orderBy(insurancePolicies.currentTermEnd);

      const policies = result.map((r) => r.policy);
      return Promise.all(policies.map((p) => this.attachVehicleIds(p)));
    } catch (error) {
      logger.error('Error finding expiring insurance policies', { error });
      throw new DatabaseError('Failed to find expiring insurance policies', error);
    }
  }
}

// Export singleton instance
export const insurancePolicyRepository = new InsurancePolicyRepository(getDb());
