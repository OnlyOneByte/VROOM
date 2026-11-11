/**
 * Ratchet on the `transaction(async (tx) => …)` footgun: the count may fall, never rise.
 *
 * bun-sqlite is a synchronous dialect. An async transaction callback returns a pending promise, so
 * bun's BEGIN/COMMIT wrap nothing and each `await tx.*` autocommits on its own — a throw part-way
 * through leaves the earlier writes committed. The repository-level sweep next door
 * (async-tx-atomicity.test.ts) forces a mid-transaction failure at two specific call sites and asserts
 * no partial state survives, but nothing stopped a NEW async callback from appearing somewhere else,
 * and per-site rollback tests do not scale to a whole codebase.
 *
 * So this guard reads the sources instead. It pins two things:
 *  - no production file outside the inventory below contains an async transaction callback at all, and
 *  - the total count does not exceed what is there today.
 *
 * Both directions matter and neither blocks ordinary work: converting a site to a synchronous callback
 * (the fix) only lowers the count, which still passes — tighten MAX_ASYNC_TX_CALLBACKS when you do.
 * Adding one fails, which is the point: the author is then forced either to make the callback
 * synchronous or to argue the site into the inventory on purpose.
 *
 * Scope is production source only. A test may use an async transaction freely — it risks no user's
 * data. Comments are stripped before matching so prose about the footgun (there is plenty, including in
 * this file's neighbours) cannot trip the scan.
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { countRatchet } from '../../../test-helpers/debt-ratchet';

const SRC_ROOT = join(import.meta.dir, '../../../');

/**
 * Files that hold an async transaction callback today. Each is a read-then-write transaction whose
 * callback awaits, so its writes are NOT covered by one real transaction; they are inventoried rather
 * than fixed here because they sit in other domains' repositories. The counts are the ceiling, not an
 * endorsement.
 */
const INVENTORY: Record<string, number> = {
  // policy update / policy delete / term delete: each validates by reading, then writes.
  'api/insurance/repository.ts': 3,
  // setCoverPhoto unsets the old cover then sets the new one; it deliberately validates BEFORE the
  // first write so a bad id cannot leave the entity cover-less, which is the mitigation, not a fix.
  'api/photos/photo-repository.ts': 1,
};

/** Every production .ts file under src — tests, test helpers and type declarations excluded. */
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

/**
 * Strip comments so a sentence ABOUT the pattern is not mistaken for the pattern. Crude by design: the
 * only question asked of the result is whether a `.transaction(async` call survives in it, and the
 * worst a mangled string literal can do is hide a match, which no production file relies on.
 */
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
    // Both polarities, plus proof the comment stripper does not blind the matcher.
    expect(countAsyncTransactions('await db.transaction(async (tx) => { x(); });')).toBe(1);
    expect(countAsyncTransactions('this.db.transaction(\n  async (tx) => { x(); }\n);')).toBe(1);
    expect(countAsyncTransactions('db.transaction((tx) => { x(); });')).toBe(0);
    expect(
      countAsyncTransactions('// never db.transaction(async (tx) => …\ndb.transaction(() => 1);')
    ).toBe(0);
    expect(countAsyncTransactions('/* db.transaction(async (tx) => … */')).toBe(0);
    // And that the walk reads the tree at all — a scan over zero files would pass every subset
    // check forever. Deliberately NOT anchored on a file still holding a callback: that would make
    // the guard unsatisfiable the moment the inventory reaches zero, which is the goal state.
    expect(productionSources().length).toBeGreaterThan(100);
  },
});

describe('async transaction callbacks: the highest-stakes site', () => {
  test('the restore service — the highest-stakes transaction in the app — has none', () => {
    const restore = readFileSync(join(SRC_ROOT, 'api/sync/restore.ts'), 'utf-8');
    // Replace mode wipes the account before re-inserting, so an async callback here would mean a
    // mid-restore throw commits the wipe and nothing else: total data loss.
    expect(countAsyncTransactions(restore)).toBe(0);
    expect(restore).toContain('this.db.transaction((tx) => {');
  });
});
