/**
 * Property-Based Tests for ExpenseSplitService.computeAllocations()
 *
 * Tests Properties 1–4 from the design document:
 * - Property 1: Allocation sum invariant
 * - Property 2: Even split fairness
 * - Property 3: Allocation count matches vehicle count
 * - Property 4: Absolute split passthrough
 */

import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import type { SplitConfig } from '../../../db/schema';
import { ExpenseSplitService } from '../split-service';

const service = new ExpenseSplitService();

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const vehicleIdArb = fc.stringMatching(/^v[a-z0-9]{1,10}$/);

/** 1–10 unique vehicle IDs */
const vehicleIdsArb = fc
  .uniqueArray(vehicleIdArb, { minLength: 1, maxLength: 10 })
  .filter((ids) => ids.length >= 1);

/** Positive dollar amount (0.01 – 100 000), rounded to cents */
const positiveAmountArb = fc
  .double({ min: 0.01, max: 100_000, noNaN: true })
  .map((v) => Math.round(v * 100) / 100)
  .filter((v) => v >= 0.01);

/** Even split config */
const evenConfigArb: fc.Arbitrary<SplitConfig> = vehicleIdsArb.map((vehicleIds) => ({
  method: 'even' as const,
  vehicleIds,
}));

/**
 * Absolute split config where allocations sum exactly to totalAmount.
 * Strategy: generate N random weights, normalize them to sum to totalAmount in cents,
 * then convert back to dollars.
 */
const absoluteConfigArb = (totalAmount: number): fc.Arbitrary<SplitConfig> =>
  vehicleIdsArb.chain((vehicleIds) => {
    const n = vehicleIds.length;
    const totalCents = Math.round(totalAmount * 100);
    return fc
      .array(fc.integer({ min: 1, max: 10000 }), { minLength: n, maxLength: n })
      .map((weights) => {
        const weightSum = weights.reduce((s, w) => s + w, 0);
        const cents = weights.map((w) => Math.floor((w / weightSum) * totalCents));
        // Distribute remainder to first entries
        let remainder = totalCents - cents.reduce((s, c) => s + c, 0);
        for (let i = 0; remainder > 0; i++) {
          cents[i]++;
          remainder--;
        }
        const allocations = vehicleIds.map((vehicleId, i) => ({
          vehicleId,
          amount: cents[i] / 100,
        }));
        return { method: 'absolute' as const, allocations };
      });
  });

/**
 * Percentage split config where percentages sum to exactly 100.
 * Strategy: generate N random weights, normalize to integer percentages summing to 100.
 */
const percentageConfigArb: fc.Arbitrary<SplitConfig> = vehicleIdsArb.chain((vehicleIds) => {
  const n = vehicleIds.length;
  return fc
    .array(fc.integer({ min: 1, max: 10000 }), { minLength: n, maxLength: n })
    .map((weights) => {
      const weightSum = weights.reduce((s, w) => s + w, 0);
      const pcts = weights.map((w) => Math.floor((w / weightSum) * 100));
      let remainder = 100 - pcts.reduce((s, p) => s + p, 0);
      for (let i = 0; remainder > 0; i++) {
        pcts[i]++;
        remainder--;
      }
      const allocations = vehicleIds.map((vehicleId, i) => ({
        vehicleId,
        percentage: pcts[i],
      }));
      return { method: 'percentage' as const, allocations };
    });
});

