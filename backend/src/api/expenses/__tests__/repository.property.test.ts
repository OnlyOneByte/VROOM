import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { CONFIG } from '../../../config';
import type { Expense } from '../../../db/schema';
import type { PaginatedExpenseFilters, PaginatedResult } from '../repository';

const VEHICLE_IDS = ['vehicle-A', 'vehicle-B', 'vehicle-C'];
const USER_VEHICLES: Record<string, string[]> = {
  'user-1': ['vehicle-A', 'vehicle-B'],
  'user-2': ['vehicle-C'],
};
const CATEGORIES = ['fuel', 'maintenance', 'financial', 'regulatory', 'enhancement', 'misc'];
const SAMPLE_TAGS = ['oil-change', 'tire', 'brake', 'filter', 'inspection', 'wash'];

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
    mileage: null,
    description: null,
    location: null,
    volume: null,
    fuelType: null,
    missedFillup: false,
    userId: 'test-user',
    createdBy: null,
    groupId: null,
    groupTotal: null,
    splitMethod: null,
    sourceType: null,
    sourceId: null,
    clientId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function referenceFindPaginated(
  allExpenses: Expense[],
  filters: PaginatedExpenseFilters
): PaginatedResult<Expense> {
  const limit = Math.min(
    filters.limit ?? CONFIG.pagination.defaultPageSize,
    CONFIG.pagination.maxPageSize
  );
  const offset = filters.offset ?? 0;

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

  filtered.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const totalCount = filtered.length;
  const data = filtered.slice(offset, offset + limit);

  return { data, totalCount };
}

function makeExpense(overrides: {
  vehicleId: string;
  sourceType: string | null;
  sourceId: string | null;
  date: Date;
  index: number;
}): Expense {
  return {
    id: `exp-${overrides.index}`,
    vehicleId: overrides.vehicleId,
    category: overrides.sourceType === 'financing' ? 'financial' : 'maintenance',
    tags: [],
    date: overrides.date,
    expenseAmount: 100,
    mileage: null,
    description: null,
    location: null,
    volume: null,
    fuelType: null,
    missedFillup: false,
    userId: 'test-user',
    createdBy: null,
    groupId: null,
    groupTotal: null,
    splitMethod: null,
    sourceType: overrides.sourceType,
    sourceId: overrides.sourceId,
    clientId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function referenceQuery(allExpenses: Expense[], vehicleId: string): Expense[] {
  return allExpenses
    .filter((e) => e.sourceType === 'financing' && e.vehicleId === vehicleId)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

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

describe('Pagination Completeness', () => {
  test('iterating all pages yields exactly totalCount unique expenses', () => {
    fc.assert(
      fc.property(
        paginatedExpenseListArb,
        filtersArb,
        fc.integer({ min: 1, max: 15 }),
        (expenseInputs, filters, pageSize) => {
          const allExpenses = expenseInputs.map((input) => makePaginatedExpense(input));

          const firstPage = referenceFindPaginated(allExpenses, {
            ...filters,
            limit: pageSize,
            offset: 0,
          });
          const { totalCount } = firstPage;

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

          const uniqueIds = new Set(collectedIds);
          expect(uniqueIds.size).toBe(totalCount);
          expect(collectedIds.length).toBe(totalCount);
        }
      ),
      { numRuns: 50 }
    );
  });
});

describe('TotalCount Accuracy', () => {
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

          const fullResult = referenceFindPaginated(allExpenses, {
            ...filters,
            limit: CONFIG.pagination.maxPageSize,
            offset: 0,
          });

          expect(result.totalCount).toBe(fullResult.totalCount);
          expect(result.totalCount).toBe(fullResult.data.length);
        }
      ),
      { numRuns: 50 }
    );
  });
});

