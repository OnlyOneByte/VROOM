/**
 * Property-Based Tests for Insurance Repository
 *
 * Tests Properties 1, 2, 3, 5, 6, 7, 10, 11, 12, 13, 14, 15, 16, 17 against a real in-memory
 * SQLite database with all migrations applied.
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.6, 1.12, 1.13, 1.15, 5.1–5.6, 6.2, 7.2, 7.3, 8.1, 8.3, 8.4, 9.2**
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import fc from 'fast-check';
import { applyMigration, loadMigrations } from '../../../db/__tests__/migration-helpers';
import type { PolicyTerm } from '../../../db/schema';
import { expenseGroups, expenses, insurancePolicyVehicles, vehicles } from '../../../db/schema';
import type { CreatePolicyData, TermVehicleCoverage } from '../repository';
import { InsurancePolicyRepository } from '../repository';
import {
  companyNameArb,
  validTermArb,
  validTermWithoutTotalCostArb,
  validTermWithTotalCostArb,
} from './insurance-test-generators';

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

let sqliteDb: Database;
let db: BunSQLiteDatabase<Record<string, unknown>>;
let repo: InsurancePolicyRepository;

const USER_ID = 'test-user-1';
const OTHER_USER_ID = 'test-user-2';
const VEHICLE_IDS = ['v-1', 'v-2', 'v-3'];
const OTHER_VEHICLE_IDS = ['v-other-1', 'v-other-2'];

function seedTestData(): void {
  sqliteDb.run(
    `INSERT INTO users (id, email, display_name, provider, provider_id) VALUES ('${USER_ID}', 'user1@test.com', 'User One', 'google', 'gid-1')`
  );
  sqliteDb.run(
    `INSERT INTO users (id, email, display_name, provider, provider_id) VALUES ('${OTHER_USER_ID}', 'user2@test.com', 'User Two', 'google', 'gid-2')`
  );
  for (const vid of VEHICLE_IDS) {
    sqliteDb.run(
      `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('${vid}', '${USER_ID}', 'Toyota', 'Camry', 2022)`
    );
  }
  for (const vid of OTHER_VEHICLE_IDS) {
    sqliteDb.run(
      `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('${vid}', '${OTHER_USER_ID}', 'Honda', 'Civic', 2023)`
    );
  }
}

beforeEach(() => {
  sqliteDb = new Database(':memory:');
  sqliteDb.run('PRAGMA foreign_keys = ON');
  const migrations = loadMigrations();
  for (const m of migrations) {
    applyMigration(sqliteDb, m);
  }
  db = drizzle(sqliteDb);
  repo = new InsurancePolicyRepository(db);
  seedTestData();
});

afterEach(() => {
  sqliteDb.close();
});

// ---------------------------------------------------------------------------
// Generators scoped to seeded vehicle IDs
// ---------------------------------------------------------------------------

/** Pick 1–3 vehicle IDs from the user's vehicles. */
const userVehicleIdsArb = fc
  .subarray(VEHICLE_IDS, { minLength: 1, maxLength: VEHICLE_IDS.length })
  .filter((arr) => arr.length > 0);

/** Build a TermVehicleCoverage from vehicle IDs (even split). */
function coverageFor(vehicleIds: string[]): TermVehicleCoverage {
  return { vehicleIds };
}

/** Generate a valid CreatePolicyData using seeded vehicle IDs. */
const validCreatePolicyArb = fc
  .record({
    company: companyNameArb,
    vehicleIds: userVehicleIdsArb,
    terms: fc.array(validTermArb, { minLength: 1, maxLength: 3 }),
    notes: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
    isActive: fc.boolean(),
  })
  .map(({ vehicleIds, terms, ...rest }) => ({
    ...rest,
    terms: terms.map((t, i) => ({
      ...t,
      id: `${t.id}-${i}`,
      vehicleCoverage: coverageFor(vehicleIds),
    })),
    _vehicleIds: vehicleIds, // keep for assertions
  }));

