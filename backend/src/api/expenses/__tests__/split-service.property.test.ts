/**
 * Property-Based Tests for ExpenseSplitService
 *
 * Pure computation tests (computeAllocations):
 * - Property 1: Allocation sum invariant
 * - Property 2: Even split fairness
 * - Property 3: Allocation count matches vehicle count
 * - Property 4: Absolute split passthrough
 *
 * DB-backed tests (createSiblings):
 * - Property 2 (Design): Split sibling consistency — all siblings share groupTotal, splitMethod, userId, category, date
 */

import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { ExpenseSplitService } from '../split-service';
import type { SplitConfig } from '../validation';

const service = new ExpenseSplitService();

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const vehicleIdArb = fc.stringMatching(/^v[a-z0-9]{1,10}$/);

/** 1–10 unique vehicle IDs */
const vehicleIdsArb = fc
  .uniqueArray(vehicleIdArb, { minLength: 1, maxLength: 10 })
  .filter((ids) => ids.length >= 1);

/** Positive money amount in integer CENTS (1 – 10_000_000 = $0.01 – $100k). money-cents-migration:
 * computeAllocations is now cents-native, so totalAmount + allocation amounts are integer cents. */
const positiveAmountArb = fc.integer({ min: 1, max: 10_000_000 }).filter((v) => v >= 1);

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
    const totalCents = totalAmount; // totalAmount is ALREADY integer cents (money-cents-migration)
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
          amount: cents[i], // integer cents
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
        expect(sum).toBe(totalAmount); // exact integer cents (money-cents-migration)
      }),
      { numRuns: 100 }
    );
  });

  test('sum of allocations equals totalAmount for absolute split', () => {
    fc.assert(
      fc.property(
        positiveAmountArb.chain((total) => fc.tuple(absoluteConfigArb(total), fc.constant(total))),
        ([config, totalAmount]) => {
          const result = service.computeAllocations(config, totalAmount);
          const sum = result.reduce((s, a) => s + a.amount, 0);
          expect(sum).toBe(totalAmount); // exact integer cents (money-cents-migration)
        }
      ),
      { numRuns: 100 }
    );
  });

  test('sum of allocations equals totalAmount for percentage split', () => {
    fc.assert(
      fc.property(percentageConfigArb, positiveAmountArb, (config, totalAmount) => {
        const result = service.computeAllocations(config, totalAmount);
        const sum = result.reduce((s, a) => s + a.amount, 0);
        expect(sum).toBe(totalAmount); // exact integer cents (money-cents-migration)
      }),
      { numRuns: 100 }
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
        // Integer cents now: even-split legs differ by at most 1 CENT (largest-remainder).
        expect(maxAmt - minAmt).toBeLessThanOrEqual(1);
      }),
      { numRuns: 100 }
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
      { numRuns: 100 }
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
      { numRuns: 100 }
    );
  });

  test('result length equals vehicle count for percentage split', () => {
    fc.assert(
      fc.property(percentageConfigArb, positiveAmountArb, (config, totalAmount) => {
        const result = service.computeAllocations(config, totalAmount);
        if (config.method !== 'percentage') throw new Error('unexpected');
        expect(result.length).toBe(config.allocations.length);
      }),
      { numRuns: 100 }
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
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// C287: deterministic percentage-split edge cases the property gens don't reach.
// The percentage path floors the first N-1 vehicles and assigns the EXACT remainder
// to the last (so the sum is precise), with a Math.max(0, ...) clamp guarding a
// negative remainder. The property tests pin the SUM; these pin the penny placement
// + the clamp branch (a >100% config reaching the pure fn — computeAllocations does
// NOT re-validate; only the route's Zod refinement gates the sum-to-100 invariant).
// ---------------------------------------------------------------------------
describe('C287: percentage split penny-residue + over-100% clamp', () => {
  // money-cents-migration: totalAmount is integer CENTS, so $100 = 10000 cents. The penny-residue
  // semantics are unchanged — they now play out in whole cents (floor(33% of 10000) = 3333, last = 3334).
  test('the LAST vehicle absorbs the rounding residue (33/33/34 of $100, exact sum)', () => {
    const result = service.computeAllocations(
      {
        method: 'percentage',
        allocations: [
          { vehicleId: 'v-1', percentage: 33 },
          { vehicleId: 'v-2', percentage: 33 },
          { vehicleId: 'v-3', percentage: 34 },
        ],
      },
      10000 // $100 in cents
    );
    // First two are floor(33% of 10000) = 3300 each; the last carries the remainder = 3400.
    expect(result.map((a) => a.amount)).toEqual([3300, 3300, 3400]);
    expect(result.reduce((s, a) => s + a.amount, 0)).toBe(10000);
  });

  test('thirds of a non-divisible total: floor the firsts, last absorbs the cents (sum exact)', () => {
    const result = service.computeAllocations(
      {
        method: 'percentage',
        allocations: [
          { vehicleId: 'v-1', percentage: 33.33 },
          { vehicleId: 'v-2', percentage: 33.33 },
          { vehicleId: 'v-3', percentage: 33.34 },
        ],
      },
      10000 // $100 in cents
    );
    // floor(33.33% of 10000) = 3333, floor(33.33%) = 3333, last = 10000 - 6666 = 3334.
    expect(result[0].amount).toBe(3333);
    expect(result[1].amount).toBe(3333);
    expect(result[2].amount).toBe(3334);
    expect(result.reduce((s, a) => s + a.amount, 0)).toBe(10000);
  });

  test('a config whose NON-LAST percentages exceed 100 clamps the last vehicle to 0 (no negative amount)', () => {
    // 60% + 60% + 10% of $100 (10000 cents). The pure fn does NOT re-validate (the route's Zod sum=100
    // refinement does), so the first two floored legs already run the total to 12000 cents BEFORE the last
    // leg — its remainder (10000-12000=-2000) must clamp to 0, never a negative allocation.
    const result = service.computeAllocations(
      {
        method: 'percentage',
        allocations: [
          { vehicleId: 'v-1', percentage: 60 },
          { vehicleId: 'v-2', percentage: 60 },
          { vehicleId: 'v-3', percentage: 10 },
        ],
      },
      10000 // $100 in cents
    );
    expect(result[0].amount).toBe(6000);
    expect(result[1].amount).toBe(6000);
    expect(result[2].amount).toBe(0); // clamped, not -2000
    expect(result.every((a) => a.amount >= 0)).toBe(true);
  });
});

// ===========================================================================
// DB-backed property tests for createSiblings
// ===========================================================================

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach } from 'bun:test';
import { createId } from '@paralleldrive/cuid2';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { applyMigration, loadMigrations } from '../../../db/__tests__/migration-helpers';
import type { AppDatabase } from '../../../db/connection';
import * as schema from '../../../db/schema';
import { expenses } from '../../../db/schema';

// ---------------------------------------------------------------------------
// Test infrastructure for DB-backed tests
// ---------------------------------------------------------------------------

let sqliteDb: Database;
let db: AppDatabase;

const USER_ID = 'test-user-1';
const VEHICLE_IDS = ['v-1', 'v-2', 'v-3', 'v-4', 'v-5'];

function seedDbTestData(): void {
  sqliteDb.run(
    `INSERT INTO users (id, email, display_name) VALUES ('${USER_ID}', 'user1@test.com', 'User One')`
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
  db = drizzle(sqliteDb, { schema });
  seedDbTestData();
});

afterEach(() => {
  sqliteDb.close();
});

// ---------------------------------------------------------------------------
// DB-scoped generators
// ---------------------------------------------------------------------------

/** Pick 2–5 unique vehicle IDs from the seeded set (min 2 for valid split). */
const dbVehicleIdsArb = fc
  .subarray(VEHICLE_IDS, { minLength: 2, maxLength: VEHICLE_IDS.length })
  .filter((arr) => arr.length >= 2);

/** Category arbitrary. */
const categoryArb = fc.constantFrom(
  'fuel',
  'maintenance',
  'financial',
  'regulatory',
  'enhancement',
  'misc'
);

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
    const totalCents = totalAmount; // totalAmount is ALREADY integer cents (money-cents-migration)
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
          amount: cents[i], // integer cents
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

// ---------------------------------------------------------------------------
// Helpers for sibling consistency verification
// ---------------------------------------------------------------------------

interface ExpenseRow {
  groupTotal: number | null;
  splitMethod: string | null;
  userId: string;
  category: string;
  date: Date | null;
  groupId: string | null;
  [key: string]: unknown;
}

function verifySiblingConsistency(
  siblings: ExpenseRow[],
  expected: {
    groupTotal: number;
    splitMethod: string;
    userId: string;
    category: string;
    dateTime: number;
    groupId: string;
  }
): void {
  for (const sibling of siblings) {
    expect(sibling.groupTotal).toBe(expected.groupTotal);
    expect(sibling.splitMethod).toBe(expected.splitMethod);
    expect(sibling.userId).toBe(expected.userId);
    expect(sibling.category).toBe(expected.category);
    expect(sibling.date?.getTime()).toBe(expected.dateTime);
    expect(sibling.groupId).toBe(expected.groupId);
  }
}

// ---------------------------------------------------------------------------
// Property 2 (Design): Split sibling consistency
// All siblings share groupTotal, splitMethod, userId, category, and date.
// **Validates: Requirements 5.2, 14.2**
// ---------------------------------------------------------------------------
describe('Property 2 (Design): Split sibling consistency', () => {
  test('all siblings created by createSiblings share identical groupTotal, splitMethod, userId, category, and date', async () => {
    await fc.assert(
      fc.asyncProperty(
        dbConfigAndTotalArb,
        categoryArb,
        async ({ config, totalAmount }, category) => {
          const allocations = service.computeAllocations(config, totalAmount);
          const groupId = createId();
          const splitMethod = config.method;
          const date = new Date(2024, 5, 15);

          const siblings = await db.transaction(async (tx) => {
            return service.createSiblings(tx, {
              groupId,
              userId: USER_ID,
              splitMethod,
              groupTotal: totalAmount,
              allocations,
              category,
              date,
            });
          });

          const expected = {
            groupTotal: totalAmount,
            splitMethod,
            userId: USER_ID,
            category,
            dateTime: date.getTime(),
            groupId,
          };

          // Verify returned siblings
          verifySiblingConsistency(siblings as ExpenseRow[], expected);

          // Verify the same consistency holds when reading back from DB
          const dbSiblings = await db.select().from(expenses).where(eq(expenses.groupId, groupId));

          expect(dbSiblings.length).toBe(siblings.length);
          verifySiblingConsistency(dbSiblings as ExpenseRow[], expected);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3 (Design): Split amounts sum EXACTLY to groupTotal (to the cent)
// computeAllocations is penny-exact by construction (Property 1 asserts the pure
// sum === totalAmount), so the persisted siblings must re-sum to the SAME CENT too.
// The original `< 0.02` tolerance was looser than that guarantee — it would let a
// real ±0.01 drift (one sibling off by a penny) pass silently. Assert cent-equality
// (round both to integer cents and compare) so a genuine penny-drift regression
// fails. (cycle 198)
// **Validates: Requirements 5.3, 14.3**
// ---------------------------------------------------------------------------
describe('Property 3 (Design): Split amounts sum to groupTotal', () => {
  test('sum of sibling expenseAmount values equals groupTotal to the cent', async () => {
    await fc.assert(
      fc.asyncProperty(
        dbConfigAndTotalArb,
        categoryArb,
        async ({ config, totalAmount }, category) => {
          const allocations = service.computeAllocations(config, totalAmount);
          const groupId = createId();
          const splitMethod = config.method;
          const date = new Date(2024, 5, 15);
          // totalAmount is integer cents (money-cents-migration); siblings re-sum to it EXACTLY.

          const siblings = await db.transaction(async (tx) => {
            return service.createSiblings(tx, {
              groupId,
              userId: USER_ID,
              splitMethod,
              groupTotal: totalAmount,
              allocations,
              category,
              date,
            });
          });

          // Verify from returned objects — exact integer-cent equality.
          const returnedSum = siblings.reduce((s, sib) => s + (sib.expenseAmount ?? 0), 0);
          expect(returnedSum).toBe(totalAmount);

          // Verify from DB read — integer cents round-trip exactly.
          const dbSiblings = await db.select().from(expenses).where(eq(expenses.groupId, groupId));

          const dbSum = dbSiblings.reduce((s, row) => s + (row.expenseAmount ?? 0), 0);
          expect(dbSum).toBe(totalAmount);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4 (Design): a split sibling is COST-ONLY — never carries fuel metrics (C311 deep-review).
// createSiblings hardcodes missedFillup:false and never sets volume/mileage/fuelType (the create-split
// schema has NO input path for them — splitting a SHARED cost across vehicles can't attribute a physical
// volume/odometer to each leg). So even a category:'fuel' split is a pure cost row: volume/mileage/fuelType
// stay null + missedFillup stays false. This matters because computeEfficiencyPoint / the fuel-stats fillup
// count key off volume — a regression that started stamping a volume on split siblings would silently
// pollute MPG attribution + double-count fillups. Pin the contract so that change can't land unnoticed.
// ---------------------------------------------------------------------------
describe('Property 4 (Design): split siblings are cost-only (no fuel metrics, even for category:fuel)', () => {
  test('every sibling has null volume/mileage/fuelType + missedFillup=false across all categories', async () => {
    await fc.assert(
      fc.asyncProperty(
        dbConfigAndTotalArb,
        categoryArb,
        async ({ config, totalAmount }, category) => {
          const allocations = service.computeAllocations(config, totalAmount);
          const groupId = createId();

          await db.transaction(async (tx) => {
            return service.createSiblings(tx, {
              groupId,
              userId: USER_ID,
              splitMethod: config.method,
              groupTotal: totalAmount,
              allocations,
              category, // includes 'fuel' from categoryArb — must STILL be cost-only
              date: new Date(2024, 5, 15),
            });
          });

          const dbSiblings = await db.select().from(expenses).where(eq(expenses.groupId, groupId));
          expect(dbSiblings.length).toBeGreaterThan(0);
          for (const row of dbSiblings) {
            expect(row.volume).toBeNull();
            expect(row.mileage).toBeNull();
            expect(row.fuelType).toBeNull();
            expect(row.missedFillup).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
