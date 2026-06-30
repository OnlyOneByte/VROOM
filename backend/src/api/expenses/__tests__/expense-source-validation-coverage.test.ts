/**
 * #62/#109/#125/#145 (C172 guard) — the within-tenant financing-source-link integrity class is closed
 * across ALL FOUR expense-write paths (POST /, PUT /:id, POST /split, PUT /split/:id) by
 * `assertFinancingSourceValid` / `assertSplitFinancingSourceValid`. A forged/mismatched
 * `{sourceType:'financing', sourceId}` link is the exact predicate FinancingRepository.computeBalance
 * sums, so an unvalidated one mis-attributes a row as a loan payment → understates the displayed balance
 * (NORTH_STAR #1 money figure) + mis-wires the financing cascade-cleanup.
 *
 * Each path is pinned BEHAVIORALLY in expense-source-traceability.test.ts — but a behavioral test for
 * path N can't protect a FUTURE path N+1. This is the merge-survival gap (the C25/C271/C170 source-scan
 * idiom): if someone adds a FIFTH expense-persist site (or refactors a handler) WITHOUT a preceding
 * source-link validator, the class silently reopens and NO existing test goes red. This guard is that
 * net — it asserts, structurally, that every expense-persist call in routes.ts is preceded WITHIN ITS
 * HANDLER by a financing-source validator. A new unguarded write path trips it (forces validate-or-pin).
 *
 * NOTE: the import path (`expenseRepository.importExpenses`) is INTENTIONALLY not a guarded site — it
 * builds rows from CSV, which has no `sourceType` column, so it can never set a financing source link
 * (verified firsthand C172). It is excluded by construction, asserted below so a future import change
 * that DID accept a source link can't quietly land here unnoticed.
 */

import { describe, expect, test } from 'bun:test';

const ROUTES_SRC = await Bun.file(`${import.meta.dir}/../routes.ts`).text();

/** The expense-persist (write) calls a financing source link can ride in on. */
const PERSIST_CALLS = [
  'expenseRepository.createIdempotent(', // POST /
  'expenseRepository.update(', // PUT /:id
  'expenseRepository.createSplitExpense(', // POST /split
  'expenseRepository.updateSplitExpense(', // PUT /split/:id
] as const;

/** Matches either source-link validator (the split one wraps the single one per vehicle). */
const VALIDATOR_RE = /await assert(Split)?FinancingSourceValid\(/g;

/**
 * Find the handler body a given source offset lives in: the slice from the LAST preceding route
 * registration (`routes.post(` / `routes.put(` / `routes.get(` / `routes.delete(`) up to the offset.
 * A validator must appear inside this slice for the persist at `offset` to be guarded.
 */
function handlerStartBefore(offset: number): number {
  const regRe = /routes\.(post|put|get|delete|patch)\(/g;
  let start = -1;
  for (const m of ROUTES_SRC.matchAll(regRe)) {
    if (m.index !== undefined && m.index < offset) start = m.index;
    else break;
  }
  return start;
}

describe('#62/#109/#125/#145 expense source-link validation coverage (C172 structural guard)', () => {
  test('exactly FOUR expense-persist write paths exist in routes.ts (a 5th forces a guard update)', () => {
    // Pins the write surface: createIdempotent + update + createSplitExpense + updateSplitExpense, one
    // each. A NEW persist site (or a second call to one) changes a count below → the author must come
    // here, see this contract, and validate the new path (or consciously exclude it like import).
    for (const call of PERSIST_CALLS) {
      const n = ROUTES_SRC.split(call).length - 1;
      expect(n, `${call} should appear exactly once`).toBe(1);
    }
    // And no OTHER write method sneaks a row in unscanned: importExpenses is the only allowed extra, and
    // it's source-link-free by construction (CSV has no sourceType column).
    expect(ROUTES_SRC).toContain('expenseRepository.importExpenses(');
  });

  test('every expense-persist call is preceded WITHIN ITS HANDLER by a financing-source validator', () => {
    for (const call of PERSIST_CALLS) {
      const persistIdx = ROUTES_SRC.indexOf(call);
      expect(persistIdx, `${call} present`).toBeGreaterThan(-1);

      const handlerStart = handlerStartBefore(persistIdx);
      expect(handlerStart, `${call} lives inside a route handler`).toBeGreaterThan(-1);

      const handlerSlice = ROUTES_SRC.slice(handlerStart, persistIdx);
      const hasValidator = Array.from(handlerSlice.matchAll(VALIDATOR_RE)).length > 0;
      expect(
        hasValidator,
        `the handler that calls ${call} must validate the financing source link before persisting`
      ).toBe(true);
    }
  });

  test('the import path stays source-link-free (it never sets sourceType/sourceId)', async () => {
    // import-csv.ts / import-mapping.ts build NewExpense rows from CSV columns; neither ever writes a
    // sourceType/sourceId, so importExpenses can't carry a financing link → no validator needed. If a
    // future change adds source-link support to import, this assertion fails and the author must extend
    // the guarded-paths set above.
    const importSrc = await Bun.file(`${import.meta.dir}/../import-csv.ts`).text();
    const mappingSrc = await Bun.file(`${import.meta.dir}/../import-mapping.ts`).text();
    expect(importSrc.includes('sourceType') || importSrc.includes('sourceId')).toBe(false);
    expect(mappingSrc.includes('sourceType') || mappingSrc.includes('sourceId')).toBe(false);
  });
});