// ===========================================================================
// Property 1: Policy creation round-trip
// Feature: insurance-management, Property 1: Policy creation round-trip
// ===========================================================================
describe('Property 1: Policy creation round-trip', () => {
  test('creating and retrieving a policy returns matching fields and deserialized terms', async () => {
    await fc.assert(
      fc.asyncProperty(validCreatePolicyArb, async (input) => {
        const created = await repo.create(input, USER_ID);
        const retrieved = await repo.findById(created.id);

        expect(retrieved).not.toBeNull();
        expect(retrieved?.company).toBe(input.company);
        expect(retrieved?.isActive).toBe(input.isActive !== false);
        expect(retrieved?.notes).toBe(input.notes ?? null);

        // Terms round-trip: same length and matching IDs
        const retrievedTerms = retrieved?.terms as PolicyTerm[];
        expect(retrievedTerms.length).toBe(input.terms.length);
        for (let i = 0; i < input.terms.length; i++) {
          expect(retrievedTerms[i].id).toBe(input.terms[i].id);
          expect(retrievedTerms[i].startDate).toBe(input.terms[i].startDate);
          expect(retrievedTerms[i].endDate).toBe(input.terms[i].endDate);
        }

        // vehicleIds match
        expect(new Set(retrieved?.vehicleIds)).toEqual(new Set(input._vehicleIds));
      }),
      { numRuns: 100 }
    );
  });
});

// ===========================================================================
// Property 2: Junction table integrity
// Feature: insurance-management, Property 2: Junction table integrity
// ===========================================================================
describe('Property 2: Junction table integrity', () => {
  test('junction table has exactly N rows matching the input vehicle IDs', async () => {
    await fc.assert(
      fc.asyncProperty(validCreatePolicyArb, async (input) => {
        const created = await repo.create(input, USER_ID);

        const junctionRows = await db
          .select()
          .from(insurancePolicyVehicles)
          .where(eq(insurancePolicyVehicles.policyId, created.id));

        // Each term has the same vehicleIds, so total rows = terms * vehicleIds
        const expectedRows = input.terms.length * input._vehicleIds.length;
        expect(junctionRows.length).toBe(expectedRows);
        const junctionVehicleIds = new Set(junctionRows.map((r) => r.vehicleId));
        expect(junctionVehicleIds).toEqual(new Set(input._vehicleIds));
      }),
      { numRuns: 100 }
    );
  });
});

