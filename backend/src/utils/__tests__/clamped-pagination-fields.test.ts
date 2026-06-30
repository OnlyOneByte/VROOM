/**
 * Guard (C232) for `commonSchemas.clampedPaginationFields` — the shared list-query `limit`/`offset` field-set
 * the C229 dedup extracted, now spread by the odometer + trips list routes.
 *
 * WHY THIS EXISTS: there are TWO pagination shapes in commonSchemas and they are DELIBERATELY different —
 * conflating them is a real, money-adjacent footgun the C212 scout + C229 dedup both called out:
 *   - `clampedPaginationFields` (THIS): NO defaults; `limit` capped at the RUNTIME `CONFIG.pagination.maxPageSize`.
 *     Pairs with `clampPagination` (utils/pagination.ts), which re-clamps — so an omitted value falls through
 *     to clampPagination's `defaultPageSize`, and an out-of-range value is REJECTED at the Zod boundary.
 *   - `commonSchemas.pagination`: bakes in `.default(50)` / `.default(0)` + a hardcoded `.max(100)`.
 * If a future "tidy-up" repointed a clampPagination route at `commonSchemas.pagination` (or inlined defaults
 * into this field-set), the clamp/default behavior would silently change AND the cap would stop tracking
 * CONFIG — exactly the divergence C212 refused to adopt. Nothing pinned that contract behaviorally; this does.
 *
 * Pure schema test (no DB / no HTTP harness) — parses the field-set directly, so it survives a merge as a
 * committed source-scan-grade guard.
 */

import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { CONFIG } from '../../config';
import { commonSchemas } from '../validation';

// Reconstruct the schema the routes build: z.object spreading the shared fields.
const listQuery = z.object({ ...commonSchemas.clampedPaginationFields });

const MAX = CONFIG.pagination.maxPageSize;

describe('commonSchemas.clampedPaginationFields (C232 contract guard)', () => {
  test('coerces a numeric-string limit/offset (query params arrive as strings)', () => {
    const parsed = listQuery.parse({ limit: '25', offset: '50' });
    expect(parsed.limit).toBe(25);
    expect(parsed.offset).toBe(50);
  });

  test('accepts limit exactly at the runtime maxPageSize', () => {
    expect(listQuery.parse({ limit: String(MAX) }).limit).toBe(MAX);
  });

  test('REJECTS a limit above maxPageSize (the cap is enforced at the boundary, not silently clamped here)', () => {
    expect(listQuery.safeParse({ limit: String(MAX + 1) }).success).toBe(false);
  });

  test('REJECTS limit < 1 and a negative offset', () => {
    expect(listQuery.safeParse({ limit: '0' }).success).toBe(false);
    expect(listQuery.safeParse({ offset: '-1' }).success).toBe(false);
  });

  test('has NO defaults — omitted limit/offset stay undefined (clampPagination supplies the default downstream)', () => {
    const parsed = listQuery.parse({});
    expect(parsed.limit).toBeUndefined();
    expect(parsed.offset).toBeUndefined();
  });

  test('the cap TRACKS CONFIG.pagination.maxPageSize — it is NOT a hardcoded 100 (the C212/C229 divergence guard)', () => {
    // This is the load-bearing distinction from commonSchemas.pagination (hardcoded .max(100) + defaults).
    // If someone repointed the field-set at a literal cap, maxPageSize and the boundary would drift apart.
    const atMax = listQuery.safeParse({ limit: String(MAX) });
    const overMax = listQuery.safeParse({ limit: String(MAX + 1) });
    expect(atMax.success).toBe(true);
    expect(overMax.success).toBe(false);
  });

  test('commonSchemas.pagination (the SIBLING) DOES default — proving the two are intentionally distinct', () => {
    // Pin the contrast so a "merge them" refactor trips here: pagination defaults to 50/0 when omitted.
    const p = commonSchemas.pagination.parse({});
    expect(p.limit).toBe(50);
    expect(p.offset).toBe(0);
  });
});