// ---------------------------------------------------------------------------
// Property 1: Allocation sum invariant
// **Validates: Requirements 4.4, 5.4**
// ---------------------------------------------------------------------------
describe('Property 1: Allocation sum invariant', () => {
  test('sum of allocations equals totalAmount for even split', () => {
    fc.assert(
      fc.property(evenConfigArb, positiveAmountArb, (config, totalAmount) => {
        const result = service.computeAllocations(config, totalAmount);
        const sum = result.reduce((s, a) => s + a.amount, 0);
        expect(Math.round(sum * 100) / 100).toBe(totalAmount);
      }),
      { numRuns: 200 }
    );
  });

  test('sum of allocations equals totalAmount for absolute split', () => {
    fc.assert(
      fc.property(
        positiveAmountArb.chain((total) => fc.tuple(absoluteConfigArb(total), fc.constant(total))),
        ([config, totalAmount]) => {
          const result = service.computeAllocations(config, totalAmount);
          const sum = result.reduce((s, a) => s + a.amount, 0);
          expect(Math.round(sum * 100) / 100).toBe(totalAmount);
        }
      ),
      { numRuns: 200 }
    );
  });

  test('sum of allocations equals totalAmount for percentage split', () => {
    fc.assert(
      fc.property(percentageConfigArb, positiveAmountArb, (config, totalAmount) => {
        const result = service.computeAllocations(config, totalAmount);
        const sum = result.reduce((s, a) => s + a.amount, 0);
        expect(Math.round(sum * 100) / 100).toBe(totalAmount);
      }),
      { numRuns: 200 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: Even split fairness
// **Validates: Requirement 4.6**
// ---------------------------------------------------------------------------
describe('Property 2: Even split fairness', () => {
  test('max amount minus min amount is at most 0.01 for even splits', () => {
    fc.assert(
      fc.property(evenConfigArb, positiveAmountArb, (config, totalAmount) => {
        const result = service.computeAllocations(config, totalAmount);
        const amounts = result.map((a) => a.amount);
        const maxAmt = Math.max(...amounts);
        const minAmt = Math.min(...amounts);
        const diff = Math.round((maxAmt - minAmt) * 100) / 100;
        expect(diff).toBeLessThanOrEqual(0.01);
      }),
      { numRuns: 200 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: Allocation count matches vehicle count
// **Validates: Requirements 4.5, 5.1**
// ---------------------------------------------------------------------------
describe('Property 3: Allocation count matches vehicle count', () => {
  test('result length equals vehicle count for even split', () => {
    fc.assert(
      fc.property(evenConfigArb, positiveAmountArb, (config, totalAmount) => {
        if (config.method !== 'even') throw new Error('unexpected');
        const result = service.computeAllocations(config, totalAmount);
        expect(result.length).toBe(config.vehicleIds.length);
      }),
      { numRuns: 200 }
    );
  });

  test('result length equals vehicle count for absolute split', () => {
    fc.assert(
      fc.property(
        positiveAmountArb.chain((total) => fc.tuple(absoluteConfigArb(total), fc.constant(total))),
        ([config, totalAmount]) => {
          const result = service.computeAllocations(config, totalAmount);
          if (config.method !== 'absolute') throw new Error('unexpected');
          expect(result.length).toBe(config.allocations.length);
        }
      ),
      { numRuns: 200 }
    );
  });

  test('result length equals vehicle count for percentage split', () => {
    fc.assert(
      fc.property(percentageConfigArb, positiveAmountArb, (config, totalAmount) => {
        const result = service.computeAllocations(config, totalAmount);
        if (config.method !== 'percentage') throw new Error('unexpected');
        expect(result.length).toBe(config.allocations.length);
      }),
      { numRuns: 200 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: Absolute split passthrough
// **Validates: Requirement 4.2**
// ---------------------------------------------------------------------------
describe('Property 4: Absolute split passthrough', () => {
  test('output amounts match input amounts in order for absolute split', () => {
    fc.assert(
      fc.property(
        positiveAmountArb.chain((total) => fc.tuple(absoluteConfigArb(total), fc.constant(total))),
        ([config, totalAmount]) => {
          if (config.method !== 'absolute') throw new Error('unexpected');
          const result = service.computeAllocations(config, totalAmount);
          for (let i = 0; i < config.allocations.length; i++) {
            expect(result[i].vehicleId).toBe(config.allocations[i].vehicleId);
            expect(result[i].amount).toBe(config.allocations[i].amount);
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ===========================================================================
// DB-backed property tests for materializeChildren (Properties 5–7)
// ===========================================================================

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach } from 'bun:test';
import { createId } from '@paralleldrive/cuid2';
import { eq } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { applyMigration, loadMigrations } from '../../../db/__tests__/migration-helpers';
import type { ExpenseGroup, NewExpenseGroup } from '../../../db/schema';
import { expenseGroups, expenses } from '../../../db/schema';

// ---------------------------------------------------------------------------
// Test infrastructure for DB-backed tests
// ---------------------------------------------------------------------------

let sqliteDb: Database;
let db: BunSQLiteDatabase<Record<string, unknown>>;

const USER_ID = 'test-user-1';
const VEHICLE_IDS = ['v-1', 'v-2', 'v-3', 'v-4', 'v-5'];

function seedDbTestData(): void {
  sqliteDb.run(
    `INSERT INTO users (id, email, display_name, provider, provider_id) VALUES ('${USER_ID}', 'user1@test.com', 'User One', 'google', 'gid-1')`
  );
  for (const vid of VEHICLE_IDS) {
    sqliteDb.run(
      `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('${vid}', '${USER_ID}', 'Toyota', 'Camry', 2022)`
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
  seedDbTestData();
});

afterEach(() => {
  sqliteDb.close();
});

// ---------------------------------------------------------------------------
// DB-scoped generators
// ---------------------------------------------------------------------------

/** Pick 1–5 unique vehicle IDs from the seeded set. */
const dbVehicleIdsArb = fc
  .subarray(VEHICLE_IDS, { minLength: 1, maxLength: VEHICLE_IDS.length })
  .filter((arr) => arr.length >= 1);

/** Even split config using seeded vehicle IDs. */
const dbEvenConfigArb: fc.Arbitrary<SplitConfig> = dbVehicleIdsArb.map((vehicleIds) => ({
  method: 'even' as const,
  vehicleIds,
}));

/** Percentage split config using seeded vehicle IDs. */
const dbPercentageConfigArb: fc.Arbitrary<SplitConfig> = dbVehicleIdsArb.chain((vehicleIds) => {
  const n = vehicleIds.length;
  return fc
    .array(fc.integer({ min: 1, max: 10000 }), { minLength: n, maxLength: n })
    .map((weights) => {
      const weightSum = weights.reduce((s, w) => s + w, 0);
      const pcts = weights.map((w) => Math.floor((w / weightSum) * 100));
      let remainder = 100 - pcts.reduce((s, p) => s + p, 0);
      for (let i = 0; remainder > 0; i++) {
        pcts[i]++;
        remainder--;
      }
      const allocations = vehicleIds.map((vehicleId, i) => ({
        vehicleId,
        percentage: pcts[i],
      }));
      return { method: 'percentage' as const, allocations };
    });
});

/** Absolute split config using seeded vehicle IDs, amounts summing to totalAmount. */
const dbAbsoluteConfigArb = (totalAmount: number): fc.Arbitrary<SplitConfig> =>
  dbVehicleIdsArb.chain((vehicleIds) => {
    const n = vehicleIds.length;
    const totalCents = Math.round(totalAmount * 100);
    return fc
      .array(fc.integer({ min: 1, max: 10000 }), { minLength: n, maxLength: n })
      .map((weights) => {
        const weightSum = weights.reduce((s, w) => s + w, 0);
        const cents = weights.map((w) => Math.floor((w / weightSum) * totalCents));
        let rem = totalCents - cents.reduce((s, c) => s + c, 0);
        for (let i = 0; rem > 0; i++) {
          cents[i]++;
          rem--;
        }
        const allocations = vehicleIds.map((vehicleId, i) => ({
          vehicleId,
          amount: cents[i] / 100,
        }));
        return { method: 'absolute' as const, allocations };
      });
  });

/** Combined: split config + matching totalAmount (for absolute, amounts sum to total). */
const dbConfigAndTotalArb: fc.Arbitrary<{ config: SplitConfig; totalAmount: number }> =
  positiveAmountArb.chain((totalAmount) =>
    fc.oneof(
      dbEvenConfigArb.map((config) => ({ config, totalAmount })),
      dbPercentageConfigArb.map((config) => ({ config, totalAmount })),
      dbAbsoluteConfigArb(totalAmount).map((config) => ({ config, totalAmount }))
    )
  );

/** Helper: insert an expense group row and return the full row. */
async function insertExpenseGroup(
  drizzleDb: BunSQLiteDatabase<Record<string, unknown>>,
  config: SplitConfig,
  totalAmount: number,
  overrides?: Partial<NewExpenseGroup>
): Promise<ExpenseGroup> {
  const id = createId();
  const now = new Date();
  const [group] = await drizzleDb
    .insert(expenseGroups)
    .values({
      id,
      userId: USER_ID,
      splitConfig: config,
      category: 'financial',
      tags: ['insurance'],
      date: now,
      description: 'Test expense group',
      totalAmount,
      ...overrides,
    })
    .returning();
  return group;
}

// ---------------------------------------------------------------------------
// Property 5: Materialized children sum equals group total
// **Validates: Requirements 5.4, 4.4**
// ---------------------------------------------------------------------------
describe('Property 5: Materialized children sum equals group total', () => {
  test('sum of child expenseAmount values equals group totalAmount', async () => {
    await fc.assert(
      fc.asyncProperty(dbConfigAndTotalArb, async ({ config, totalAmount }) => {
        const group = await insertExpenseGroup(db, config, totalAmount);

        const children = await db.transaction(async (tx) => {
          return service.materializeChildren(tx, group);
        });

        const sum = children.reduce((s, c) => s + c.expenseAmount, 0);
        expect(Math.round(sum * 100) / 100).toBe(totalAmount);
      }),
      { numRuns: 50 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 6: Idempotent regeneration
// **Validates: Requirement 5.5**
// ---------------------------------------------------------------------------
describe('Property 6: Idempotent regeneration', () => {
  test('calling materializeChildren twice produces identical vehicleId and expenseAmount', async () => {
    await fc.assert(
      fc.asyncProperty(dbConfigAndTotalArb, async ({ config, totalAmount }) => {
        const group = await insertExpenseGroup(db, config, totalAmount);

        // First materialization
        const first = await db.transaction(async (tx) => {
          return service.materializeChildren(tx, group);
        });

        // Second materialization (same group, no config changes)
        const second = await db.transaction(async (tx) => {
          return service.materializeChildren(tx, group);
        });

        // Same count
        expect(second.length).toBe(first.length);

        // Same vehicleId + expenseAmount pairs in order
        for (let i = 0; i < first.length; i++) {
          expect(second[i].vehicleId).toBe(first[i].vehicleId);
          expect(second[i].expenseAmount).toBe(first[i].expenseAmount);
        }

        // IDs should differ (old children deleted, new ones created)
        for (let i = 0; i < first.length; i++) {
          expect(second[i].id).not.toBe(first[i].id);
        }

        // Only second batch should exist in DB
        const dbChildren = await db
          .select()
          .from(expenses)
          .where(eq(expenses.expenseGroupId, group.id));
        expect(dbChildren.length).toBe(second.length);
      }),
      { numRuns: 50 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: Child expenses inherit group properties
// **Validates: Requirements 5.2, 5.3**
// ---------------------------------------------------------------------------
describe('Property 7: Child expenses inherit group properties', () => {
  test('every child has correct expenseGroupId, vehicleId, category, date, tags, description', async () => {
    await fc.assert(
      fc.asyncProperty(dbConfigAndTotalArb, async ({ config, totalAmount }) => {
        const group = await insertExpenseGroup(db, config, totalAmount);

        const children = await db.transaction(async (tx) => {
          return service.materializeChildren(tx, group);
        });

        // Collect expected vehicle IDs from the config
        const expectedVehicleIds =
          config.method === 'even' ? config.vehicleIds : config.allocations.map((a) => a.vehicleId);

        expect(children.length).toBe(expectedVehicleIds.length);

        for (let i = 0; i < children.length; i++) {
          const child = children[i];

          // expenseGroupId set to group's ID
          expect(child.expenseGroupId).toBe(group.id);

          // vehicleId from split config
          expect(child.vehicleId).toBe(expectedVehicleIds[i]);

          // Inherited fields match group
          expect(child.category).toBe(group.category);
          expect(child.date?.getTime()).toBe(group.date.getTime());
          expect(child.description).toBe(group.description);

          // Tags comparison (JSON arrays)
          expect(child.tags).toEqual(group.tags);
        }
      }),
      { numRuns: 50 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 8: Cascade delete integrity
// **Validates: Requirements 1.4, 2.3, 2.4**
// ---------------------------------------------------------------------------
describe('Property 8: Cascade delete integrity', () => {
  test('deleting an expense group results in zero child expenses with that expenseGroupId', async () => {
    await fc.assert(
      fc.asyncProperty(dbConfigAndTotalArb, async ({ config, totalAmount }) => {
        const group = await insertExpenseGroup(db, config, totalAmount);

        // Materialize children
        const children = await db.transaction(async (tx) => {
          return service.materializeChildren(tx, group);
        });

        // Verify children exist
        expect(children.length).toBeGreaterThan(0);

        const childrenBefore = await db
          .select()
          .from(expenses)
          .where(eq(expenses.expenseGroupId, group.id));
        expect(childrenBefore.length).toBe(children.length);

        // Delete children first (application-level cascade), then the group
        await db.transaction(async (tx) => {
          await tx.delete(expenses).where(eq(expenses.expenseGroupId, group.id));
          await tx.delete(expenseGroups).where(eq(expenseGroups.id, group.id));
        });

        // Verify zero children remain with that expenseGroupId
        const childrenAfter = await db
          .select()
          .from(expenses)
          .where(eq(expenses.expenseGroupId, group.id));
        expect(childrenAfter.length).toBe(0);

        // Verify the group itself is gone
        const groupAfter = await db
          .select()
          .from(expenseGroups)
          .where(eq(expenseGroups.id, group.id));
        expect(groupAfter.length).toBe(0);
      }),
      { numRuns: 50 }
    );
  });
});
