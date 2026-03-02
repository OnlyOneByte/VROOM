import { createId } from '@paralleldrive/cuid2';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { getDb } from '../../db/connection';
import type { Expense, InsurancePolicy, NewExpense, PolicyTerm } from '../../db/schema';
import { expenses, insurancePolicies, insurancePolicyVehicles, vehicles } from '../../db/schema';
import { DatabaseError, NotFoundError } from '../../errors';
import { logger } from '../../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface CreatePolicyData {
  company: string;
  vehicleIds: string[];
  terms: PolicyTerm[];
  notes?: string;
  isActive?: boolean;
}

export interface UpdatePolicyData {
  company?: string;
  vehicleIds?: string[];
  notes?: string;
  isActive?: boolean;
}

// Policy with vehicleIds attached (returned from queries)
export type InsurancePolicyWithVehicles = InsurancePolicy & { vehicleIds: string[] };

// ============================================================================
// Helpers
// ============================================================================

/**
 * Find the latest term by endDate and sync currentTermStart/currentTermEnd.
 * Returns { currentTermStart, currentTermEnd } from the term with the max endDate.
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
   * If isActive, set the reference. If not active, clear it.
   */
  private async syncVehicleReferences(
    tx: BunSQLiteDatabase<Record<string, unknown>>,
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
      // Clear reference only on vehicles that currently point to this policy
      await tx
        .update(vehicles)
        .set({ currentInsurancePolicyId: null, updatedAt: new Date() })
        .where(
          and(inArray(vehicles.id, vehicleIds), eq(vehicles.currentInsurancePolicyId, policyId))
        );
    }
  }

  /**
   * Create an expense record for a term if financeDetails.totalCost is defined.
   * Uses the first vehicleId from the policy's vehicle associations.
   */
  private async createExpenseForTerm(
    tx: BunSQLiteDatabase<Record<string, unknown>>,
    policyId: string,
    company: string,
    vehicleIds: string[],
    term: PolicyTerm,
    _userId: string
  ): Promise<Expense | null> {
    if (term.financeDetails?.totalCost == null) {
      return null;
    }

    const firstVehicleId = vehicleIds[0];
    if (!firstVehicleId) {
      return null;
    }

    const expenseData: NewExpense = {
      id: createId(),
      vehicleId: firstVehicleId,
      category: 'financial',
      tags: ['insurance'],
      date: new Date(term.startDate),
      description: `Insurance: ${company} (${term.startDate} to ${term.endDate})`,
      expenseAmount: term.financeDetails.totalCost,
      insurancePolicyId: policyId,
      insuranceTermId: term.id,
    };

    const result = await tx.insert(expenses).values(expenseData).returning();
    return result[0];
  }

  /**
   * Get vehicleIds for a policy from the junction table.
   */
  private async getVehicleIdsForPolicy(
    db: BunSQLiteDatabase<Record<string, unknown>>,
    policyId: string
  ): Promise<string[]> {
    const rows = await db
      .select({ vehicleId: insurancePolicyVehicles.vehicleId })
      .from(insurancePolicyVehicles)
      .where(eq(insurancePolicyVehicles.policyId, policyId));
    return rows.map((r) => r.vehicleId);
  }

  /**
   * Public accessor for vehicle IDs linked to a policy.
   */
  async getVehicleIds(policyId: string): Promise<string[]> {
    return this.getVehicleIdsForPolicy(this.db, policyId);
  }

  /**
   * Validate that all vehicleIds belong to the given userId.
   * Throws NotFoundError if any vehicle is not found or not owned.
   */
  private async validateVehicleOwnership(
    db: BunSQLiteDatabase<Record<string, unknown>>,
    vehicleIds: string[],
    userId: string
  ): Promise<void> {
    if (vehicleIds.length === 0) return;

    const ownedVehicles = await db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(and(inArray(vehicles.id, vehicleIds), eq(vehicles.userId, userId)));

    if (ownedVehicles.length !== vehicleIds.length) {
      throw new NotFoundError('Vehicle');
    }
  }

  /**
   * Attach vehicleIds to a policy result.
   */
  private async attachVehicleIds(policy: InsurancePolicy): Promise<InsurancePolicyWithVehicles> {
    const vehicleIds = await this.getVehicleIdsForPolicy(this.db, policy.id);
    return { ...policy, vehicleIds };
  }

  /**
   * Re-sync junction rows for a policy's vehicle associations.
   * Returns the new set of vehicle IDs and clears references on removed vehicles.
   */
  private async resyncVehicleJunction(
    tx: Parameters<Parameters<BunSQLiteDatabase<Record<string, unknown>>['transaction']>[0]>[0],
    policyId: string,
    newVehicleIds: string[],
    userId: string
  ): Promise<string[]> {
    await this.validateVehicleOwnership(tx, newVehicleIds, userId);

    const oldVehicleIds = await this.getVehicleIdsForPolicy(tx, policyId);

    await tx.delete(insurancePolicyVehicles).where(eq(insurancePolicyVehicles.policyId, policyId));

    for (const vehicleId of newVehicleIds) {
      await tx.insert(insurancePolicyVehicles).values({ policyId, vehicleId });
    }

    const removedVehicleIds = oldVehicleIds.filter((vid) => !newVehicleIds.includes(vid));
    if (removedVehicleIds.length > 0) {
      await tx
        .update(vehicles)
        .set({ currentInsurancePolicyId: null, updatedAt: new Date() })
        .where(
          and(
            inArray(vehicles.id, removedVehicleIds),
            eq(vehicles.currentInsurancePolicyId, policyId)
          )
        );
    }

    return newVehicleIds;
  }

  // --------------------------------------------------------------------------
  // CRUD Methods
  // --------------------------------------------------------------------------

  /**
   * Create a policy with junction rows, denormalized field sync, vehicle references, and expense auto-generation.
   * All operations run in a single transaction.
   */
  async create(data: CreatePolicyData, userId: string): Promise<InsurancePolicyWithVehicles> {
    try {
      return await this.db.transaction(async (tx) => {
        // 1. Validate vehicle ownership
        await this.validateVehicleOwnership(tx, data.vehicleIds, userId);

        // 2. Compute denormalized fields from terms
        const { currentTermStart, currentTermEnd } = syncDenormalizedFields(data.terms);

        // 3. Insert policy row
        const policyId = createId();
        const now = new Date();
        const isActive = data.isActive !== false; // default true

        const policyResult = await tx
          .insert(insurancePolicies)
          .values({
            id: policyId,
            company: data.company,
            isActive,
            currentTermStart,
            currentTermEnd,
            terms: data.terms,
            notes: data.notes ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        const policy = policyResult[0];

        // 4. Insert junction rows
        for (const vehicleId of data.vehicleIds) {
          await tx.insert(insurancePolicyVehicles).values({ policyId, vehicleId });
        }

        // 5. Sync vehicle references if active
        await this.syncVehicleReferences(tx, policyId, data.vehicleIds, isActive);

        // 6. Create expenses for terms with totalCost
        for (const term of data.terms) {
          await this.createExpenseForTerm(
            tx,
            policyId,
            data.company,
            data.vehicleIds,
            term,
            userId
          );
        }

        return { ...policy, vehicleIds: data.vehicleIds };
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
   * Find a single policy by ID with parsed terms and vehicleIds.
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
   * Uses GROUP BY to deduplicate policies shared across multiple vehicles.
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
   * Determine whether vehicle references need syncing and apply.
   */
  private async syncRefsForActiveChange(
    tx: Parameters<Parameters<BunSQLiteDatabase<Record<string, unknown>>['transaction']>[0]>[0],
    policyId: string,
    vehicleIds: string[],
    isActive: boolean,
    wasActive: boolean,
    vehicleIdsChanged: boolean
  ): Promise<void> {
    if (isActive && (!wasActive || vehicleIdsChanged)) {
      await this.syncVehicleReferences(tx, policyId, vehicleIds, true);
    } else if (!isActive && wasActive) {
      await this.syncVehicleReferences(tx, policyId, vehicleIds, false);
    }
  }

  /**
   * Update a policy. Optionally re-sync vehicle associations and denormalized fields.
   */
  async update(
    id: string,
    data: UpdatePolicyData,
    userId: string
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

        const currentVehicleIds = data.vehicleIds
          ? await this.resyncVehicleJunction(tx, id, data.vehicleIds, userId)
          : await this.getVehicleIdsForPolicy(tx, id);

        const updatedResult = await tx
          .update(insurancePolicies)
          .set(this.buildUpdateFields(data))
          .where(eq(insurancePolicies.id, id))
          .returning();

        await this.syncRefsForActiveChange(
          tx,
          id,
          currentVehicleIds,
          data.isActive ?? policy.isActive,
          policy.isActive,
          !!data.vehicleIds
        );

        return { ...updatedResult[0], vehicleIds: currentVehicleIds };
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
   * Append a term to the policy's terms JSON array.
   * Syncs denormalized columns and creates expense if totalCost is present.
   */
  async addTerm(
    policyId: string,
    term: PolicyTerm,
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
        const updatedTerms = [...currentTerms, term];

        // 2. Sync denormalized fields
        const { currentTermStart, currentTermEnd } = syncDenormalizedFields(updatedTerms);

        // 3. Update policy
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

        const updatedPolicy = updatedResult[0];

        // 4. Get vehicle IDs for expense creation
        const vehicleIds = await this.getVehicleIdsForPolicy(tx, policyId);

        // 5. Create expense if totalCost is defined
        await this.createExpenseForTerm(tx, policyId, policy.company, vehicleIds, term, userId);

        return { ...updatedPolicy, vehicleIds };
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

  /**
   * Update a specific term in the policy's terms JSON array by termId.
   * Re-syncs denormalized columns.
   */
  async updateTerm(
    policyId: string,
    termId: string,
    termData: Partial<PolicyTerm>,
    _userId: string
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

        const updatedTerms = [...currentTerms];
        updatedTerms[termIndex] = {
          ...currentTerms[termIndex],
          ...termData,
          id: termId, // Preserve the original term ID
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

        const updatedPolicy = updatedResult[0];
        const vehicleIds = await this.getVehicleIdsForPolicy(tx, policyId);

        return { ...updatedPolicy, vehicleIds };
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
   * Delete a policy. Clears currentInsurancePolicyId on vehicles and nullifies expense FKs.
   * Junction rows are cascade-deleted by the DB.
   */
  async delete(id: string, _userId: string): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        // 1. Fetch existing policy to verify it exists
        const existing = await tx
          .select()
          .from(insurancePolicies)
          .where(eq(insurancePolicies.id, id))
          .limit(1);

        if (existing.length === 0) {
          throw new NotFoundError('Insurance policy');
        }

        // 2. Get vehicle IDs before deletion (junction will be cascade-deleted)
        const vehicleIds = await this.getVehicleIdsForPolicy(tx, id);

        // 3. Clear currentInsurancePolicyId on vehicles that reference this policy
        if (vehicleIds.length > 0) {
          await tx
            .update(vehicles)
            .set({ currentInsurancePolicyId: null, updatedAt: new Date() })
            .where(
              and(inArray(vehicles.id, vehicleIds), eq(vehicles.currentInsurancePolicyId, id))
            );
        }

        // 4. Nullify expense FK references (preserve expenses)
        await tx
          .update(expenses)
          .set({
            insurancePolicyId: null,
            insuranceTermId: null,
            updatedAt: new Date(),
          })
          .where(eq(expenses.insurancePolicyId, id));

        // 5. Delete the policy (junction rows cascade)
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
