import { describe, expect, test } from 'bun:test';

const ROUTES_SRC = await Bun.file(`${import.meta.dir}/../routes.ts`).text();

const PERSIST_CALLS = [
  'expenseRepository.createIdempotent(',
  'expenseRepository.update(',
  'expenseRepository.createSplitExpense(',
  'expenseRepository.updateSplitExpense(',
] as const;

const VALIDATOR_RE = /await assert(Split)?FinancingSourceValid\(/g;

function handlerStartBefore(offset: number): number {
  const regRe = /routes\.(post|put|get|delete|patch)\(/g;
  let start = -1;
  for (const m of ROUTES_SRC.matchAll(regRe)) {
    if (m.index !== undefined && m.index < offset) start = m.index;
    else break;
  }
  return start;
}

describe('expense source-link validation coverage', () => {
  test('routes.ts has exactly four expense-persist write paths', () => {
    for (const call of PERSIST_CALLS) {
      const n = ROUTES_SRC.split(call).length - 1;
      expect(n, `${call} should appear exactly once`).toBe(1);
    }
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
    const importSrc = await Bun.file(`${import.meta.dir}/../import-csv.ts`).text();
    const mappingSrc = await Bun.file(`${import.meta.dir}/../import-mapping.ts`).text();
    expect(importSrc.includes('sourceType') || importSrc.includes('sourceId')).toBe(false);
    expect(mappingSrc.includes('sourceType') || mappingSrc.includes('sourceId')).toBe(false);
  });
});
