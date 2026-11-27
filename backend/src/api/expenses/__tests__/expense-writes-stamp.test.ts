import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC_ROOT = join(import.meta.dir, '../../..');

function productionSources(dir: string = SRC_ROOT): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (['__tests__', 'test-helpers', 'node_modules'].includes(entry)) continue;
      out.push(...productionSources(full));
    } else if (entry.endsWith('.ts') && !entry.includes('.test.')) {
      out.push(full);
    }
  }
  return out;
}

export function unstampedExpenseWrites(src: string): number {
  let missing = 0;
  for (const match of src.matchAll(/\.update\(\s*expenses\s*\)\s*\.set\(\s*\{/g)) {
    const start = (match.index ?? 0) + match[0].length;
    let depth = 1;
    let end = start;
    while (end < src.length && depth > 0) {
      if (src[end] === '{') depth++;
      if (src[end] === '}') depth--;
      end++;
    }
    if (!/\bupdatedAt\b/.test(src.slice(start, end))) missing++;
  }
  return missing;
}

describe('every expense write moves updatedAt forward', () => {
  test('no production update of the expenses table leaves updatedAt alone', () => {
    const offenders = productionSources()
      .filter((file) => unstampedExpenseWrites(readFileSync(file, 'utf-8')) > 0)
      .map((file) => relative(SRC_ROOT, file));
    expect(
      offenders,
      'Set updatedAt with nextUpdatedAt or nextUpdatedAtFor (api/expenses/updated-at.ts), or the stale-write check misses the write:'
    ).toEqual([]);
  });

  test('the scan sees an update with and without a stamp', () => {
    expect(unstampedExpenseWrites('tx.update(expenses).set({ paidByDriverId: to })')).toBe(1);
    expect(
      unstampedExpenseWrites(
        'db\n  .update(expenses)\n  .set({\n    a: sql`x`,\n    updatedAt,\n  })'
      )
    ).toBe(0);
    expect(unstampedExpenseWrites('tx.update(trips).set({ driverId: to })')).toBe(0);
  });
});
