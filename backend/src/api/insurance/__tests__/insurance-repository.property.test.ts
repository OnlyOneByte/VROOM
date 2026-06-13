/**
 * Property-Based Tests for Insurance Repository (v2 schema)
 *
 * Tests Properties 1, 2, 11, 12, 13 against a real in-memory
 * SQLite database with all migrations applied.
 *
 * **Validates: Requirements 1.6, 3.2, 16.1, 16.3, 16.4, 32.1, 36.1**
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import fc from 'fast-check';
import { applyMigration, loadMigrations } from '../../../db/__tests__/migration-helpers';
import type { AppDatabase } from '../../../db/connection';
import * as schema from '../../../db/schema';
import { insuranceTerms, insuranceTermVehicles } from '../../../db/schema';
import { InsurancePolicyRepository } from '../repository';
import { companyNameArb, validTermInputArb } from './insurance-test-generators';

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

let sqliteDb: Database;
let db: AppDatabase;
let repo: InsurancePolicyRepository;

const USER_ID = 'test-user-1';
const OTHER_USER_ID = 'test-user-2';
const VEHICLE_IDS = ['v-1', 'v-2', 'v-3'];
const OTHER_VEHICLE_IDS = ['v-other-1', 'v-other-2'];

function seedTestData(): void {
  sqliteDb.run(
    `INSERT INTO users (id, email, display_name) VALUES ('${USER_ID}', 'user1@test.com', 'User One')`
  );
  sqliteDb.run(
    `INSERT INTO users (id, email, display_name) VALUES ('${OTHER_USER_ID}', 'user2@test.com', 'User Two')`
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
  db = drizzle(sqliteDb, { schema });
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

// ===========================================================================
// Property 1: Current term derivation returns latest term
// **Validates: Requirements 1.6**
// ===========================================================================
describe('Property 1: Current term derivation returns latest term', () => {
  test('getCurrentTermDates returns the term with the latest end_date', async () => {
    await fc.assert(
      fc.asyncProperty(
        companyNameArb,
        userVehicleIdsArb,
        fc.array(validTermInputArb, { minLength: 1, maxLength: 5 }),
        async (company, vehicleIds, terms) => {
          // Create policy with multiple terms
          const termsWithCoverage = terms.map((t) => ({
            ...t,
            vehicleCoverage: { vehicleIds },
          }));

          const created = await repo.create(
            { company, terms: termsWithCoverage, isActive: true },
            USER_ID
          );

          // Get current term dates
          const currentDates = await repo.getCurrentTermDates(created.id);
          if (!currentDates) throw new Error('expected a current term');

          // The contract is "the term with the latest end_date" — getCurrentTermDates is
          // `ORDER BY end_date DESC LIMIT 1`, a SINGLE sort key. When two generated terms TIE on
          // end_date (endDate = startMs + gapMs can collide), SQL breaks the tie arbitrarily, so
          // BOTH tied terms are valid "current" results. Asserting a specific startDate against a
          // strict-`>` reference loop was therefore NON-DETERMINISTIC — it failed only when a tie's
          // two terms had different startDates and SQL picked the other one (the C362 flake; the
          // false failure then cost ~6.6s of fast-check shrinking, tripping the 5s timeout). Pin the
          // REAL contract deterministically: the returned end_date IS the maximum, and the returned
          // (startDate, endDate) pair belongs to SOME created term carrying that max end_date (so the
          // dates are a real round-tripped row, not mangled). Tie-independent, no behavior change.
          const maxEnd = Math.max(...created.terms.map((t) => t.endDate.getTime()));
          expect(currentDates.endDate.getTime()).toBe(maxEnd);

          const matchesACreatedTermAtMaxEnd = created.terms.some(
            (t) =>
              t.endDate.getTime() === maxEnd &&
              t.startDate.getTime() === currentDates.startDate.getTime() &&
              t.endDate.getTime() === currentDates.endDate.getTime()
          );
          expect(matchesACreatedTermAtMaxEnd).toBe(true);
        }
      ),
      { numRuns: 50 }
    );
  }, 20_000);

  test('getCurrentTermDates returns null for policy with no terms', async () => {
    const created = await repo.create({ company: 'TestCo', terms: [], isActive: true }, USER_ID);
    const result = await repo.getCurrentTermDates(created.id);
    expect(result).toBeNull();
  });

  // C363 (infra, the C362-filed flake): two terms TIE on end_date with DIFFERENT start_dates — the
  // exact shape that made the old strict-`>` reference assertion non-deterministic. getCurrentTermDates
  // is ORDER BY end_date DESC LIMIT 1 (single key), so EITHER tied term is a valid result. This pins
  // the tie-tolerant contract deterministically: the returned end_date is the (shared) max, and the
  // returned pair is one of the two real terms at that end_date — never a mismatched/mangled row.
  test('on an end_date TIE, returns a real term at the max end_date (tie-tolerant, no startDate assumption)', async () => {
    const sharedEnd = new Date('2027-06-30T00:00:00.000Z');
    const created = await repo.create(
      {
        company: 'TieCo',
        terms: [
          {
            startDate: new Date('2026-07-01T00:00:00.000Z'),
            endDate: sharedEnd,
            vehicleCoverage: { vehicleIds: [VEHICLE_IDS[0]] },
          },
          {
            startDate: new Date('2027-01-01T00:00:00.000Z'), // different start, SAME end
            endDate: sharedEnd,
            vehicleCoverage: { vehicleIds: [VEHICLE_IDS[0]] },
          },
        ],
        isActive: true,
      },
      USER_ID
    );

    const currentDates = await repo.getCurrentTermDates(created.id);
    if (!currentDates) throw new Error('expected a current term');
    expect(currentDates.endDate.getTime()).toBe(sharedEnd.getTime());

    // The returned (start, end) must be one of the two created terms — whichever SQL's tie-break
    // picked — not a cross-wired pair. Both candidate starts share the max end, so either is correct.
    const validStarts = created.terms
      .filter((t) => t.endDate.getTime() === sharedEnd.getTime())
      .map((t) => t.startDate.getTime());
    expect(validStarts).toContain(currentDates.startDate.getTime());
  });
});

// ===========================================================================
// Property 2: Active policy derivation for vehicle
// **Validates: Requirements 3.2, 32.1**
// ===========================================================================
describe('Property 2: Active policy derivation for vehicle', () => {
  test('getActiveInsurancePolicyId returns a non-null active policy for a covered vehicle', async () => {
    await fc.assert(
      fc.asyncProperty(
        companyNameArb,
        userVehicleIdsArb,
        validTermInputArb,
        async (company, vehicleIds, term) => {
          await repo.create(
            {
              company,
              terms: [{ ...term, vehicleCoverage: { vehicleIds } }],
              isActive: true,
            },
            USER_ID
          );

          // Each covered vehicle should have some active policy
          for (const vid of vehicleIds) {
            const activePolicyId = await repo.getActiveInsurancePolicyId(vid);
            expect(activePolicyId).not.toBeNull();
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  test('getActiveInsurancePolicyId returns null when only inactive policies exist', async () => {
    // Use a dedicated vehicle to avoid interference from other iterations
    const testVid = 'v-inactive-test';
    sqliteDb.run(
      `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('${testVid}', '${USER_ID}', 'Nissan', 'Leaf', 2023)`
    );

    const term = fc.sample(validTermInputArb, 1)[0];
    await repo.create(
      {
        company: 'InactiveCo',
        terms: [{ ...term, vehicleCoverage: { vehicleIds: [testVid] } }],
        isActive: false,
      },
      USER_ID
    );

    const activePolicyId = await repo.getActiveInsurancePolicyId(testVid);
    expect(activePolicyId).toBeNull();
  });

  test('getActiveInsurancePolicyId returns null for uncovered vehicle', async () => {
    const result = await repo.getActiveInsurancePolicyId('v-nonexistent');
    expect(result).toBeNull();
  });

  test('getActiveInsurancePolicyId returns policy with latest term end_date when multiple active policies exist', async () => {
    const vid = VEHICLE_IDS[0];
    const earlyTerm = {
      ...fc.sample(validTermInputArb, 1)[0],
      startDate: new Date('2020-01-01'),
      endDate: new Date('2020-12-31'),
      vehicleCoverage: { vehicleIds: [vid] },
    };
    const lateTerm = {
      ...fc.sample(validTermInputArb, 1)[0],
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-12-31'),
      vehicleCoverage: { vehicleIds: [vid] },
    };

    await repo.create({ company: 'EarlyCo', terms: [earlyTerm], isActive: true }, USER_ID);
    const laterPolicy = await repo.create(
      { company: 'LateCo', terms: [lateTerm], isActive: true },
      USER_ID
    );

    const activePolicyId = await repo.getActiveInsurancePolicyId(vid);
    expect(activePolicyId).toBe(laterPolicy.id);
  });
});

// ===========================================================================
// Property 11: Insurance term CRUD round-trip
// **Validates: Requirements 16.1, 36.1**
// ===========================================================================
describe('Property 11: Insurance term CRUD round-trip', () => {
  test('addTerm inserts a term row and junction rows retrievable via findById', async () => {
    await fc.assert(
      fc.asyncProperty(
        companyNameArb,
        userVehicleIdsArb,
        validTermInputArb,
        validTermInputArb,
        async (company, vehicleIds, baseTerm, newTerm) => {
          // Create policy with one term
          const created = await repo.create(
            {
              company,
              terms: [{ ...baseTerm, vehicleCoverage: { vehicleIds } }],
              isActive: true,
            },
            USER_ID
          );
          expect(created.terms.length).toBe(1);

          // Add a second term
          const updated = await repo.addTerm(
            created.id,
            { ...newTerm, vehicleCoverage: { vehicleIds } },
            USER_ID
          );
          expect(updated.terms.length).toBe(2);

          // Verify via findById
          const retrieved = await repo.findById(created.id);
          expect(retrieved).not.toBeNull();
          expect(retrieved?.terms.length).toBe(2);

          // Junction rows should exist for both terms
          expect(retrieved?.termVehicleCoverage.length).toBe(vehicleIds.length * 2);
        }
      ),
      { numRuns: 30 }
    );
  });

  test('updateTerm modifies term fields and persists changes', async () => {
    await fc.assert(
      fc.asyncProperty(
        companyNameArb,
        userVehicleIdsArb,
        validTermInputArb,
        async (company, vehicleIds, term) => {
          const created = await repo.create(
            {
              company,
              terms: [{ ...term, vehicleCoverage: { vehicleIds } }],
              isActive: true,
            },
            USER_ID
          );

          const termId = created.terms[0].id;
          const newDescription = 'Updated coverage description';

          await repo.updateTerm(
            created.id,
            termId,
            { coverageDescription: newDescription },
            USER_ID
          );

          const retrieved = await repo.findById(created.id);
          const updatedTerm = retrieved?.terms.find((t) => t.id === termId);
          expect(updatedTerm).not.toBeUndefined();
          expect(updatedTerm?.coverageDescription).toBe(newDescription);
        }
      ),
      { numRuns: 30 }
    );
  });

  test('deleteTerm removes the term and its junction rows', async () => {
    await fc.assert(
      fc.asyncProperty(
        companyNameArb,
        userVehicleIdsArb,
        validTermInputArb,
        validTermInputArb,
        async (company, vehicleIds, term1, term2) => {
          // Create policy with two terms
          const created = await repo.create(
            {
              company,
              terms: [
                { ...term1, vehicleCoverage: { vehicleIds } },
                { ...term2, vehicleCoverage: { vehicleIds } },
              ],
              isActive: true,
            },
            USER_ID
          );
          expect(created.terms.length).toBe(2);

          const termToDelete = created.terms[0].id;

          // Delete one term
          const updated = await repo.deleteTerm(created.id, termToDelete, USER_ID);
          expect(updated.terms.length).toBe(1);
          expect(updated.terms[0].id).not.toBe(termToDelete);

          // Junction rows for deleted term should be gone
          const junctionRows = await db
            .select()
            .from(insuranceTermVehicles)
            .where(eq(insuranceTermVehicles.termId, termToDelete));
          expect(junctionRows.length).toBe(0);
        }
      ),
      { numRuns: 30 }
    );
  });
});

// ===========================================================================
// Property 12: Expiring terms date range query
// **Validates: Requirements 16.3**
// ===========================================================================
describe('Property 12: Expiring terms date range query', () => {
  test('findExpiringTerms returns terms with end_date within the range', async () => {
    await fc.assert(
      fc.asyncProperty(
        companyNameArb,
        userVehicleIdsArb,
        fc.array(validTermInputArb, { minLength: 1, maxLength: 5 }),
        async (company, vehicleIds, terms) => {
          // Create policy with multiple terms
          const created = await repo.create(
            {
              company,
              terms: terms.map((t) => ({ ...t, vehicleCoverage: { vehicleIds } })),
              isActive: true,
            },
            USER_ID
          );

          // Pick a date range that covers some terms
          const allEndDates = created.terms.map((t) => t.endDate.getTime());
          const minEnd = Math.min(...allEndDates);
          const maxEnd = Math.max(...allEndDates);

          // Use the full range to ensure all terms are found
          const rangeStart = new Date(minEnd);
          const rangeEnd = new Date(maxEnd);

          const expiring = await repo.findExpiringTerms(rangeStart, rangeEnd, USER_ID);

          // All created terms should be in the result (their end_dates are within range)
          const expiringIds = new Set(expiring.map((t) => t.id));
          for (const term of created.terms) {
            const endTime = term.endDate.getTime();
            if (endTime >= rangeStart.getTime() && endTime <= rangeEnd.getTime()) {
              expect(expiringIds.has(term.id)).toBe(true);
            }
          }

          // No term outside the range should be returned
          for (const t of expiring) {
            const endTime = t.endDate.getTime();
            expect(endTime).toBeGreaterThanOrEqual(rangeStart.getTime());
            expect(endTime).toBeLessThanOrEqual(rangeEnd.getTime());
          }
        }
      ),
      { numRuns: 30 }
    );
  });

  test('findExpiringTerms returns empty for range with no matching terms', async () => {
    // Create a term in 2025
    await repo.create(
      {
        company: 'TestCo',
        terms: [
          {
            startDate: new Date('2025-01-01'),
            endDate: new Date('2025-06-30'),
            vehicleCoverage: { vehicleIds: [VEHICLE_IDS[0]] },
          },
        ],
        isActive: true,
      },
      USER_ID
    );

    // Query for 2030 range — should find nothing
    const expiring = await repo.findExpiringTerms(
      new Date('2030-01-01'),
      new Date('2030-12-31'),
      USER_ID
    );
    expect(expiring.length).toBe(0);
  });

  // #26c (C184): a term on a CANCELLED (isActive=false) policy must NOT surface as "expiring soon" —
  // GET /expiring-soon is an upcoming-renewal nag, and a policy the user cancelled isn't being renewed.
  // Pre-fix the query joined policies but never filtered isActive, so a cancelled policy's in-range term
  // still showed. An ACTIVE policy's term in the same window must still appear (the filter isn't over-broad).
  test('excludes terms of INACTIVE policies; an active policy’s in-range term still shows (#26c)', async () => {
    const rangeStart = new Date('2031-01-01');
    const rangeEnd = new Date('2031-12-31');
    const termIn = (s: string, e: string) => ({
      startDate: new Date(s),
      endDate: new Date(e),
      vehicleCoverage: { vehicleIds: [VEHICLE_IDS[0]] },
    });

    // Active policy with a term expiring inside the window — SHOULD appear.
    const active = await repo.create(
      { company: 'ActiveCo', terms: [termIn('2031-01-01', '2031-06-30')], isActive: true },
      USER_ID
    );
    // Cancelled policy with a term expiring in the SAME window — must NOT appear.
    const cancelled = await repo.create(
      { company: 'CancelledCo', terms: [termIn('2031-02-01', '2031-07-31')], isActive: false },
      USER_ID
    );

    const expiring = await repo.findExpiringTerms(rangeStart, rangeEnd, USER_ID);
    const ids = new Set(expiring.map((t) => t.id));

    expect(ids.has(active.terms[0].id)).toBe(true); // active renewal still surfaced
    for (const t of cancelled.terms) {
      expect(ids.has(t.id)).toBe(false); // cancelled policy's term excluded
    }
  });
});

// ===========================================================================
// Property 13: Insurance term-vehicle junction FK cascade
// **Validates: Requirements 16.4**
// ===========================================================================
describe('Property 13: Insurance term-vehicle junction FK cascade', () => {
  test('deleting a term cascades to junction rows', async () => {
    await fc.assert(
      fc.asyncProperty(
        companyNameArb,
        userVehicleIdsArb,
        validTermInputArb,
        async (company, vehicleIds, term) => {
          const created = await repo.create(
            {
              company,
              terms: [{ ...term, vehicleCoverage: { vehicleIds } }],
              isActive: true,
            },
            USER_ID
          );

          const termId = created.terms[0].id;

          // Verify junction rows exist
          const beforeJunction = await db
            .select()
            .from(insuranceTermVehicles)
            .where(eq(insuranceTermVehicles.termId, termId));
          expect(beforeJunction.length).toBe(vehicleIds.length);

          // Delete the term directly via SQL to test FK cascade
          sqliteDb.run(`DELETE FROM insurance_terms WHERE id = '${termId}'`);

          // Junction rows should be cascade-deleted
          const afterJunction = await db
            .select()
            .from(insuranceTermVehicles)
            .where(eq(insuranceTermVehicles.termId, termId));
          expect(afterJunction.length).toBe(0);
        }
      ),
      { numRuns: 30 }
    );
  });

  test('deleting a vehicle cascades to junction rows', async () => {
    // Use a dedicated vehicle for this test to avoid affecting other tests
    const testVehicleId = 'v-cascade-test';
    sqliteDb.run(
      `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('${testVehicleId}', '${USER_ID}', 'Ford', 'Focus', 2021)`
    );

    const term = fc.sample(validTermInputArb, 1)[0];
    const created = await repo.create(
      {
        company: 'CascadeCo',
        terms: [{ ...term, vehicleCoverage: { vehicleIds: [testVehicleId] } }],
        isActive: true,
      },
      USER_ID
    );

    const termId = created.terms[0].id;

    // Verify junction row exists
    const beforeJunction = await db
      .select()
      .from(insuranceTermVehicles)
      .where(eq(insuranceTermVehicles.termId, termId));
    expect(beforeJunction.length).toBe(1);
    expect(beforeJunction[0].vehicleId).toBe(testVehicleId);

    // Delete the vehicle
    sqliteDb.run(`DELETE FROM vehicles WHERE id = '${testVehicleId}'`);

    // Junction row should be cascade-deleted
    const afterJunction = await db
      .select()
      .from(insuranceTermVehicles)
      .where(eq(insuranceTermVehicles.termId, termId));
    expect(afterJunction.length).toBe(0);
  });

  test('deleting a policy cascades to terms and junction rows', async () => {
    await fc.assert(
      fc.asyncProperty(
        companyNameArb,
        userVehicleIdsArb,
        fc.array(validTermInputArb, { minLength: 1, maxLength: 3 }),
        async (company, vehicleIds, terms) => {
          const created = await repo.create(
            {
              company,
              terms: terms.map((t) => ({ ...t, vehicleCoverage: { vehicleIds } })),
              isActive: true,
            },
            USER_ID
          );

          const termIds = created.terms.map((t) => t.id);

          // Verify terms and junction rows exist
          for (const tid of termIds) {
            const termRows = await db
              .select()
              .from(insuranceTerms)
              .where(eq(insuranceTerms.id, tid));
            expect(termRows.length).toBe(1);
          }

          // Delete the policy
          await repo.delete(created.id, USER_ID);

          // All terms should be cascade-deleted
          for (const tid of termIds) {
            const termRows = await db
              .select()
              .from(insuranceTerms)
              .where(eq(insuranceTerms.id, tid));
            expect(termRows.length).toBe(0);

            // Junction rows should also be gone
            const junctionRows = await db
              .select()
              .from(insuranceTermVehicles)
              .where(eq(insuranceTermVehicles.termId, tid));
            expect(junctionRows.length).toBe(0);
          }
        }
      ),
      { numRuns: 30 }
    );
  });
});
