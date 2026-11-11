/**
 * Source-scan guard: every nullable vehicleFinancing column must be reset in the create-or-replace
 * SET object, so a new nullable column cannot silently carry a stale value across a type switch.
 */

import { describe, expect, test } from 'bun:test';
import { getTableColumns } from 'drizzle-orm';
import { vehicleFinancing } from '../../../db/schema';

const ROUTES_SRC = await Bun.file(`${import.meta.dir}/../routes.ts`).text();

/** The replace-branch update() call, isolated so field names elsewhere in the file cannot satisfy the check. */
function replaceSetObject(): string {
  const anchor = 'financingRepository.update(existingFinancing.id, {';
  const start = ROUTES_SRC.indexOf(anchor);
  if (start === -1) return '';
  const end = ROUTES_SRC.indexOf('});', start);
  return end === -1 ? ROUTES_SRC.slice(start) : ROUTES_SRC.slice(start, end);
}

/** Timestamps are set by defaults or explicitly, never from the request body. */
const SYSTEM_MANAGED = new Set(['createdAt', 'updatedAt']);

describe('create-or-replace coalesce-list completeness', () => {
  const cols = getTableColumns(vehicleFinancing) as Record<string, { notNull: boolean }>;
  const nullableCols = Object.entries(cols)
    .filter(([, c]) => !c.notNull)
    .map(([name]) => name);

  test('the census found the expected nullable financing columns (non-vacuous)', () => {
    // An empty census would make the completeness check below pass trivially.
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
      if (!new RegExp(`\\b${col}\\b`).test(setObj)) {
        unmanaged.push(col);
      }
    }
    expect(
      unmanaged,
      `These nullable vehicleFinancing columns are NOT reset on the create-or-replace path — a financing ` +
        `TYPE switch will leave them STALE (cross-type class). Coalesce each to null in the ` +
        `replace-branch SET object (financing/routes.ts), or add it to SYSTEM_MANAGED if it's ` +
        `system-driven:\n  ${unmanaged.join(', ')}`
    ).toEqual([]);
  });
});
