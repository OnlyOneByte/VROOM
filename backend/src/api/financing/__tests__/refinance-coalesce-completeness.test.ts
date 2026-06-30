/**
 * #293 (C183 guard) — the create-or-replace financing path must RESET every nullable cross-type/schedule
 * column to a clean value on reuse, so switching a vehicle's financing TYPE can't leave a prior type's
 * field stale (a `loan` row carrying a lease `mileageLimit`, etc — NORTH_STAR #2). C293 fixed this by
 * coalescing each `.optional()` field to null on the reused row (routes.ts replace branch); the C293
 * behavioral test (refinance-cross-type-field-reset) pins the CURRENTLY-known fields in both directions.
 *
 * GAP this closes: that behavioral test enumerates today's fields by hand, so a FUTURE schema migration
 * adding a new NULLABLE financing column would leave the replace path silently merging it stale (the #293
 * class reopens) while every existing test stays green. This is the source-scan completeness guard (the
 * C25/C170/C172 idiom): it censuses the live `vehicleFinancing` nullable columns via getTableColumns and
 * asserts EACH one is explicitly handled in the replace-path SET object — so adding a nullable column
 * forces the author to either reset it there or consciously exempt it here.
 *
 * Pure source-scan + schema reflection — no DB, no HTTP. Fast.
 */

import { describe, expect, test } from 'bun:test';
import { getTableColumns } from 'drizzle-orm';
import { vehicleFinancing } from '../../../db/schema';

const ROUTES_SRC = await Bun.file(`${import.meta.dir}/../routes.ts`).text();

/**
 * Isolate the create-OR-REPLACE branch's `financingRepository.update(existingFinancing.id, { ... })` SET
 * object — the block that must reset every nullable cross-type field. Scoped to that call so a field name
 * appearing elsewhere (the schema derivation, the create() call) can't satisfy the assertion spuriously.
 */
function replaceSetObject(): string {
  const anchor = 'financingRepository.update(existingFinancing.id, {';
  const start = ROUTES_SRC.indexOf(anchor);
  if (start === -1) return '';
  // The SET object literal ends at the first `});` after the anchor.
  const end = ROUTES_SRC.indexOf('});', start);
  return end === -1 ? ROUTES_SRC.slice(start) : ROUTES_SRC.slice(start, end);
}

/**
 * System-managed nullable columns the replace path does NOT (and must not) set from the request body:
 * the create/update timestamps are driven by `$defaultFn` / the explicit `updatedAt: new Date()`.
 */
const SYSTEM_MANAGED = new Set(['createdAt', 'updatedAt']);

describe('#293 create-or-replace coalesce-list completeness (C183 source-scan guard)', () => {
  const cols = getTableColumns(vehicleFinancing) as Record<string, { notNull: boolean }>;
  const nullableCols = Object.entries(cols)
    .filter(([, c]) => !c.notNull)
    .map(([name]) => name);

  test('the census found the expected nullable financing columns (non-vacuous)', () => {
    // Guards the guard: if the schema reflection returns nothing, the completeness check below is vacuous.
    expect(nullableCols).toContain('apr');
    expect(nullableCols).toContain('mileageLimit');
    expect(nullableCols.length).toBeGreaterThanOrEqual(7);
  });

  test('the replace-path SET object exists and is isolable', () => {
    expect(replaceSetObject()).toContain('isActive: true');
  });

  test('every nullable cross-type/schedule column is explicitly reset on the replace path', () => {
    const setObj = replaceSetObject();
    const unmanaged: string[] = [];
    for (const col of nullableCols) {
      if (SYSTEM_MANAGED.has(col)) continue;
      // Each must appear in the SET object — either coalesced (`col: financingData.col ?? null`) or set
      // explicitly (`endDate: null`). A new nullable column not handled here trips this.
      if (!new RegExp(`\\b${col}\\b`).test(setObj)) {
        unmanaged.push(col);
      }
    }
    expect(
      unmanaged,
      `These nullable vehicleFinancing columns are NOT reset on the create-or-replace path — a financing ` +
        `TYPE switch will leave them STALE (the #293 cross-type class). Coalesce each to null in the ` +
        `replace-branch SET object (financing/routes.ts), or add it to SYSTEM_MANAGED if it's ` +
        `system-driven:\n  ${unmanaged.join(', ')}`
    ).toEqual([]);
  });
});
