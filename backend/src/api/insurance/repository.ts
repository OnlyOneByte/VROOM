import { createId } from '@paralleldrive/cuid2';
import { and, desc, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import { type AsyncAppDatabase, openAsyncDatabase } from '../../db/async-sqlite';
import type { AppDatabase } from '../../db/connection';
import type { InsurancePolicy, InsuranceTerm } from '../../db/schema';
import {
  insurancePolicies,
  insuranceTerms,
  insuranceTermVehicleSelectionOrder,
  insuranceTermVehicles,
  nextInsuranceTermVehiclePosition,
} from '../../db/schema';
import type { DrizzleTransaction } from '../../db/types';
import { DatabaseError, NotFoundError, ValidationError } from '../../errors';
import { chunk } from '../../utils/chunk';
import { logger } from '../../utils/logger';
import { requireVehiclesAccess } from '../../utils/vehicle-access';

interface CreateTermInput {
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

export type MonthlyPricedTerm = InsuranceTerm & { userId: string };

interface UpdateTermInput {
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

interface CreatePolicyData {
  company: string;
  terms: CreateTermInput[];
  notes?: string;
  isActive?: boolean;
}

interface UpdatePolicyData {
  company?: string;
  notes?: string | null;
  isActive?: boolean;
}

export interface TermCoverageRow {
  termId: string;
  vehicleId: string;
}

type PolicyCoverage = {
  terms: InsuranceTerm[];
  termVehicleCoverage: TermCoverageRow[];
  vehicleIds: string[];
};

type InsurancePolicyWithVehicles = InsurancePolicy & PolicyCoverage;

// Owner-scoped lookups keep writes safe even if a caller skips the route ownership check.
function ownedPolicy(policyId: string, userId: string) {
  return and(eq(insurancePolicies.id, policyId), eq(insurancePolicies.userId, userId));
}

export class InsurancePolicyRepository {
  private db: AsyncAppDatabase;

  constructor(private syncDb: AppDatabase) {
    this.db = openAsyncDatabase(syncDb.$client).db;
  }

  // bun:sqlite: an async transaction callback autocommits each write, which could leave partial coverage.
  private insertJunctionRowsSync(
    tx: DrizzleTransaction,
    termId: string,
    vehicleIds: string[]
  ): void {
    for (const vehicleId of vehicleIds) {
      tx.insert(insuranceTermVehicles)
        .values({ termId, vehicleId, position: nextInsuranceTermVehiclePosition })
        .run();
    }
  }

  private async fetchTermsAndCoverageByPolicy(
    handle: AsyncAppDatabase,
    policyIds: string[]
  ): Promise<Map<string, PolicyCoverage>> {
    const terms: InsuranceTerm[] = [];
    for (const ids of chunk(policyIds)) {
      terms.push(
        ...(await handle
          .select()
          .from(insuranceTerms)
          .where(inArray(insuranceTerms.policyId, ids))
          .orderBy(desc(insuranceTerms.endDate)))
      );
    }

    const coverageByTerm = new Map<string, TermCoverageRow[]>();
    for (const ids of chunk(terms.map((t) => t.id))) {
      const rows = await handle
        .select({
          termId: insuranceTermVehicles.termId,
          vehicleId: insuranceTermVehicles.vehicleId,
        })
        .from(insuranceTermVehicles)
        .where(inArray(insuranceTermVehicles.termId, ids))
        .orderBy(insuranceTermVehicleSelectionOrder);
      for (const row of rows) {
        coverageByTerm.set(row.termId, [...(coverageByTerm.get(row.termId) ?? []), row]);
      }
    }

    const byPolicy = new Map<string, PolicyCoverage>(
      policyIds.map((id) => [id, { terms: [], termVehicleCoverage: [], vehicleIds: [] }])
    );
    for (const term of terms) {
      const coverage = byPolicy.get(term.policyId);
      if (!coverage) continue;
      coverage.terms.push(term);
      coverage.termVehicleCoverage.push(...(coverageByTerm.get(term.id) ?? []));
    }
    for (const coverage of byPolicy.values()) {
      coverage.vehicleIds = [...new Set(coverage.termVehicleCoverage.map((tc) => tc.vehicleId))];
    }
    return byPolicy;
  }

  private async fetchTermsAndCoverage(
    handle: AsyncAppDatabase,
    policyId: string
  ): Promise<PolicyCoverage> {
    const byPolicy = await this.fetchTermsAndCoverageByPolicy(handle, [policyId]);
    return byPolicy.get(policyId) ?? { terms: [], termVehicleCoverage: [], vehicleIds: [] };
  }

  private async attachTermsAndCoverage(
    policies: InsurancePolicy[]
  ): Promise<InsurancePolicyWithVehicles[]> {
    if (policies.length === 0) return [];
    const byPolicy = await this.fetchTermsAndCoverageByPolicy(
      this.db,
      policies.map((p) => p.id)
    );
    return policies.map((policy) => ({
      ...policy,
      ...(byPolicy.get(policy.id) ?? { terms: [], termVehicleCoverage: [], vehicleIds: [] }),
    }));
  }

  async create(data: CreatePolicyData, userId: string): Promise<InsurancePolicyWithVehicles> {
    try {
      const allVehicleIds = [...new Set(data.terms.flatMap((t) => t.vehicleCoverage.vehicleIds))];
      await requireVehiclesAccess(allVehicleIds, userId, 'owner', this.syncDb);

      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Policy creation requires sequential steps within a transaction
      return this.syncDb.transaction((tx) => {
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
      throw new DatabaseError('Failed to create insurance policy');
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

    const coverage = await this.fetchTermsAndCoverage(this.db, policy.id);
    return { ...policy, ...coverage };
  }

  async findByUserId(userId: string): Promise<InsurancePolicyWithVehicles[]> {
    try {
      const policies = await this.db
        .select()
        .from(insurancePolicies)
        .where(eq(insurancePolicies.userId, userId));

      return this.attachTermsAndCoverage(policies);
    } catch (error) {
      logger.error('Error finding insurance policies for user', { error });
      throw new DatabaseError('Failed to find insurance policies for user');
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
      return this.attachTermsAndCoverage(policies);
    } catch (error) {
      logger.error('Error finding insurance policies for vehicle', { vehicleId, error });
      throw new DatabaseError('Failed to find insurance policies for vehicle');
    }
  }

  async update(
    id: string,
    data: UpdatePolicyData,
    userId: string
  ): Promise<InsurancePolicyWithVehicles> {
    try {
      const updated = await this.syncDb.transaction(async (tx) => {
        const existing = await tx
          .select()
          .from(insurancePolicies)
          .where(ownedPolicy(id, userId))
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
          .where(ownedPolicy(id, userId))
          .returning();

        return updatedResult[0];
      });
      const coverage = await this.fetchTermsAndCoverage(this.db, id);
      return { ...updated, ...coverage };
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      logger.error('Failed to update insurance policy', {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to update insurance policy');
    }
  }

  async delete(id: string, userId: string): Promise<void> {
    try {
      await this.syncDb.transaction(async (tx) => {
        const existing = await tx
          .select()
          .from(insurancePolicies)
          .where(ownedPolicy(id, userId))
          .limit(1);

        if (existing.length === 0) {
          throw new NotFoundError('Insurance policy');
        }

        await tx.delete(insurancePolicies).where(ownedPolicy(id, userId));
      });
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      logger.error('Failed to delete insurance policy', {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to delete insurance policy');
    }
  }

  async addTerm(
    policyId: string,
    term: CreateTermInput,
    userId: string
  ): Promise<InsurancePolicyWithVehicles & { newTermId: string }> {
    try {
      await requireVehiclesAccess(term.vehicleCoverage.vehicleIds, userId, 'owner', this.syncDb);

      const termId = createId();
      this.syncDb.transaction((tx) => {
        const existing = tx
          .select()
          .from(insurancePolicies)
          .where(ownedPolicy(policyId, userId))
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
      throw new DatabaseError('Failed to add term to insurance policy');
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
        await requireVehiclesAccess(vehicleCoverage.vehicleIds, userId, 'owner', this.syncDb);
      }

      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Term update requires field-by-field mapping and junction management
      this.syncDb.transaction((tx) => {
        const existing = tx
          .select()
          .from(insurancePolicies)
          .where(ownedPolicy(policyId, userId))
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

        const storedTerm = termRows[0];
        if (!storedTerm) {
          throw new NotFoundError('Term');
        }

        const nextStartDate = termFields.startDate ?? storedTerm.startDate;
        const nextEndDate = termFields.endDate ?? storedTerm.endDate;
        if (nextEndDate <= nextStartDate) {
          throw new ValidationError('End date must be after start date');
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
      if (error instanceof NotFoundError || error instanceof ValidationError) throw error;
      logger.error('Failed to update term in insurance policy', {
        policyId,
        termId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to update term in insurance policy');
    }
  }

  async deleteTerm(
    policyId: string,
    termId: string,
    userId: string
  ): Promise<InsurancePolicyWithVehicles> {
    try {
      const updatedPolicy = await this.syncDb.transaction(async (tx) => {
        const existing = await tx
          .select()
          .from(insurancePolicies)
          .where(ownedPolicy(policyId, userId))
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

        await tx.delete(insuranceTerms).where(eq(insuranceTerms.id, termId));

        await tx
          .update(insurancePolicies)
          .set({ updatedAt: new Date() })
          .where(eq(insurancePolicies.id, policyId));

        const [policy] = await tx
          .select()
          .from(insurancePolicies)
          .where(eq(insurancePolicies.id, policyId))
          .limit(1);
        return policy;
      });
      const coverage = await this.fetchTermsAndCoverage(this.db, policyId);
      return { ...updatedPolicy, ...coverage };
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      logger.error('Failed to delete term from insurance policy', {
        policyId,
        termId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to delete term from insurance policy');
    }
  }

  async findMonthlyPricedTerms(): Promise<MonthlyPricedTerm[]> {
    const rows = await this.db
      .select({ term: insuranceTerms, userId: insurancePolicies.userId })
      .from(insuranceTerms)
      .innerJoin(insurancePolicies, eq(insuranceTerms.policyId, insurancePolicies.id))
      .where(
        and(
          gt(insuranceTerms.monthlyCost, 0),
          or(isNull(insuranceTerms.totalCost), eq(insuranceTerms.totalCost, 0))
        )
      );
    return rows.map((r) => ({ ...r.term, userId: r.userId }));
  }
}
