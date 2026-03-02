/**
 * Property-Based Tests for Insurance Repository
 *
 * Tests Properties 1, 2, 3, 5, 6, 7, 15, 16, 17 against a real in-memory
 * SQLite database with all migrations applied.
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.6, 1.12, 1.13, 1.15, 5.1–5.6**
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import fc from 'fast-check';
import { applyMigration, loadMigrations } from '../../../db/__tests__/migration-helpers';
import type { PolicyTerm } from '../../../db/schema';
import { expenses, insurancePolicyVehicles, vehicles } from '../../../db/schema';
import type { CreatePolicyData } from '../repository';
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

/** Generate a valid CreatePolicyData using seeded vehicle IDs. */
const validCreatePolicyArb = fc.record({
  company: companyNameArb,
  vehicleIds: userVehicleIdsArb,
  terms: fc.array(validTermArb, { minLength: 1, maxLength: 3 }),
  notes: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
  isActive: fc.boolean(),
});

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
        expect(new Set(retrieved?.vehicleIds)).toEqual(new Set(input.vehicleIds));
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

        expect(junctionRows.length).toBe(input.vehicleIds.length);
        const junctionVehicleIds = new Set(junctionRows.map((r) => r.vehicleId));
        expect(junctionVehicleIds).toEqual(new Set(input.vehicleIds));
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
            vehicleIds: otherVehicleIds,
            terms,
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
          // Create with first term
          const input: CreatePolicyData = {
            company,
            vehicleIds,
            terms: [terms[0]],
            isActive: true,
          };
          const created = await repo.create(input, USER_ID);

          // Add remaining terms one by one
          const policyId = created.id;
          for (let i = 1; i < terms.length; i++) {
            await repo.addTerm(policyId, terms[i], USER_ID);
          }

          // Retrieve and verify
          const policy = await repo.findById(policyId);
          expect(policy).not.toBeNull();

          const allTerms = policy?.terms as PolicyTerm[];
          expect(allTerms.length).toBe(terms.length);

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
            vehicleIds,
            terms,
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
            vehicleIds,
            terms,
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
            { company, vehicleIds, terms, isActive: true },
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
  test('term with totalCost creates exactly one expense with correct fields', async () => {
    await fc.assert(
      fc.asyncProperty(
        companyNameArb,
        userVehicleIdsArb,
        validTermWithTotalCostArb,
        async (company, vehicleIds, term) => {
          // Create policy with a term that has no totalCost first
          const baseTerm = { ...term, id: `base-${term.id}`, financeDetails: {} };
          const created = await repo.create(
            { company, vehicleIds, terms: [baseTerm], isActive: true },
            USER_ID
          );

          // Count expenses before adding the term with totalCost
          const _beforeCount = sqliteDb
            .query(
              `SELECT COUNT(*) as count FROM expenses WHERE insurance_policy_id = '${created.id}'`
            )
            .get() as { count: number };

          // Add term with totalCost
          await repo.addTerm(created.id, term, USER_ID);

          // Query expenses linked to this policy and term
          const expenseRows = await db
            .select()
            .from(expenses)
            .where(eq(expenses.insurancePolicyId, created.id));

          // Should have exactly one more expense than before
          const newExpenses = expenseRows.filter((e) => e.insuranceTermId === term.id);
          expect(newExpenses.length).toBe(1);

          const expense = newExpenses[0];
          expect(expense.category).toBe('financial');
          expect(expense.tags).toContain('insurance');
          expect(expense.expenseAmount).toBe(term.financeDetails.totalCost);
          expect(expense.insurancePolicyId).toBe(created.id);
          expect(expense.insuranceTermId).toBe(term.id);

          // Description should contain both dates
          expect(expense.description).toContain(term.startDate);
          expect(expense.description).toContain(term.endDate);
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
            { company, vehicleIds, terms: [term], isActive: true },
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
            { company, vehicleIds, terms: [baseTerm], isActive: true },
            USER_ID
          );

          // Count expenses before
          const beforeCount = (
            sqliteDb.query('SELECT COUNT(*) as count FROM expenses').get() as { count: number }
          ).count;

          // Add term without totalCost
          await repo.addTerm(created.id, term, USER_ID);

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
