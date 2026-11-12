import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { ExpenseSplitService } from '../split-service';
import type { SplitConfig } from '../validation';

const service = new ExpenseSplitService();

const vehicleIdArb = fc.stringMatching(/^v[a-z0-9]{1,10}$/);

const vehicleIdsArb = fc
  .uniqueArray(vehicleIdArb, { minLength: 1, maxLength: 10 })
  .filter((ids) => ids.length >= 1);

const positiveAmountArb = fc.integer({ min: 1, max: 10_000_000 }).filter((v) => v >= 1);

const evenConfigArb: fc.Arbitrary<SplitConfig> = vehicleIdsArb.map((vehicleIds) => ({
  method: 'even' as const,
  vehicleIds,
}));

const absoluteConfigArb = (totalAmount: number): fc.Arbitrary<SplitConfig> =>
  vehicleIdsArb.chain((vehicleIds) => {
    const n = vehicleIds.length;
    const totalCents = totalAmount;
    return fc
      .array(fc.integer({ min: 1, max: 10000 }), { minLength: n, maxLength: n })
      .map((weights) => {
        const weightSum = weights.reduce((s, w) => s + w, 0);
        const cents = weights.map((w) => Math.floor((w / weightSum) * totalCents));
        let remainder = totalCents - cents.reduce((s, c) => s + c, 0);
        for (let i = 0; remainder > 0; i++) {
          cents[i]++;
          remainder--;
        }
        const allocations = vehicleIds.map((vehicleId, i) => ({
          vehicleId,
          amount: cents[i],
        }));
        return { method: 'absolute' as const, allocations };
      });
  });

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

describe('Allocation sum invariant', () => {
  test('sum of allocations equals totalAmount for even split', () => {
    fc.assert(
      fc.property(evenConfigArb, positiveAmountArb, (config, totalAmount) => {
        const result = service.computeAllocations(config, totalAmount);
        const sum = result.reduce((s, a) => s + a.amount, 0);
        expect(sum).toBe(totalAmount);
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
          expect(sum).toBe(totalAmount);
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
        expect(sum).toBe(totalAmount);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Even split fairness', () => {
  test('max amount minus min amount is at most 0.01 for even splits', () => {
    fc.assert(
      fc.property(evenConfigArb, positiveAmountArb, (config, totalAmount) => {
        const result = service.computeAllocations(config, totalAmount);
        const amounts = result.map((a) => a.amount);
        const maxAmt = Math.max(...amounts);
        const minAmt = Math.min(...amounts);
        expect(maxAmt - minAmt).toBeLessThanOrEqual(1);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Allocation count matches vehicle count', () => {
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

describe('Absolute split passthrough', () => {
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

describe('percentage split penny-residue + over-100% clamp', () => {
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
      10000
    );
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
      10000
    );
    expect(result[0].amount).toBe(3333);
    expect(result[1].amount).toBe(3333);
    expect(result[2].amount).toBe(3334);
    expect(result.reduce((s, a) => s + a.amount, 0)).toBe(10000);
  });

  test('a config whose NON-LAST percentages exceed 100 clamps the last vehicle to 0 (no negative amount)', () => {
    const result = service.computeAllocations(
      {
        method: 'percentage',
        allocations: [
          { vehicleId: 'v-1', percentage: 60 },
          { vehicleId: 'v-2', percentage: 60 },
          { vehicleId: 'v-3', percentage: 10 },
        ],
      },
      10000
    );
    expect(result[0].amount).toBe(6000);
    expect(result[1].amount).toBe(6000);
    expect(result[2].amount).toBe(0);
    expect(result.every((a) => a.amount >= 0)).toBe(true);
  });
});

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach } from 'bun:test';
import { createId } from '@paralleldrive/cuid2';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { applyMigration, loadMigrations } from '../../../db/__tests__/migration-helpers';
import type { AppDatabase } from '../../../db/connection';
import * as schema from '../../../db/schema';
import { expenses } from '../../../db/schema';

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

const dbVehicleIdsArb = fc
  .subarray(VEHICLE_IDS, { minLength: 2, maxLength: VEHICLE_IDS.length })
  .filter((arr) => arr.length >= 2);

const categoryArb = fc.constantFrom(
  'fuel',
  'maintenance',
  'financial',
  'regulatory',
  'enhancement',
  'misc'
);

const dbEvenConfigArb: fc.Arbitrary<SplitConfig> = dbVehicleIdsArb.map((vehicleIds) => ({
  method: 'even' as const,
  vehicleIds,
}));

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

const dbAbsoluteConfigArb = (totalAmount: number): fc.Arbitrary<SplitConfig> =>
  dbVehicleIdsArb.chain((vehicleIds) => {
    const n = vehicleIds.length;
    const totalCents = totalAmount;
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
          amount: cents[i],
        }));
        return { method: 'absolute' as const, allocations };
      });
  });

const dbConfigAndTotalArb: fc.Arbitrary<{ config: SplitConfig; totalAmount: number }> =
  positiveAmountArb.chain((totalAmount) =>
    fc.oneof(
      dbEvenConfigArb.map((config) => ({ config, totalAmount })),
      dbPercentageConfigArb.map((config) => ({ config, totalAmount })),
      dbAbsoluteConfigArb(totalAmount).map((config) => ({ config, totalAmount }))
    )
  );

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

describe('Split sibling consistency', () => {
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

          verifySiblingConsistency(siblings as ExpenseRow[], expected);

          const dbSiblings = await db.select().from(expenses).where(eq(expenses.groupId, groupId));

          expect(dbSiblings.length).toBe(siblings.length);
          verifySiblingConsistency(dbSiblings as ExpenseRow[], expected);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Split amounts sum to groupTotal', () => {
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

          const returnedSum = siblings.reduce((s, sib) => s + (sib.expenseAmount ?? 0), 0);
          expect(returnedSum).toBe(totalAmount);

          const dbSiblings = await db.select().from(expenses).where(eq(expenses.groupId, groupId));

          const dbSum = dbSiblings.reduce((s, row) => s + (row.expenseAmount ?? 0), 0);
          expect(dbSum).toBe(totalAmount);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('split siblings are cost-only (no fuel metrics, even for category:fuel)', () => {
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
              category,
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
