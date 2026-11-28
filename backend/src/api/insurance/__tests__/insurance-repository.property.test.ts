import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import fc from 'fast-check';
import { applyMigration, loadMigrations } from '../../../db/__tests__/migration-helpers';
import { openAsyncDatabase } from '../../../db/async-sqlite';
import type { AppDatabase } from '../../../db/connection';
import * as schema from '../../../db/schema';
import { insuranceTerms, insuranceTermVehicles } from '../../../db/schema';
import { DatabaseError, NotFoundError } from '../../../errors';
import { InsurancePolicyRepository } from '../repository';
import { companyNameArb, inSequence, validTermInputArb } from './insurance-test-generators';

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
  repo = new InsurancePolicyRepository(openAsyncDatabase(db.$client).db);
  seedTestData();
});

afterEach(() => {
  sqliteDb.close();
});

const userVehicleIdsArb = fc
  .subarray(VEHICLE_IDS, { minLength: 1, maxLength: VEHICLE_IDS.length })
  .filter((arr) => arr.length > 0);

describe('insurance write failures', () => {
  test('a failed create raises a DatabaseError without the driver error attached', async () => {
    const attempt = repo.create(
      {
        company: 'Dup Coverage',
        terms: [
          {
            startDate: new Date('2024-01-01T00:00:00Z'),
            endDate: new Date('2024-12-31T00:00:00Z'),
            vehicleCoverage: { vehicleIds: ['v-1', 'v-1'] },
          },
        ],
      },
      USER_ID
    );

    const error = await attempt.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DatabaseError);
    expect((error as DatabaseError).message).toBe('Failed to create insurance policy');
    expect((error as DatabaseError).details).toBeUndefined();
    expect(counts()).toEqual({ policies: 0, terms: 0, coverage: 0 });
  });

  test('a failed addTerm or updateTerm leaves no partial coverage behind', async () => {
    const term = {
      startDate: new Date('2024-01-01T00:00:00Z'),
      endDate: new Date('2024-12-31T00:00:00Z'),
      vehicleCoverage: { vehicleIds: ['v-1'] },
    };
    const policy = await repo.create({ company: 'Co', terms: [term] }, USER_ID);
    const termId = policy.terms[0]?.id ?? '';
    const before = counts();

    const twice = { vehicleIds: ['v-2', 'v-2'] };
    await expect(
      repo.addTerm(policy.id, { ...term, vehicleCoverage: twice }, USER_ID)
    ).rejects.toThrow(DatabaseError);
    expect(counts()).toEqual(before);

    await expect(
      repo.updateTerm(policy.id, termId, { policyNumber: 'X-1', vehicleCoverage: twice }, USER_ID)
    ).rejects.toThrow(DatabaseError);
    expect(counts()).toEqual(before);
    const stored = sqliteDb
      .query('SELECT policy_number AS n FROM insurance_terms WHERE id = ?')
      .get(termId) as { n: string | null };
    expect(stored.n).toBeNull();
  });
});

