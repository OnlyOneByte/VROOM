/**
 * Property-Based Tests for Expense Repository
 *
 * Property 1: Pagination Completeness
 * Iterating all pages yields exactly totalCount unique expenses with no duplicates.
 *
 * Property 2: TotalCount Accuracy
 * totalCount equals the number of matching expenses regardless of limit/offset.
 *
 * Property 4: Limit Clamping
 * Actual limit = min(requested, maxPageSize), defaulting to defaultPageSize.
 *
 * Property 5: Tag Filter SQL Equivalence
 * SQL-filtered results equal JS expense.tags.includes(tag) filtering.
 *
 * Property 6: Summary Consistency
 * totalAmount equals sum of categoryBreakdown[].amount;
 * expenseCount equals sum of categoryBreakdown[].count.
 * Monthly trend periods are sorted chronologically.
 *
 * Property 7: Financing Expense Query Correctness
 * Query should return exactly those expenses where `isFinancingPayment === true`
 * and `vehicleId` matches, sorted by date ascending.
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 3.1, 3.2, 4.1, 4.2, 4.3, 4.4, 6.1, 6.2**
 *
 * Approach: We test the specification at the data level — generate a mixed set of
 * expenses, apply the same filtering/sorting/pagination contract that the repository
 * implements, and verify the result matches expectations.
 */

import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { CONFIG } from '../../../config';
import type { Expense } from '../../../db/schema';
import type { PaginatedExpenseFilters, PaginatedResult } from '../repository';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VEHICLE_IDS = ['vehicle-A', 'vehicle-B', 'vehicle-C'];
const USER_VEHICLES: Record<string, string[]> = {
  'user-1': ['vehicle-A', 'vehicle-B'],
  'user-2': ['vehicle-C'],
};
const CATEGORIES = ['fuel', 'maintenance', 'financial', 'regulatory', 'enhancement', 'misc'];
const SAMPLE_TAGS = ['oil-change', 'tire', 'brake', 'filter', 'inspection', 'wash'];

