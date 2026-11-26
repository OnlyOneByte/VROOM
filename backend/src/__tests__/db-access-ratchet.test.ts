import { expect } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { countRatchet } from '../test-helpers/debt-ratchet';

const SRC_ROOT = join(import.meta.dir, '..');

const OWNERS = new Set(['app-context.ts', 'db/connection.ts', 'db/seed.ts']);

const PATTERNS: Record<string, RegExp> = {
  'getDb()': /(?<!function )\bgetDb\(\)/g,
  'repository singleton':
    /^(?:export )?(?:const|let) \w+(?:\s*:[^=\n]+)?\s*=\s*new \w+Repository\(/gm,
};

const BASELINE: Record<string, number> = {};

function productionSources(dir: string = SRC_ROOT): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (['__tests__', 'test-helpers', 'node_modules', 'scripts'].includes(entry)) continue;
      out.push(...productionSources(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts') && !entry.includes('.test.')) {
      out.push(full);
    }
  }
  return out;
}

function countConstructs(src: string): Map<string, number> {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
  const counts = new Map<string, number>();
  for (const [name, pattern] of Object.entries(PATTERNS)) {
    const n = code.match(pattern)?.length ?? 0;
    if (n > 0) counts.set(name, n);
  }
  return counts;
}

countRatchet({
  name: 'database access goes through the app context',
  tolerated: BASELINE,
  guidance:
    'Reach the database through appContext() (or repos()) from backend/src/app-context.ts, and ' +
    'register new repositories in createAppContext instead of exporting a module-level instance. ' +
    'Only the context factory and the DB tooling call getDb(). New or grown sites (file · construct):',
  scan: () => {
    const counts = new Map<string, number>();
    for (const file of productionSources()) {
      const rel = relative(SRC_ROOT, file);
      if (OWNERS.has(rel)) continue;
      for (const [name, n] of countConstructs(readFileSync(file, 'utf-8'))) {
        counts.set(`${rel} · ${name}`, n);
      }
    }
    return counts;
  },
  probe: () => {
    const one = (src: string, name: string) => countConstructs(src).get(name) ?? 0;
    expect(one('const resolver = requestResolver(c, getDb());', 'getDb()')).toBe(1);
    expect(one('// getDb() in a comment', 'getDb()')).toBe(0);
    expect(one('export function getDb(): AppDatabase {', 'getDb()')).toBe(0);
    expect(
      one('export const tripRepository = new TripRepository(getDb());', 'repository singleton')
    ).toBe(1);
    expect(
      one(
        'export const analyticsInsightsRepository = new AnalyticsInsightsRepository(\n  getDb(),',
        'repository singleton'
      )
    ).toBe(1);
    expect(one('const tripRepository = new TripRepository(getDb());', 'repository singleton')).toBe(
      1
    );
    expect(
      one(
        'export const trips: TripRepository = new TripRepository(getDb());',
        'repository singleton'
      )
    ).toBe(1);
    expect(one('  const repo = new TripRepository(db);', 'repository singleton')).toBe(0);
    expect(productionSources().length).toBeGreaterThan(100);
  },
});