function counts() {
  const n = (table: string) =>
    (sqliteDb.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  return {
    policies: n('insurance_policies'),
    terms: n('insurance_terms'),
    coverage: n('insurance_term_vehicles'),
  };
}

describe('insurance term CRUD round-trip', () => {
  test('addTerm inserts a term row and junction rows retrievable via findById', async () => {
    await fc.assert(
      fc.asyncProperty(
        companyNameArb,
        userVehicleIdsArb,
        validTermInputArb,
        validTermInputArb,
        async (company, vehicleIds, firstTerm, secondTerm) => {
          const [baseTerm, newTerm] = inSequence([firstTerm, secondTerm]);
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
        async (company, vehicleIds, firstTerm, secondTerm) => {
          const [term1, term2] = inSequence([firstTerm, secondTerm]);
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
              terms: inSequence(terms).map((t) => ({ ...t, vehicleCoverage: { vehicleIds } })),
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

describe('writes are scoped to the policy owner', () => {
  async function createOwnersPolicy() {
    return repo.create(
      {
        company: 'OwnerCo',
        notes: 'original',
        terms: [
          {
            startDate: new Date('2026-01-01'),
            endDate: new Date('2026-12-31'),
            coverageDescription: 'original',
            vehicleCoverage: { vehicleIds: [VEHICLE_IDS[0]] },
          },
        ],
        isActive: true,
      },
      USER_ID
    );
  }

  test('update by another user throws NotFound and leaves the policy unchanged', async () => {
    const created = await createOwnersPolicy();
    await expect(repo.update(created.id, { company: 'Hijacked' }, OTHER_USER_ID)).rejects.toThrow(
      NotFoundError
    );
    expect((await repo.findById(created.id))?.company).toBe('OwnerCo');
  });

  test('delete by another user throws NotFound and keeps the policy', async () => {
    const created = await createOwnersPolicy();
    await expect(repo.delete(created.id, OTHER_USER_ID)).rejects.toThrow(NotFoundError);
    expect(await repo.findById(created.id)).not.toBeNull();
  });

  test('addTerm by another user throws NotFound and adds nothing', async () => {
    const created = await createOwnersPolicy();
    await expect(
      repo.addTerm(
        created.id,
        {
          startDate: new Date('2027-01-01'),
          endDate: new Date('2027-12-31'),
          vehicleCoverage: { vehicleIds: [OTHER_VEHICLE_IDS[0]] },
        },
        OTHER_USER_ID
      )
    ).rejects.toThrow(NotFoundError);
    expect((await repo.findById(created.id))?.terms.length).toBe(1);
  });

  test('updateTerm by another user throws NotFound and leaves the term unchanged', async () => {
    const created = await createOwnersPolicy();
    const termId = created.terms[0].id;
    await expect(
      repo.updateTerm(created.id, termId, { coverageDescription: 'Hijacked' }, OTHER_USER_ID)
    ).rejects.toThrow(NotFoundError);
    const term = (await repo.findById(created.id))?.terms.find((t) => t.id === termId);
    expect(term?.coverageDescription).toBe('original');
  });

  test('deleteTerm by another user throws NotFound and keeps the term', async () => {
    const created = await createOwnersPolicy();
    const termId = created.terms[0].id;
    await expect(repo.deleteTerm(created.id, termId, OTHER_USER_ID)).rejects.toThrow(NotFoundError);
    expect((await repo.findById(created.id))?.terms.map((t) => t.id)).toEqual([termId]);
  });
});

describe('policy lists load terms and coverage in batches', () => {
  async function createPolicies(count: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const created = await repo.create(
        {
          company: `Insurer ${i}`,
          terms: [
            {
              startDate: new Date('2024-01-01T00:00:00Z'),
              endDate: new Date('2024-12-31T00:00:00Z'),
              vehicleCoverage: { vehicleIds: [VEHICLE_IDS[i % VEHICLE_IDS.length] as string] },
            },
            {
              startDate: new Date('2025-01-01T00:00:00Z'),
              endDate: new Date('2025-12-31T00:00:00Z'),
              vehicleCoverage: { vehicleIds: ['v-1', 'v-2'] },
            },
          ],
        },
        USER_ID
      );
      ids.push(created.id);
    }
    return ids;
  }

  test('findByUserId runs the same number of queries for 1 or 6 policies, with the same data as findById', async () => {
    await createPolicies(1);
    const { session } = openAsyncDatabase(sqliteDb).db as unknown as {
      session: { client: (...args: unknown[]) => unknown };
    };
    const executed = spyOn(session, 'client');
    await repo.findByUserId(USER_ID);
    const queriesForOne = executed.mock.calls.length;
    expect(queriesForOne).toBeGreaterThan(0);

    const ids = await createPolicies(5);
    executed.mockClear();
    const policies = await repo.findByUserId(USER_ID);
    expect(executed.mock.calls.length).toBe(queriesForOne);
    executed.mockRestore();

    expect(policies).toHaveLength(6);
    for (const id of ids) {
      const listed = policies.find((p) => p.id === id);
      const single = await repo.findById(id);
      expect(listed?.terms.map((t) => t.id)).toEqual(single?.terms.map((t) => t.id) ?? []);
      expect(listed?.terms.map((t) => t.endDate)).toEqual([
        new Date('2025-12-31T00:00:00Z'),
        new Date('2024-12-31T00:00:00Z'),
      ]);
      expect(new Set(listed?.vehicleIds)).toEqual(new Set(single?.vehicleIds));
      expect(listed?.termVehicleCoverage).toHaveLength(3);
    }
  });

  test('findByVehicleId groups each policy’s own terms', async () => {
    await createPolicies(3);
    const policies = await repo.findByVehicleId('v-3');
    expect(policies).toHaveLength(1);
    expect(policies[0]?.terms).toHaveLength(2);
    expect(policies[0]?.terms.every((t) => t.policyId === policies[0]?.id)).toBe(true);
  });
});
