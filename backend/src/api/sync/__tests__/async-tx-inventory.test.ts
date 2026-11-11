// Ratchet: the number of async transaction callbacks in production code may fall but never rise.
// Converting a site to a synchronous callback lowers MAX_ASYNC_TX_CALLBACKS; adding one fails.
// Comments are stripped before matching so prose about the pattern cannot trip the scan.

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { countRatchet } from '../../../test-helpers/debt-ratchet';

const SRC_ROOT = join(import.meta.dir, '../../../');

/** Files holding an async transaction callback today. The counts are a ceiling. */
const INVENTORY: Record<string, number> = {
  // Policy update, policy delete and term delete read, then write.
  'api/insurance/repository.ts': 3,
  // setCoverPhoto validates before its first write, so a bad id cannot leave the entity cover-less.
  'api/photos/photo-repository.ts': 1,
};

/** Every production .ts file under src, excluding tests and type declarations. */
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

/** Strips comments; crude by design, since only `.transaction(async` matters. */
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
    'These files introduce the autocommit footgun — make the callback synchronous ' +
    '(.run()/.all()/.get() inline), or inventory the site in INVENTORY above with a reason:',
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
    // Guards against a scan over zero files passing forever. Not anchored on any file that still
    // holds a callback, so the guard stays satisfiable once the inventory reaches zero.
    expect(productionSources().length).toBeGreaterThan(100);
  },
});

describe('async transaction callbacks: the highest-stakes site', () => {
  test('the restore service — the highest-stakes transaction in the app — has none', () => {
    const restore = readFileSync(join(SRC_ROOT, 'api/sync/restore.ts'), 'utf-8');
    // An async callback here would let a mid-restore throw commit the wipe without the re-insert.
    expect(countAsyncTransactions(restore)).toBe(0);
    expect(restore).toContain('this.db.transaction((tx) => {');
  });
});
