import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { countRatchet } from '../../../test-helpers/debt-ratchet';

const SRC_ROOT = join(import.meta.dir, '../../../');

const INVENTORY: Record<string, number> = {
  'api/insurance/repository.ts': 3,
  'api/photos/photo-repository.ts': 1,
};

function productionSources(dir: string = SRC_ROOT): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'test-helpers' || entry === 'node_modules') continue;
      out.push(...productionSources(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts') && !entry.includes('.test.')) {
      out.push(full);
    }
  }
  return out;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function countAsyncTransactions(src: string): number {
  return (stripComments(src).match(/\.transaction\(\s*async\b/g) ?? []).length;
}

countRatchet({
  name: 'async transaction callbacks are ratcheted, not merely documented',
  tolerated: INVENTORY,
  guidance:
    'An async transaction callback autocommits each statement, so a throw mid-write leaves earlier ' +
    'writes committed. Make the callback synchronous (.run()/.all()/.get() inline), or inventory the ' +
    'site in INVENTORY above with a reason:',
  scan: () => {
    const counts = new Map<string, number>();
    for (const file of productionSources()) {
      const n = countAsyncTransactions(readFileSync(file, 'utf-8'));
      if (n > 0) counts.set(relative(SRC_ROOT, file), n);
    }
    return counts;
  },
  probe: () => {
    expect(countAsyncTransactions('await db.transaction(async (tx) => { x(); });')).toBe(1);
    expect(countAsyncTransactions('this.db.transaction(\n  async (tx) => { x(); }\n);')).toBe(1);
    expect(countAsyncTransactions('db.transaction((tx) => { x(); });')).toBe(0);
    expect(
      countAsyncTransactions('// never db.transaction(async (tx) => …\ndb.transaction(() => 1);')
    ).toBe(0);
    expect(countAsyncTransactions('/* db.transaction(async (tx) => … */')).toBe(0);
    expect(productionSources().length).toBeGreaterThan(100);
  },
});

describe('async transaction callbacks: the highest-stakes site', () => {
  test('the restore service — the highest-stakes transaction in the app — has none', () => {
    const restore = readFileSync(join(SRC_ROOT, 'api/sync/restore.ts'), 'utf-8');
    expect(countAsyncTransactions(restore)).toBe(0);
    expect(restore).toContain('this.db.transaction((tx) => {');
  });
});