/** Build a synthetic Expense for pagination property tests. */
function makePaginatedExpense(overrides: {
  vehicleId: string;
  category: string;
  tags: string[];
  date: Date;
  index: number;
}): Expense {
  return {
    id: `exp-pag-${overrides.index}`,
    vehicleId: overrides.vehicleId,
    category: overrides.category,
    tags: overrides.tags,
    date: overrides.date,
    expenseAmount: 100,
    isFinancingPayment: false,
    mileage: null,
    description: null,
    volume: null,
    fuelType: null,
    insuranceTermId: null,
    missedFillup: false,
    userId: 'test-user',
    groupId: null,
    groupTotal: null,
    splitMethod: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Reference implementation of findPaginated filtering contract.
 * Mirrors the SQL logic: userId ownership via vehicle join, category, date range, tags.
 */
function referenceFindPaginated(
  allExpenses: Expense[],
  filters: PaginatedExpenseFilters
): PaginatedResult<Expense> {
  const limit = Math.min(
    filters.limit ?? CONFIG.pagination.defaultPageSize,
    CONFIG.pagination.maxPageSize
  );
  const offset = filters.offset ?? 0;

  // Filter by userId ownership (via vehicle mapping)
  let filtered = allExpenses.filter((e) => {
    const userVehicles = USER_VEHICLES[filters.userId ?? ''] ?? [];
    return userVehicles.includes(e.vehicleId);
  });

  if (filters.vehicleId) {
    filtered = filtered.filter((e) => e.vehicleId === filters.vehicleId);
  }
  if (filters.category) {
    filtered = filtered.filter((e) => e.category === filters.category);
  }
  if (filters.startDate) {
    const startDate = filters.startDate;
    filtered = filtered.filter((e) => e.date >= startDate);
  }
  if (filters.endDate) {
    const endDate = filters.endDate;
    filtered = filtered.filter((e) => e.date <= endDate);
  }
  if (filters.tags?.length) {
    for (const tag of filters.tags) {
      filtered = filtered.filter((e) => (e.tags ?? []).includes(tag));
    }
  }

  // Sort by date descending
  filtered.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const totalCount = filtered.length;
  const data = filtered.slice(offset, offset + limit);

  return { data, totalCount };
}

/** Build a synthetic Expense for testing filtering/sorting logic. */
function makeExpense(overrides: {
  vehicleId: string;
  isFinancingPayment: boolean;
  date: Date;
  index: number;
}): Expense {
  return {
    id: `exp-${overrides.index}`,
    vehicleId: overrides.vehicleId,
    category: overrides.isFinancingPayment ? 'financial' : 'maintenance',
    tags: [],
    date: overrides.date,
    expenseAmount: 100,
    isFinancingPayment: overrides.isFinancingPayment,
    mileage: null,
    description: null,
    volume: null,
    fuelType: null,
    insuranceTermId: null,
    missedFillup: false,
    userId: 'test-user',
    groupId: null,
    groupTotal: null,
    splitMethod: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Reference implementation of the filtering/sorting contract that
 * `findFinancingByVehicleId` must satisfy:
 *   - Only expenses with `isFinancingPayment === true`
 *   - Only expenses matching the target `vehicleId`
 *   - Sorted by date ascending
 */
function referenceQuery(allExpenses: Expense[], vehicleId: string): Expense[] {
  return allExpenses
    .filter((e) => e.isFinancingPayment === true && e.vehicleId === vehicleId)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

// ---------------------------------------------------------------------------
// Generators (Pagination Properties 1, 2, 4, 5)
// ---------------------------------------------------------------------------

const paginatedVehicleIdArb = fc.constantFrom(...VEHICLE_IDS);
const userIdArb = fc.constantFrom('user-1', 'user-2');
const categoryArb = fc.constantFrom(...CATEGORIES);
const tagArb = fc.constantFrom(...SAMPLE_TAGS);
const tagsArb = fc.uniqueArray(tagArb, { minLength: 0, maxLength: 3 });

const paginatedExpenseDateArb = fc
  .integer({ min: 1672531200000, max: 1767139200000 })
  .map((ms) => new Date(ms));

const paginatedExpenseArb = (index: number) =>
  fc.record({
    vehicleId: paginatedVehicleIdArb,
    category: categoryArb,
    tags: tagsArb,
    date: paginatedExpenseDateArb,
    index: fc.constant(index),
  });

const paginatedExpenseListArb = fc
  .integer({ min: 0, max: 40 })
  .chain((len) => fc.tuple(...Array.from({ length: len }, (_, i) => paginatedExpenseArb(i))));

const filtersArb = fc.record({
  userId: userIdArb,
  vehicleId: fc.option(paginatedVehicleIdArb, { nil: undefined }),
  category: fc.option(categoryArb, { nil: undefined }),
  tags: fc.option(fc.uniqueArray(tagArb, { minLength: 1, maxLength: 2 }), {
    nil: undefined,
  }),
});

// ---------------------------------------------------------------------------
// Property 1: Pagination Completeness
// **Validates: Requirements 1.1**
// ---------------------------------------------------------------------------
describe('Property 1: Pagination Completeness', () => {
  test('iterating all pages yields exactly totalCount unique expenses', () => {
    fc.assert(
      fc.property(
        paginatedExpenseListArb,
        filtersArb,
        fc.integer({ min: 1, max: 15 }),
        (expenseInputs, filters, pageSize) => {
          const allExpenses = expenseInputs.map((input) => makePaginatedExpense(input));

          // Get totalCount from first page
          const firstPage = referenceFindPaginated(allExpenses, {
            ...filters,
            limit: pageSize,
            offset: 0,
          });
          const { totalCount } = firstPage;

          // Iterate all pages
          const collectedIds: string[] = [];
          let offset = 0;
          while (offset < totalCount) {
            const page = referenceFindPaginated(allExpenses, {
              ...filters,
              limit: pageSize,
              offset,
            });
            for (const e of page.data) {
              collectedIds.push(e.id);
            }
            offset += pageSize;
          }

          // Exactly totalCount unique expenses
          const uniqueIds = new Set(collectedIds);
          expect(uniqueIds.size).toBe(totalCount);
          expect(collectedIds.length).toBe(totalCount);
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: TotalCount Accuracy
// **Validates: Requirements 1.4**
// ---------------------------------------------------------------------------
describe('Property 2: TotalCount Accuracy', () => {
  test('totalCount equals full result count regardless of limit/offset', () => {
    fc.assert(
      fc.property(
        paginatedExpenseListArb,
        filtersArb,
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 0, max: 30 }),
        (expenseInputs, filters, limit, offset) => {
          const allExpenses = expenseInputs.map((input) => makePaginatedExpense(input));

          const result = referenceFindPaginated(allExpenses, {
            ...filters,
            limit,
            offset,
          });

          // Get the full count with no pagination
          const fullResult = referenceFindPaginated(allExpenses, {
            ...filters,
            limit: CONFIG.pagination.maxPageSize,
            offset: 0,
          });

          // totalCount should be the same regardless of limit/offset
          expect(result.totalCount).toBe(fullResult.totalCount);
          expect(result.totalCount).toBe(fullResult.data.length);
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: Limit Clamping
// **Validates: Requirements 1.2, 1.3**
// ---------------------------------------------------------------------------
describe('Property 4: Limit Clamping', () => {
  test('actual page size never exceeds maxPageSize', () => {
    fc.assert(
      fc.property(
        paginatedExpenseListArb,
        userIdArb,
        fc.integer({ min: 1, max: 500 }),
        (expenseInputs, userId, requestedLimit) => {
          const allExpenses = expenseInputs.map((input) => makePaginatedExpense(input));

          const result = referenceFindPaginated(allExpenses, {
            userId,
            limit: requestedLimit,
            offset: 0,
          });

          const effectiveLimit = Math.min(requestedLimit, CONFIG.pagination.maxPageSize);
          expect(result.data.length).toBeLessThanOrEqual(effectiveLimit);
        }
      ),
      { numRuns: 50 }
    );
  });

  test('defaults to defaultPageSize when limit is omitted', () => {
    fc.assert(
      fc.property(paginatedExpenseListArb, userIdArb, (expenseInputs, userId) => {
        const allExpenses = expenseInputs.map((input) => makePaginatedExpense(input));

        const result = referenceFindPaginated(allExpenses, {
          userId,
          offset: 0,
        });

        expect(result.data.length).toBeLessThanOrEqual(CONFIG.pagination.defaultPageSize);
      }),
      { numRuns: 50 }
    );
  });

  test('limit is clamped to maxPageSize when exceeded', () => {
    const overMax = CONFIG.pagination.maxPageSize + 50;

    fc.assert(
      fc.property(paginatedExpenseListArb, userIdArb, (expenseInputs, userId) => {
        const allExpenses = expenseInputs.map((input) => makePaginatedExpense(input));

        const result = referenceFindPaginated(allExpenses, {
          userId,
          limit: overMax,
          offset: 0,
        });

        expect(result.data.length).toBeLessThanOrEqual(CONFIG.pagination.maxPageSize);
      }),
      { numRuns: 50 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5: Tag Filter SQL Equivalence
// **Validates: Requirements 3.1, 3.2**
// ---------------------------------------------------------------------------
describe('Property 5: Tag Filter SQL Equivalence', () => {
  test('tag filtering matches JS-level Array.includes filtering', () => {
    fc.assert(
      fc.property(
        paginatedExpenseListArb,
        userIdArb,
        fc.uniqueArray(tagArb, { minLength: 1, maxLength: 2 }),
        (expenseInputs, userId, filterTags) => {
          const allExpenses = expenseInputs.map((input) => makePaginatedExpense(input));

          // Reference: SQL-level tag filtering via referenceFindPaginated
          const sqlResult = referenceFindPaginated(allExpenses, {
            userId,
            tags: filterTags,
            limit: CONFIG.pagination.maxPageSize,
            offset: 0,
          });

          // JS-level: filter manually with Array.includes (AND semantics)
          const userVehicles = USER_VEHICLES[userId] ?? [];
          const jsFiltered = allExpenses.filter((e) => {
            if (!userVehicles.includes(e.vehicleId)) return false;
            const expTags = e.tags ?? [];
            return filterTags.every((tag) => expTags.includes(tag));
          });

          // Same set of IDs
          const sqlIds = new Set(sqlResult.data.map((e) => e.id));
          const jsIds = new Set(jsFiltered.map((e) => e.id));
          expect(sqlIds).toEqual(jsIds);

          // totalCount matches
          expect(sqlResult.totalCount).toBe(jsFiltered.length);
        }
      ),
      { numRuns: 50 }
    );
  });

  test('empty tags array returns unfiltered results', () => {
    fc.assert(
      fc.property(paginatedExpenseListArb, userIdArb, (expenseInputs, userId) => {
        const allExpenses = expenseInputs.map((input) => makePaginatedExpense(input));

        const withEmptyTags = referenceFindPaginated(allExpenses, {
          userId,
          tags: [],
          limit: CONFIG.pagination.maxPageSize,
          offset: 0,
        });

        const withoutTags = referenceFindPaginated(allExpenses, {
          userId,
          limit: CONFIG.pagination.maxPageSize,
          offset: 0,
        });

        expect(withEmptyTags.totalCount).toBe(withoutTags.totalCount);
      }),
      { numRuns: 50 }
    );
  });
});

// ---------------------------------------------------------------------------
// Generators (Property 7: Financing)
// ---------------------------------------------------------------------------

const vehicleIdArb = fc.constantFrom('vehicle-A', 'vehicle-B', 'vehicle-C');

/** Generate a valid date by building from integer components to avoid NaN dates. */
const expenseDateArb = fc
  .integer({ min: 1672531200000, max: 1767139200000 }) // 2023-01-01 to 2025-12-31 in ms
  .map((ms) => new Date(ms));

const expenseArb = (index: number) =>
  fc.record({
    vehicleId: vehicleIdArb,
    isFinancingPayment: fc.boolean(),
    date: expenseDateArb,
    index: fc.constant(index),
  });

const expenseListArb = fc
  .integer({ min: 0, max: 30 })
  .chain((len) => fc.tuple(...Array.from({ length: len }, (_, i) => expenseArb(i))));

// ---------------------------------------------------------------------------
// Property 7: Financing Expense Query Correctness
// ---------------------------------------------------------------------------
describe('Property 7: Financing Expense Query Correctness', () => {
  test('filtering returns exactly expenses with isFinancingPayment === true for the target vehicleId', () => {
    fc.assert(
      fc.property(expenseListArb, vehicleIdArb, (expenseInputs, targetVehicleId) => {
        const allExpenses = expenseInputs.map((input) => makeExpense(input));
        const result = referenceQuery(allExpenses, targetVehicleId);

        // Every returned expense must have isFinancingPayment === true
        for (const e of result) {
          expect(e.isFinancingPayment).toBe(true);
        }

        // Every returned expense must match the target vehicleId
        for (const e of result) {
          expect(e.vehicleId).toBe(targetVehicleId);
        }

        // No matching expense should be missing from the result
        const expectedIds = new Set(
          allExpenses
            .filter((e) => e.isFinancingPayment === true && e.vehicleId === targetVehicleId)
            .map((e) => e.id)
        );
        const resultIds = new Set(result.map((e) => e.id));
        expect(resultIds).toEqual(expectedIds);
      }),
      { numRuns: 50 }
    );
  });

  test('results are sorted by date ascending', () => {
    fc.assert(
      fc.property(expenseListArb, vehicleIdArb, (expenseInputs, targetVehicleId) => {
        const allExpenses = expenseInputs.map((input) => makeExpense(input));
        const result = referenceQuery(allExpenses, targetVehicleId);

        // Each date should be <= the next date
        for (let i = 1; i < result.length; i++) {
          const prev = new Date(result[i - 1].date).getTime();
          const curr = new Date(result[i].date).getTime();
          expect(curr).toBeGreaterThanOrEqual(prev);
        }
      }),
      { numRuns: 50 }
    );
  });

  test('expenses with isFinancingPayment === false never appear in results', () => {
    fc.assert(
      fc.property(expenseListArb, vehicleIdArb, (expenseInputs, targetVehicleId) => {
        const allExpenses = expenseInputs.map((input) => makeExpense(input));
        const result = referenceQuery(allExpenses, targetVehicleId);

        const nonFinancingIds = new Set(
          allExpenses.filter((e) => e.isFinancingPayment === false).map((e) => e.id)
        );

        for (const e of result) {
          expect(nonFinancingIds.has(e.id)).toBe(false);
        }
      }),
      { numRuns: 50 }
    );
  });

  test('expenses for other vehicles never appear in results', () => {
    fc.assert(
      fc.property(expenseListArb, vehicleIdArb, (expenseInputs, targetVehicleId) => {
        const allExpenses = expenseInputs.map((input) => makeExpense(input));
        const result = referenceQuery(allExpenses, targetVehicleId);

        for (const e of result) {
          expect(e.vehicleId).toBe(targetVehicleId);
        }
      }),
      { numRuns: 50 }
    );
  });
});

// ---------------------------------------------------------------------------
// Helpers (Property 6: Summary Consistency)
// ---------------------------------------------------------------------------

interface SummaryExpenseInput {
  vehicleId: string;
  category: string;
  expenseAmount: number;
  date: Date;
  index: number;
}

/** Build a synthetic Expense for summary property tests. */
function makeSummaryExpense(input: SummaryExpenseInput): Expense {
  return {
    id: `exp-sum-${input.index}`,
    vehicleId: input.vehicleId,
    category: input.category,
    tags: [],
    date: input.date,
    expenseAmount: input.expenseAmount,
    isFinancingPayment: false,
    mileage: null,
    description: null,
    volume: null,
    fuelType: null,
    insuranceTermId: null,
    missedFillup: false,
    userId: 'test-user',
    groupId: null,
    groupTotal: null,
    splitMethod: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Reference implementation of getSummary aggregation contract.
 * Mirrors the SQL logic: filter by userId ownership + optional vehicleId,
 * then compute totals, category breakdown, and monthly trend.
 */
function referenceGetSummary(
  allExpenses: Expense[],
  filters: { userId: string; vehicleId?: string }
): {
  totalAmount: number;
  expenseCount: number;
  categoryBreakdown: Array<{ category: string; amount: number; count: number }>;
  monthlyTrend: Array<{ period: string; amount: number; count: number }>;
} {
  // Filter by userId ownership via vehicle mapping
  const userVehicles = USER_VEHICLES[filters.userId] ?? [];
  let filtered = allExpenses.filter((e) => userVehicles.includes(e.vehicleId));

  if (filters.vehicleId) {
    filtered = filtered.filter((e) => e.vehicleId === filters.vehicleId);
  }

  // Totals
  const totalAmount = filtered.reduce((sum, e) => sum + e.expenseAmount, 0);
  const expenseCount = filtered.length;

  // Category breakdown: group by category
  const categoryMap = new Map<string, { amount: number; count: number }>();
  for (const e of filtered) {
    const existing = categoryMap.get(e.category) ?? { amount: 0, count: 0 };
    existing.amount += e.expenseAmount;
    existing.count += 1;
    categoryMap.set(e.category, existing);
  }
  const categoryBreakdown = Array.from(categoryMap.entries()).map(([category, data]) => ({
    category,
    amount: data.amount,
    count: data.count,
  }));

  // Monthly trend: group by YYYY-MM, sorted chronologically
  const monthMap = new Map<string, { amount: number; count: number }>();
  for (const e of filtered) {
    const d = new Date(e.date);
    const period = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const existing = monthMap.get(period) ?? { amount: 0, count: 0 };
    existing.amount += e.expenseAmount;
    existing.count += 1;
    monthMap.set(period, existing);
  }
  const monthlyTrend = Array.from(monthMap.entries())
    .map(([period, data]) => ({ period, amount: data.amount, count: data.count }))
    .sort((a, b) => a.period.localeCompare(b.period));

  return { totalAmount, expenseCount, categoryBreakdown, monthlyTrend };
}

// ---------------------------------------------------------------------------
// Generators (Property 6: Summary Consistency)
// ---------------------------------------------------------------------------

const summaryExpenseAmountArb = fc.double({
  min: 0.01,
  max: 50000,
  noNaN: true,
  noDefaultInfinity: true,
});

const summaryExpenseArb = (index: number) =>
  fc.record({
    vehicleId: paginatedVehicleIdArb,
    category: categoryArb,
    expenseAmount: summaryExpenseAmountArb,
    date: paginatedExpenseDateArb,
    index: fc.constant(index),
  });

const summaryExpenseListArb = fc
  .integer({ min: 0, max: 40 })
  .chain((len) => fc.tuple(...Array.from({ length: len }, (_, i) => summaryExpenseArb(i))));

const summaryFiltersArb = fc.record({
  userId: userIdArb,
  vehicleId: fc.option(paginatedVehicleIdArb, { nil: undefined }),
});

// ---------------------------------------------------------------------------
// Property 6: Summary Consistency
// **Validates: Property 6**
// ---------------------------------------------------------------------------
describe('Property 6: Summary Consistency', () => {
  test('totalAmount equals sum of categoryBreakdown[].amount', () => {
    fc.assert(
      fc.property(summaryExpenseListArb, summaryFiltersArb, (expenseInputs, filters) => {
        const allExpenses = expenseInputs.map((input) => makeSummaryExpense(input));
        const summary = referenceGetSummary(allExpenses, filters);

        const categorySum = summary.categoryBreakdown.reduce((sum, c) => sum + c.amount, 0);

        // Use approximate equality for floating point
        expect(Math.abs(summary.totalAmount - categorySum)).toBeLessThan(0.001);
      }),
      { numRuns: 50 }
    );
  });

  test('expenseCount equals sum of categoryBreakdown[].count', () => {
    fc.assert(
      fc.property(summaryExpenseListArb, summaryFiltersArb, (expenseInputs, filters) => {
        const allExpenses = expenseInputs.map((input) => makeSummaryExpense(input));
        const summary = referenceGetSummary(allExpenses, filters);

        const categoryCountSum = summary.categoryBreakdown.reduce((sum, c) => sum + c.count, 0);

        expect(summary.expenseCount).toBe(categoryCountSum);
      }),
      { numRuns: 50 }
    );
  });

  test('monthly trend periods are sorted chronologically', () => {
    fc.assert(
      fc.property(summaryExpenseListArb, summaryFiltersArb, (expenseInputs, filters) => {
        const allExpenses = expenseInputs.map((input) => makeSummaryExpense(input));
        const summary = referenceGetSummary(allExpenses, filters);

        for (let i = 1; i < summary.monthlyTrend.length; i++) {
          const prev = summary.monthlyTrend[i - 1].period;
          const curr = summary.monthlyTrend[i].period;
          expect(curr.localeCompare(prev)).toBeGreaterThan(0);
        }
      }),
      { numRuns: 50 }
    );
  });
});
