/**
 * Property tests for the insurance repository, run against an in-memory SQLite database with all migrations.
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

/** Picks one to three of the user's vehicle ids. */
const userVehicleIdsArb = fc
  .subarray(VEHICLE_IDS, { minLength: 1, maxLength: VEHICLE_IDS.length })
  .filter((arr) => arr.length > 0);

describe('current term derivation returns the latest term', () => {
  test('getCurrentTermDates returns the term with the latest end_date', async () => {
    await fc.assert(
      fc.asyncProperty(
        companyNameArb,
        userVehicleIdsArb,
        fc.array(validTermInputArb, { minLength: 1, maxLength: 5 }),
        async (company, vehicleIds, terms) => {
          const termsWithCoverage = terms.map((t) => ({
            ...t,
            vehicleCoverage: { vehicleIds },
          }));

          const created = await repo.create(
            { company, terms: termsWithCoverage, isActive: true },
            USER_ID
          );

          const currentDates = await repo.getCurrentTermDates(created.id);
          if (!currentDates) throw new Error('expected a current term');

          // Ordering is by end_date alone, so a tie may return either term. Assert that the returned
          // end_date is the maximum and that the pair matches one of the created terms.
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
            startDate: new Date('2027-01-01T00:00:00.000Z'),
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

    const validStarts = created.terms
      .filter((t) => t.endDate.getTime() === sharedEnd.getTime())
      .map((t) => t.startDate.getTime());
    expect(validStarts).toContain(currentDates.startDate.getTime());
  });
});

describe('active policy derivation for a vehicle', () => {
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

describe('insurance term CRUD round-trip', () => {
  test('addTerm inserts a term row and junction rows retrievable via findById', async () => {
    await fc.assert(
      fc.asyncProperty(
        companyNameArb,
        userVehicleIdsArb,
        validTermInputArb,
        validTermInputArb,
        async (company, vehicleIds, baseTerm, newTerm) => {
          const created = await repo.create(
            {
              company,
              terms: [{ ...baseTerm, vehicleCoverage: { vehicleIds } }],
              isActive: true,
            },
            USER_ID
          );
          expect(created.terms.length).toBe(1);

          const updated = await repo.addTerm(
            created.id,
            { ...newTerm, vehicleCoverage: { vehicleIds } },
            USER_ID
          );
          expect(updated.terms.length).toBe(2);

          const retrieved = await repo.findById(created.id);
          expect(retrieved).not.toBeNull();
          expect(retrieved?.terms.length).toBe(2);

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

          const updated = await repo.deleteTerm(created.id, termToDelete, USER_ID);
          expect(updated.terms.length).toBe(1);
          expect(updated.terms[0].id).not.toBe(termToDelete);

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

describe('expiring terms date range query', () => {
  test('findExpiringTerms returns terms with end_date within the range', async () => {
    await fc.assert(
      fc.asyncProperty(
        companyNameArb,
        userVehicleIdsArb,
        fc.array(validTermInputArb, { minLength: 1, maxLength: 5 }),
        async (company, vehicleIds, terms) => {
          const created = await repo.create(
            {
              company,
              terms: terms.map((t) => ({ ...t, vehicleCoverage: { vehicleIds } })),
              isActive: true,
            },
            USER_ID
          );

          const allEndDates = created.terms.map((t) => t.endDate.getTime());
          const minEnd = Math.min(...allEndDates);
          const maxEnd = Math.max(...allEndDates);

          const rangeStart = new Date(minEnd);
          const rangeEnd = new Date(maxEnd);

          const expiring = await repo.findExpiringTerms(rangeStart, rangeEnd, USER_ID);

          const expiringIds = new Set(expiring.map((t) => t.id));
          for (const term of created.terms) {
            const endTime = term.endDate.getTime();
            if (endTime >= rangeStart.getTime() && endTime <= rangeEnd.getTime()) {
              expect(expiringIds.has(term.id)).toBe(true);
            }
          }

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

    const expiring = await repo.findExpiringTerms(
      new Date('2030-01-01'),
      new Date('2030-12-31'),
      USER_ID
    );
    expect(expiring.length).toBe(0);
  });

  test('excludes terms of inactive policies while keeping active ones', async () => {
    const rangeStart = new Date('2031-01-01');
    const rangeEnd = new Date('2031-12-31');
    const termIn = (s: string, e: string) => ({
      startDate: new Date(s),
      endDate: new Date(e),
      vehicleCoverage: { vehicleIds: [VEHICLE_IDS[0]] },
    });

    const active = await repo.create(
      { company: 'ActiveCo', terms: [termIn('2031-01-01', '2031-06-30')], isActive: true },
      USER_ID
    );
    const cancelled = await repo.create(
      { company: 'CancelledCo', terms: [termIn('2031-02-01', '2031-07-31')], isActive: false },
      USER_ID
    );

    const expiring = await repo.findExpiringTerms(rangeStart, rangeEnd, USER_ID);
    const ids = new Set(expiring.map((t) => t.id));

    expect(ids.has(active.terms[0].id)).toBe(true);
    for (const t of cancelled.terms) {
      expect(ids.has(t.id)).toBe(false);
    }
  });
});

describe('insurance term-vehicle junction FK cascade', () => {
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

          const beforeJunction = await db
            .select()
            .from(insuranceTermVehicles)
            .where(eq(insuranceTermVehicles.termId, termId));
          expect(beforeJunction.length).toBe(vehicleIds.length);

          sqliteDb.run(`DELETE FROM insurance_terms WHERE id = '${termId}'`);

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

    const beforeJunction = await db
      .select()
      .from(insuranceTermVehicles)
      .where(eq(insuranceTermVehicles.termId, termId));
    expect(beforeJunction.length).toBe(1);
    expect(beforeJunction[0].vehicleId).toBe(testVehicleId);

    sqliteDb.run(`DELETE FROM vehicles WHERE id = '${testVehicleId}'`);

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

          for (const tid of termIds) {
            const termRows = await db
              .select()
              .from(insuranceTerms)
              .where(eq(insuranceTerms.id, tid));
            expect(termRows.length).toBe(1);
          }

          await repo.delete(created.id, USER_ID);

          for (const tid of termIds) {
            const termRows = await db
              .select()
              .from(insuranceTerms)
              .where(eq(insuranceTerms.id, tid));
            expect(termRows.length).toBe(0);

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