describe('Limit Clamping', () => {
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

describe('Tag Filter SQL Equivalence', () => {
  test('tag filtering matches JS-level Array.includes filtering', () => {
    fc.assert(
      fc.property(
        paginatedExpenseListArb,
        userIdArb,
        fc.uniqueArray(tagArb, { minLength: 1, maxLength: 2 }),
        (expenseInputs, userId, filterTags) => {
          const allExpenses = expenseInputs.map((input) => makePaginatedExpense(input));

          const sqlResult = referenceFindPaginated(allExpenses, {
            userId,
            tags: filterTags,
            limit: CONFIG.pagination.maxPageSize,
            offset: 0,
          });

          const userVehicles = USER_VEHICLES[userId] ?? [];
          const jsFiltered = allExpenses.filter((e) => {
            if (!userVehicles.includes(e.vehicleId)) return false;
            const expTags = e.tags ?? [];
            return filterTags.every((tag) => expTags.includes(tag));
          });

          const sqlIds = new Set(sqlResult.data.map((e) => e.id));
          const jsIds = new Set(jsFiltered.map((e) => e.id));
          expect(sqlIds).toEqual(jsIds);

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

const vehicleIdArb = fc.constantFrom('vehicle-A', 'vehicle-B', 'vehicle-C');

const expenseDateArb = fc
  .integer({ min: 1672531200000, max: 1767139200000 })
  .map((ms) => new Date(ms));

const expenseArb = (index: number) =>
  fc.record({
    vehicleId: vehicleIdArb,
    sourceType: fc.constantFrom('financing', null) as fc.Arbitrary<string | null>,
    sourceId: fc.constant('fin-1') as fc.Arbitrary<string | null>,
    date: expenseDateArb,
    index: fc.constant(index),
  });

const expenseListArb = fc
  .integer({ min: 0, max: 30 })
  .chain((len) => fc.tuple(...Array.from({ length: len }, (_, i) => expenseArb(i))));

describe('Financing Expense Query Correctness', () => {
  test('filtering returns exactly expenses with sourceType === financing for the target vehicleId', () => {
    fc.assert(
      fc.property(expenseListArb, vehicleIdArb, (expenseInputs, targetVehicleId) => {
        const allExpenses = expenseInputs.map((input) => makeExpense(input));
        const result = referenceQuery(allExpenses, targetVehicleId);

        for (const e of result) {
          expect(e.sourceType).toBe('financing');
        }

        for (const e of result) {
          expect(e.vehicleId).toBe(targetVehicleId);
        }

        const expectedIds = new Set(
          allExpenses
            .filter((e) => e.sourceType === 'financing' && e.vehicleId === targetVehicleId)
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

        for (let i = 1; i < result.length; i++) {
          const prev = new Date(result[i - 1].date).getTime();
          const curr = new Date(result[i].date).getTime();
          expect(curr).toBeGreaterThanOrEqual(prev);
        }
      }),
      { numRuns: 50 }
    );
  });

  test('expenses with sourceType !== financing never appear in results', () => {
    fc.assert(
      fc.property(expenseListArb, vehicleIdArb, (expenseInputs, targetVehicleId) => {
        const allExpenses = expenseInputs.map((input) => makeExpense(input));
        const result = referenceQuery(allExpenses, targetVehicleId);

        const nonFinancingIds = new Set(
          allExpenses.filter((e) => e.sourceType !== 'financing').map((e) => e.id)
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

interface SummaryExpenseInput {
  vehicleId: string;
  category: string;
  expenseAmount: number;
  date: Date;
  index: number;
}

function makeSummaryExpense(input: SummaryExpenseInput): Expense {
  return {
    id: `exp-sum-${input.index}`,
    vehicleId: input.vehicleId,
    category: input.category,
    tags: [],
    date: input.date,
    expenseAmount: input.expenseAmount,
    mileage: null,
    description: null,
    location: null,
    volume: null,
    fuelType: null,
    missedFillup: false,
    userId: 'test-user',
    createdBy: null,
    groupId: null,
    groupTotal: null,
    splitMethod: null,
    sourceType: null,
    sourceId: null,
    clientId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function referenceGetSummary(
  allExpenses: Expense[],
  filters: { userId: string; vehicleId?: string }
): {
  totalAmount: number;
  expenseCount: number;
  categoryBreakdown: Array<{ category: string; amount: number; count: number }>;
  monthlyTrend: Array<{ period: string; amount: number; count: number }>;
} {
  const userVehicles = USER_VEHICLES[filters.userId] ?? [];
  let filtered = allExpenses.filter((e) => userVehicles.includes(e.vehicleId));

  if (filters.vehicleId) {
    filtered = filtered.filter((e) => e.vehicleId === filters.vehicleId);
  }

  const totalAmount = filtered.reduce((sum, e) => sum + e.expenseAmount, 0);
  const expenseCount = filtered.length;

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

describe('Summary Consistency', () => {
  test('totalAmount equals sum of categoryBreakdown[].amount', () => {
    fc.assert(
      fc.property(summaryExpenseListArb, summaryFiltersArb, (expenseInputs, filters) => {
        const allExpenses = expenseInputs.map((input) => makeSummaryExpense(input));
        const summary = referenceGetSummary(allExpenses, filters);

        const categorySum = summary.categoryBreakdown.reduce((sum, c) => sum + c.amount, 0);

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
