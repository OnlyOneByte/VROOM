/**
 * Query-contract tests for the expenses list endpoint's query schema.
 *
 * This is the route boundary that the in-process repository tests bypass:
 * query params arrive as STRINGS and must be coerced/validated before they
 * reach findPaginated(). Bugs here (a stripped param, a bad coercion) are
 * exactly the class that repo-level tests can't catch — the same shape of bug
 * as the reminders PUT 400 that an interaction spec surfaced.
 *
 * The schema is exported from routes.ts for this purpose.
 */

import { describe, expect, test } from 'bun:test';
import { expenseQuerySchema } from '../routes';

describe('expenseQuerySchema search', () => {
  test('accepts and trims a search term', () => {
    const parsed = expenseQuerySchema.parse({ search: '  oil change  ' });
    expect(parsed.search).toBe('oil change');
  });

  test('rejects an over-long search term (>100 chars)', () => {
    expect(() => expenseQuerySchema.parse({ search: 'x'.repeat(101) })).toThrow();
  });

  test('omitting search leaves it undefined (no filter)', () => {
    const parsed = expenseQuerySchema.parse({});
    expect(parsed.search).toBeUndefined();
  });
});

describe('expenseQuerySchema coercions', () => {
  test('tags CSV string is split into a trimmed array', () => {
    const parsed = expenseQuerySchema.parse({ tags: 'fuel, gas , maintenance' });
    expect(parsed.tags).toEqual(['fuel', 'gas', 'maintenance']);
  });

  test('limit/offset strings coerce to positive ints', () => {
    const parsed = expenseQuerySchema.parse({ limit: '20', offset: '40' });
    expect(parsed.limit).toBe(20);
    expect(parsed.offset).toBe(40);
  });

  test('a non-numeric limit is rejected', () => {
    expect(() => expenseQuerySchema.parse({ limit: 'abc' })).toThrow();
  });

  test('a negative offset is rejected', () => {
    expect(() => expenseQuerySchema.parse({ offset: '-1' })).toThrow();
  });
});
