// Property-based tests for pagination.ts: response shape and hasMore, full page iteration, and
// clampPagination bounds.

import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { buildPaginatedResponse, clampPagination } from '../pagination';

describe('buildPaginatedResponse shape and hasMore', () => {
  test('always produces valid nested shape with correct hasMore computation', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string(), { maxLength: 100 }),
        fc.nat({ max: 10000 }),
        fc.integer({ min: 1, max: 100 }),
        fc.nat({ max: 10000 }),
        (data, totalCount, limit, offset) => {
          const result = buildPaginatedResponse(data, totalCount, limit, offset);

          expect(result.success).toBe(true);
          expect(result.data).toBe(data);
          expect(result.pagination.totalCount).toBe(totalCount);
          expect(result.pagination.limit).toBe(limit);
          expect(result.pagination.offset).toBe(offset);

          const expectedHasMore = offset + data.length < totalCount;
          expect(result.pagination.hasMore).toBe(expectedHasMore);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('idempotence: same inputs always produce same output', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string(), { maxLength: 50 }),
        fc.nat({ max: 5000 }),
        fc.integer({ min: 1, max: 100 }),
        fc.nat({ max: 5000 }),
        (data, totalCount, limit, offset) => {
          const result1 = buildPaginatedResponse(data, totalCount, limit, offset);
          const result2 = buildPaginatedResponse(data, totalCount, limit, offset);

          expect(result1).toEqual(result2);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('iterating pages yields exactly totalCount items with no duplicates', () => {
  test('all pages combined contain every item exactly once', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: 1, max: 100 }),
        (totalCount, limit) => {
          const allItems = Array.from({ length: totalCount }, (_, i) => i);
          const collected: number[] = [];
          let offset = 0;
          let pageCount = 0;
          const maxPages = Math.ceil(totalCount / limit) + 1;

          while (pageCount < maxPages) {
            const pageData = allItems.slice(offset, offset + limit);
            const result = buildPaginatedResponse(pageData, totalCount, limit, offset);

            collected.push(...pageData);

            if (offset + pageData.length < totalCount) {
              expect(result.pagination.hasMore).toBe(true);
            } else {
              expect(result.pagination.hasMore).toBe(false);
              break;
            }

            offset += limit;
            pageCount++;
          }

          expect(collected.length).toBe(totalCount);

          const unique = new Set(collected);
          expect(unique.size).toBe(totalCount);

          for (let i = 0; i < totalCount; i++) {
            expect(unique.has(i)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('clampPagination output always satisfies bounds', () => {
  test('limit is always within [minPageSize, maxPageSize] and offset >= 0', () => {
    fc.assert(
      fc.property(
        fc.option(fc.integer({ min: -1000, max: 1000 }), { nil: undefined }),
        fc.option(fc.integer({ min: -1000, max: 1000 }), { nil: undefined }),
        (limit, offset) => {
          const result = clampPagination({ limit, offset });

          expect(result.limit).toBeGreaterThanOrEqual(1);
          expect(result.limit).toBeLessThanOrEqual(100);

          expect(result.offset).toBeGreaterThanOrEqual(0);

          const expectedLimit = Math.min(Math.max(limit ?? 20, 1), 100);
          expect(result.limit).toBe(expectedLimit);

          const expectedOffset = Math.max(offset ?? 0, 0);
          expect(result.offset).toBe(expectedOffset);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('defaults applied when pagination is undefined', () => {
    const result = clampPagination(undefined);
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
  });

  test('defaults applied when fields are undefined', () => {
    const result = clampPagination({});
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
  });
});