// ===========================================================================
// Property 3: Vehicle ownership validation
// Feature: insurance-management, Property 3: Vehicle ownership validation
// ===========================================================================
describe('Property 3: Vehicle ownership validation', () => {
  test('rejects policy creation with vehicles not owned by the user', async () => {
    await fc.assert(
      fc.asyncProperty(
        companyNameArb,
        fc.subarray(OTHER_VEHICLE_IDS, { minLength: 1, maxLength: OTHER_VEHICLE_IDS.length }),
        fc.array(validTermArb, { minLength: 1, maxLength: 2 }),
        async (company, otherVehicleIds, terms) => {
          if (otherVehicleIds.length === 0) return;

          const input: CreatePolicyData = {
            company,
            terms: terms.map((t) => ({ ...t, vehicleCoverage: coverageFor(otherVehicleIds) })),
            isActive: true,
          };

          // Count policies before
          const beforeRows = sqliteDb
            .query('SELECT COUNT(*) as count FROM insurance_policies')
            .get() as { count: number };

          let threw = false;
          try {
            await repo.create(input, USER_ID);
          } catch {
            threw = true;
          }

          expect(threw).toBe(true);

          // DB unchanged
          const afterRows = sqliteDb
            .query('SELECT COUNT(*) as count FROM insurance_policies')
            .get() as { count: number };
          expect(afterRows.count).toBe(beforeRows.count);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ===========================================================================
// Property 5: Denormalized field sync invariant
// Feature: insurance-management, Property 5: Denormalized field sync invariant
// ===========================================================================
describe('Property 5: Denormalized field sync invariant', () => {
  test('after term additions, currentTermEnd equals max endDate and currentTermStart equals that terms startDate', async () => {
    await fc.assert(
      fc.asyncProperty(
        companyNameArb,
        userVehicleIdsArb,
        fc.array(validTermArb, { minLength: 1, maxLength: 5 }),
        async (company, vehicleIds, terms) => {
          // Ensure unique term IDs
          const uniqueTerms = terms.map((t, i) => ({ ...t, id: `${t.id}-${i}` }));

          // Create with first term
          const input: CreatePolicyData = {
            company,
            terms: [{ ...uniqueTerms[0], vehicleCoverage: coverageFor(vehicleIds) }],
            isActive: true,
          };
          const created = await repo.create(input, USER_ID);

          // Add remaining terms one by one
          const policyId = created.id;
          for (let i = 1; i < uniqueTerms.length; i++) {
            await repo.addTerm(
              policyId,
              { ...uniqueTerms[i], vehicleCoverage: coverageFor(vehicleIds) },
              USER_ID
            );
          }

          // Retrieve and verify
          const policy = await repo.findById(policyId);
          expect(policy).not.toBeNull();

          const allTerms = policy?.terms as PolicyTerm[];
          expect(allTerms.length).toBe(uniqueTerms.length);

          // Find the term with the max endDate
          let latestTerm = allTerms[0];
          for (const t of allTerms) {
            if (new Date(t.endDate).getTime() > new Date(latestTerm.endDate).getTime()) {
              latestTerm = t;
            }
          }

          // currentTermEnd should match the max endDate
          const currentTermEnd = policy?.currentTermEnd;
          expect(currentTermEnd).not.toBeNull();
          expect(new Date(String(currentTermEnd)).toISOString().split('T')[0]).toBe(
            latestTerm.endDate
          );

          // currentTermStart should match that term's startDate
          const currentTermStart = policy?.currentTermStart;
          expect(currentTermStart).not.toBeNull();
          expect(new Date(String(currentTermStart)).toISOString().split('T')[0]).toBe(
            latestTerm.startDate
          );
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ===========================================================================
// Property 6: Active policy sets vehicle reference
// Feature: insurance-management, Property 6: Active policy sets vehicle reference
// ===========================================================================
describe('Property 6: Active policy sets vehicle reference', () => {
  test('after creating an active policy, each vehicle has currentInsurancePolicyId set', async () => {
    await fc.assert(
      fc.asyncProperty(
        companyNameArb,
        userVehicleIdsArb,
        fc.array(validTermArb, { minLength: 1, maxLength: 2 }),
        async (company, vehicleIds, terms) => {
          const input: CreatePolicyData = {
            company,
            terms: terms.map((t, i) => ({
              ...t,
              id: `${t.id}-${i}`,
              vehicleCoverage: coverageFor(vehicleIds),
            })),
            isActive: true,
          };
          const created = await repo.create(input, USER_ID);

          // Check each vehicle
          for (const vid of vehicleIds) {
            const vehicleRows = await db
              .select({ currentInsurancePolicyId: vehicles.currentInsurancePolicyId })
              .from(vehicles)
              .where(eq(vehicles.id, vid));
            expect(vehicleRows[0].currentInsurancePolicyId).toBe(created.id);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ===========================================================================
// Property 7: Deactivation clears vehicle reference
// Feature: insurance-management, Property 7: Deactivation clears vehicle reference
// ===========================================================================
describe('Property 7: Deactivation clears vehicle reference', () => {
  test('after deleting a policy, vehicles that referenced it have currentInsurancePolicyId null', async () => {
    await fc.assert(
      fc.asyncProperty(
        companyNameArb,
        userVehicleIdsArb,
        fc.array(validTermArb, { minLength: 1, maxLength: 2 }),
        async (company, vehicleIds, terms) => {
          // Create active policy so vehicles get the reference
          const input: CreatePolicyData = {
            company,
            terms: terms.map((t, i) => ({
              ...t,
              id: `${t.id}-${i}`,
              vehicleCoverage: coverageFor(vehicleIds),
            })),
            isActive: true,
          };
          const created = await repo.create(input, USER_ID);

          // Verify references are set
          for (const vid of vehicleIds) {
            const rows = await db
              .select({ ref: vehicles.currentInsurancePolicyId })
              .from(vehicles)
              .where(eq(vehicles.id, vid));
            expect(rows[0].ref).toBe(created.id);
          }

          // Delete the policy
          await repo.delete(created.id, USER_ID);

          // Verify references are cleared
          for (const vid of vehicleIds) {
            const rows = await db
              .select({ ref: vehicles.currentInsurancePolicyId })
              .from(vehicles)
              .where(eq(vehicles.id, vid));
            expect(rows[0].ref).toBeNull();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  test('after deactivating a policy via update, vehicles have currentInsurancePolicyId null', async () => {
    await fc.assert(
      fc.asyncProperty(
        companyNameArb,
        userVehicleIdsArb,
        fc.array(validTermArb, { minLength: 1, maxLength: 2 }),
        async (company, vehicleIds, terms) => {
          // Create active policy
          const created = await repo.create(
            {
              company,
              terms: terms.map((t, i) => ({
                ...t,
                id: `${t.id}-${i}`,
                vehicleCoverage: coverageFor(vehicleIds),
              })),
              isActive: true,
            },
            USER_ID
          );

          // Deactivate via update
          await repo.update(created.id, { isActive: false }, USER_ID);

          // Verify references are cleared
          for (const vid of vehicleIds) {
            const rows = await db
              .select({ ref: vehicles.currentInsurancePolicyId })
              .from(vehicles)
              .where(eq(vehicles.id, vid));
            expect(rows[0].ref).toBeNull();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ===========================================================================
// Property 15: Expense auto-generation on term addition
// Feature: insurance-management, Property 15: Expense auto-generation on term addition
// ===========================================================================
describe('Property 15: Expense auto-generation on term addition', () => {
  test('term with totalCost creates child expenses via expense group with correct fields', async () => {
    await fc.assert(
      fc.asyncProperty(
        companyNameArb,
        userVehicleIdsArb,
        validTermWithTotalCostArb,
        async (company, vehicleIds, term) => {
          // Create policy with a term that has no totalCost first
          const baseTerm = { ...term, id: `base-${term.id}`, financeDetails: {} };
          const created = await repo.create(
            {
              company,
              terms: [{ ...baseTerm, vehicleCoverage: coverageFor(vehicleIds) }],
              isActive: true,
            },
            USER_ID
          );

          // Add term with totalCost
          await repo.addTerm(
            created.id,
            { ...term, vehicleCoverage: coverageFor(vehicleIds) },
            USER_ID
          );

          // Query expenses linked to this policy and term
          const expenseRows = await db
            .select()
            .from(expenses)
            .where(eq(expenses.insurancePolicyId, created.id));

          // Should have one child expense per vehicle for this term
          const newExpenses = expenseRows.filter((e) => e.insuranceTermId === term.id);
          expect(newExpenses.length).toBe(vehicleIds.length);

          // Each child should have correct fields
          for (const expense of newExpenses) {
            expect(expense.category).toBe('financial');
            expect(expense.tags).toContain('insurance');
            expect(expense.insurancePolicyId).toBe(created.id);
            expect(expense.insuranceTermId).toBe(term.id);
            expect(expense.description).toContain(term.startDate);
            expect(expense.description).toContain(term.endDate);
            expect(vehicleIds).toContain(expense.vehicleId);
          }

          // Sum of child amounts should equal totalCost
          const totalChildAmount = newExpenses.reduce((sum, e) => sum + e.expenseAmount, 0);
          expect(Math.round(totalChildAmount * 100) / 100).toBe(term.financeDetails.totalCost);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ===========================================================================
// Property 16: Expense preservation on policy deletion
// Feature: insurance-management, Property 16: Expense preservation on policy deletion
// ===========================================================================
describe('Property 16: Expense preservation on policy deletion', () => {
  test('deleting a policy preserves expenses but nullifies FK references', async () => {
    await fc.assert(
      fc.asyncProperty(
        companyNameArb,
        userVehicleIdsArb,
        validTermWithTotalCostArb,
        async (company, vehicleIds, term) => {
          // Create policy with a term that generates an expense
          const created = await repo.create(
            {
              company,
              terms: [{ ...term, vehicleCoverage: coverageFor(vehicleIds) }],
              isActive: true,
            },
            USER_ID
          );

          // Verify expense exists
          const beforeExpenses = await db
            .select()
            .from(expenses)
            .where(eq(expenses.insurancePolicyId, created.id));
          expect(beforeExpenses.length).toBeGreaterThanOrEqual(1);

          const expenseIds = beforeExpenses.map((e) => e.id);

          // Delete the policy
          await repo.delete(created.id, USER_ID);

          // Verify expenses still exist but FKs are nullified
          for (const expId of expenseIds) {
            const rows = await db.select().from(expenses).where(eq(expenses.id, expId));
            expect(rows.length).toBe(1);
            expect(rows[0].insurancePolicyId).toBeNull();
            expect(rows[0].insuranceTermId).toBeNull();
            // Amount should be preserved
            expect(rows[0].expenseAmount).toBe(
              beforeExpenses.find((e) => e.id === expId)?.expenseAmount ?? 0
            );
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ===========================================================================
// Property 17: No expense for terms without totalCost
// Feature: insurance-management, Property 17: No expense for terms without totalCost
// ===========================================================================
describe('Property 17: No expense for terms without totalCost', () => {
  test('term without totalCost does not create any expense', async () => {
    await fc.assert(
      fc.asyncProperty(
        companyNameArb,
        userVehicleIdsArb,
        validTermWithoutTotalCostArb,
        async (company, vehicleIds, term) => {
          // Create policy with a no-cost base term
          const baseTerm = { ...term, id: `base-${term.id}`, financeDetails: {} };
          const created = await repo.create(
            {
              company,
              terms: [{ ...baseTerm, vehicleCoverage: coverageFor(vehicleIds) }],
              isActive: true,
            },
            USER_ID
          );

          // Count expenses before
          const beforeCount = (
            sqliteDb.query('SELECT COUNT(*) as count FROM expenses').get() as { count: number }
          ).count;

          // Add term without totalCost
          await repo.addTerm(
            created.id,
            { ...term, vehicleCoverage: coverageFor(vehicleIds) },
            USER_ID
          );

          // Count expenses after — should be unchanged
          const afterCount = (
            sqliteDb.query('SELECT COUNT(*) as count FROM expenses').get() as { count: number }
          ).count;

          expect(afterCount).toBe(beforeCount);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ===========================================================================
// Property 10: Term with totalCost creates expense group and children
// Feature: insurance-term-vehicle-coverage, Property 10
// **Validates: Requirements 7.3, 8.1**
// ===========================================================================
describe('Property 10: Term with totalCost creates expense group and children', () => {
  test('creating/adding a term with totalCost results in an expense group with matching totalAmount and children summing to totalCost', async () => {
    await fc.assert(
      fc.asyncProperty(
        companyNameArb,
        userVehicleIdsArb,
        validTermWithTotalCostArb,
        fc.boolean(),
        async (company, vehicleIds, term, useAddTerm) => {
          if (useAddTerm) {
            // Test via addTerm: create policy with a no-cost base term, then add the costed term
            const baseTerm = { ...term, id: `base-${term.id}`, financeDetails: {} };
            const created = await repo.create(
              {
                company,
                terms: [{ ...baseTerm, vehicleCoverage: coverageFor(vehicleIds) }],
                isActive: true,
              },
              USER_ID
            );
            await repo.addTerm(
              created.id,
              { ...term, vehicleCoverage: coverageFor(vehicleIds) },
              USER_ID
            );

            // Verify expense group exists for this term
            const groups = await db
              .select()
              .from(expenseGroups)
              .where(
                and(
                  eq(expenseGroups.insurancePolicyId, created.id),
                  eq(expenseGroups.insuranceTermId, term.id)
                )
              );
            expect(groups.length).toBe(1);
            expect(groups[0].totalAmount).toBe(term.financeDetails.totalCost);

            // Verify children sum to totalCost
            const children = await db
              .select()
              .from(expenses)
              .where(eq(expenses.expenseGroupId, groups[0].id));
            expect(children.length).toBe(vehicleIds.length);
            const childSum =
              Math.round(children.reduce((s, e) => s + e.expenseAmount, 0) * 100) / 100;
            expect(childSum).toBe(term.financeDetails.totalCost);
          } else {
            // Test via create: policy with the costed term directly
            const created = await repo.create(
              {
                company,
                terms: [{ ...term, vehicleCoverage: coverageFor(vehicleIds) }],
                isActive: true,
              },
              USER_ID
            );

            const groups = await db
              .select()
              .from(expenseGroups)
              .where(
                and(
                  eq(expenseGroups.insurancePolicyId, created.id),
                  eq(expenseGroups.insuranceTermId, term.id)
                )
              );
            expect(groups.length).toBe(1);
            expect(groups[0].totalAmount).toBe(term.financeDetails.totalCost);

            const children = await db
              .select()
              .from(expenses)
              .where(eq(expenses.expenseGroupId, groups[0].id));
            expect(children.length).toBe(vehicleIds.length);
            const childSum =
              Math.round(children.reduce((s, e) => s + e.expenseAmount, 0) * 100) / 100;
            expect(childSum).toBe(term.financeDetails.totalCost);
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ===========================================================================
// Property 11: Junction row correctness on policy create
// Feature: insurance-term-vehicle-coverage, Property 11
// **Validates: Requirement 7.2**
// ===========================================================================
describe('Property 11: Junction row correctness on policy create', () => {
  test('junction table has exactly sum(V_i) rows with correct (policyId, termId, vehicleId) triples', async () => {
    await fc.assert(
      fc.asyncProperty(
        companyNameArb,
        fc.array(
          fc.record({
            term: validTermArb,
            vehicleIds: userVehicleIdsArb,
          }),
          { minLength: 1, maxLength: 3 }
        ),
        async (company, termSpecs) => {
          // Ensure unique term IDs
          const termsWithCoverage = termSpecs.map((spec, i) => ({
            ...spec.term,
            id: `${spec.term.id}-${i}`,
            vehicleCoverage: coverageFor(spec.vehicleIds),
          }));

          const created = await repo.create(
            { company, terms: termsWithCoverage, isActive: true },
            USER_ID
          );

          const junctionRows = await db
            .select()
            .from(insurancePolicyVehicles)
            .where(eq(insurancePolicyVehicles.policyId, created.id));

          // Expected total rows = sum of vehicle counts per term
          const expectedTotal = termSpecs.reduce((sum, spec) => sum + spec.vehicleIds.length, 0);
          expect(junctionRows.length).toBe(expectedTotal);

          // Verify each (termId, vehicleId) triple is correct
          for (let i = 0; i < termsWithCoverage.length; i++) {
            const termId = termsWithCoverage[i].id;
            const expectedVehicles = termSpecs[i].vehicleIds;
            const termRows = junctionRows.filter((r) => r.termId === termId);
            expect(termRows.length).toBe(expectedVehicles.length);
            expect(new Set(termRows.map((r) => r.vehicleId))).toEqual(new Set(expectedVehicles));
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ===========================================================================
// Property 12: Coverage update regenerates children
// Feature: insurance-term-vehicle-coverage, Property 12
// **Validates: Requirements 8.3, 6.2**
// ===========================================================================
describe('Property 12: Coverage update regenerates children', () => {
  test('updating vehicleCoverage results in junction rows matching new vehicles and children regenerated with sum equaling totalAmount', async () => {
    await fc.assert(
      fc.asyncProperty(
        companyNameArb,
        validTermWithTotalCostArb,
        userVehicleIdsArb,
        userVehicleIdsArb,
        async (company, term, initialVehicleIds, updatedVehicleIds) => {
          // Create policy with initial coverage
          const created = await repo.create(
            {
              company,
              terms: [{ ...term, vehicleCoverage: coverageFor(initialVehicleIds) }],
              isActive: true,
            },
            USER_ID
          );

          // Update the term with different vehicle coverage
          await repo.updateTerm(
            created.id,
            term.id,
            { vehicleCoverage: coverageFor(updatedVehicleIds) },
            USER_ID
          );

          // Verify junction rows match the new vehicle set
          const junctionRows = await db
            .select()
            .from(insurancePolicyVehicles)
            .where(
              and(
                eq(insurancePolicyVehicles.policyId, created.id),
                eq(insurancePolicyVehicles.termId, term.id)
              )
            );
          expect(new Set(junctionRows.map((r) => r.vehicleId))).toEqual(new Set(updatedVehicleIds));

          // Verify expense group still exists and children are regenerated
          const groups = await db
            .select()
            .from(expenseGroups)
            .where(
              and(
                eq(expenseGroups.insurancePolicyId, created.id),
                eq(expenseGroups.insuranceTermId, term.id)
              )
            );
          expect(groups.length).toBe(1);

          const children = await db
            .select()
            .from(expenses)
            .where(eq(expenses.expenseGroupId, groups[0].id));
          expect(children.length).toBe(updatedVehicleIds.length);
          expect(new Set(children.map((c) => c.vehicleId))).toEqual(new Set(updatedVehicleIds));

          const childSum =
            Math.round(children.reduce((s, e) => s + e.expenseAmount, 0) * 100) / 100;
          expect(childSum).toBe(groups[0].totalAmount);
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ===========================================================================
// Property 13: Vehicle removal clears policy reference
// Feature: insurance-term-vehicle-coverage, Property 13
// **Validates: Requirement 8.4**
// ===========================================================================
describe('Property 13: Vehicle removal clears policy reference', () => {
  test('a vehicle removed from coverage (not covered by other terms) has currentInsurancePolicyId set to null', async () => {
    await fc.assert(
      fc.asyncProperty(companyNameArb, validTermWithTotalCostArb, async (company, term) => {
        // Use all 3 vehicles initially, then remove one
        const allVehicles = [...VEHICLE_IDS];
        const removedVehicle = allVehicles[allVehicles.length - 1];
        const remainingVehicles = allVehicles.slice(0, -1);

        // Create active policy covering all vehicles in a single term
        const created = await repo.create(
          {
            company,
            terms: [{ ...term, vehicleCoverage: coverageFor(allVehicles) }],
            isActive: true,
          },
          USER_ID
        );

        // Verify all vehicles have the policy reference
        for (const vid of allVehicles) {
          const rows = await db
            .select({ ref: vehicles.currentInsurancePolicyId })
            .from(vehicles)
            .where(eq(vehicles.id, vid));
          expect(rows[0].ref).toBe(created.id);
        }

        // Update term to remove the last vehicle
        await repo.updateTerm(
          created.id,
          term.id,
          { vehicleCoverage: coverageFor(remainingVehicles) },
          USER_ID
        );

        // Removed vehicle should have null reference
        const removedRows = await db
          .select({ ref: vehicles.currentInsurancePolicyId })
          .from(vehicles)
          .where(eq(vehicles.id, removedVehicle));
        expect(removedRows[0].ref).toBeNull();

        // Remaining vehicles should still have the policy reference
        for (const vid of remainingVehicles) {
          const rows = await db
            .select({ ref: vehicles.currentInsurancePolicyId })
            .from(vehicles)
            .where(eq(vehicles.id, vid));
          expect(rows[0].ref).toBe(created.id);
        }
      }),
      { numRuns: 50 }
    );
  });
});

// ===========================================================================
// Property 14: vehicleIds reflects the latest term's vehicles
// Feature: insurance-term-vehicle-coverage, Property 14
// **Validates: Requirement 9.2**
// ===========================================================================
describe('Property 14: vehicleIds reflects the latest term vehicles', () => {
  test('vehicleIds in API response equals the vehicle IDs of the latest term only', async () => {
    await fc.assert(
      fc.asyncProperty(
        companyNameArb,
        fc.array(
          fc.record({
            term: validTermArb,
            vehicleIds: userVehicleIdsArb,
          }),
          { minLength: 1, maxLength: 3 }
        ),
        async (company, termSpecs) => {
          // Create policy with multiple terms, each potentially covering different vehicles
          const termsWithCoverage = termSpecs.map((spec, i) => ({
            ...spec.term,
            id: `${spec.term.id}-${i}`,
            vehicleCoverage: coverageFor(spec.vehicleIds),
          }));

          const created = await repo.create(
            { company, terms: termsWithCoverage, isActive: true },
            USER_ID
          );

          // Retrieve the policy via findById (which calls attachVehicleIds)
          const policy = await repo.findById(created.id);
          expect(policy).not.toBeNull();

          // Find the latest term (max endDate)
          const allTerms = policy?.terms ?? [];
          let latestTerm = allTerms[0];
          for (const t of allTerms) {
            if (new Date(t.endDate).getTime() > new Date(latestTerm?.endDate).getTime()) {
              latestTerm = t;
            }
          }

          // vehicleIds should match only the latest term's junction rows
          const junctionRows = await db
            .select()
            .from(insurancePolicyVehicles)
            .where(eq(insurancePolicyVehicles.policyId, created.id));
          const latestTermVehicles = new Set(
            junctionRows.filter((r) => r.termId === latestTerm?.id).map((r) => r.vehicleId)
          );

          expect(new Set(policy?.vehicleIds)).toEqual(latestTermVehicles);

          // termVehicleCoverage should still contain ALL terms' coverage
          const allCoverageVehicleIds = new Set(junctionRows.map((r) => r.vehicleId));
          const responseCoverageVehicleIds = new Set(
            policy?.termVehicleCoverage.map((r) => r.vehicleId)
          );
          expect(responseCoverageVehicleIds).toEqual(allCoverageVehicleIds);
        }
      ),
      { numRuns: 50 }
    );
  });
});
