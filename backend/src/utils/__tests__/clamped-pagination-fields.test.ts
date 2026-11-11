// clampedPaginationFields must stay distinct from commonSchemas.pagination. Merging them would
// change clamp and default behavior, and the cap would stop tracking CONFIG.

import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { CONFIG } from '../../config';
import { commonSchemas } from '../validation';

const listQuery = z.object({ ...commonSchemas.clampedPaginationFields });

const MAX = CONFIG.pagination.maxPageSize;

describe('commonSchemas.clampedPaginationFields', () => {
  test('coerces a numeric-string limit/offset (query params arrive as strings)', () => {
    const parsed = listQuery.parse({ limit: '25', offset: '50' });
    expect(parsed.limit).toBe(25);
    expect(parsed.offset).toBe(50);
  });

  test('accepts limit exactly at the runtime maxPageSize', () => {
    expect(listQuery.parse({ limit: String(MAX) }).limit).toBe(MAX);
  });

  test('rejects a limit above maxPageSize', () => {
    expect(listQuery.safeParse({ limit: String(MAX + 1) }).success).toBe(false);
  });

  test('rejects limit below 1 and a negative offset', () => {
    expect(listQuery.safeParse({ limit: '0' }).success).toBe(false);
    expect(listQuery.safeParse({ offset: '-1' }).success).toBe(false);
  });

  test('omitted limit and offset stay undefined', () => {
    const parsed = listQuery.parse({});
    expect(parsed.limit).toBeUndefined();
    expect(parsed.offset).toBeUndefined();
  });

  test('the cap tracks CONFIG.pagination.maxPageSize rather than a literal', () => {
    const atMax = listQuery.safeParse({ limit: String(MAX) });
    const overMax = listQuery.safeParse({ limit: String(MAX + 1) });
    expect(atMax.success).toBe(true);
    expect(overMax.success).toBe(false);
  });

  test('commonSchemas.pagination applies defaults when omitted', () => {
    const p = commonSchemas.pagination.parse({});
    expect(p.limit).toBe(50);
    expect(p.offset).toBe(0);
  });
});
