import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC_ROOT = join(import.meta.dir, '..');

const SYNC_HANDLE_MARKERS: [name: string, pattern: RegExp][] = [
  ['the sync Drizzle driver', /drizzle-orm\/bun-sqlite/],
  ['a bun:sqlite value import', /import\s+(?!type\b)[^;]*from\s+'bun:sqlite'/],
  ['the sync database type', /\bAppDatabase\b/],
  ['getDb()', /\bgetDb\(/],
  ['the raw connection', /\.\$client\b/],
  [
    'a sync handle on the app context',
    /appContext\(\)\.db\b|\{[^}]*\bdb\b[^}]*\}\s*=\s*appContext\(\)/,
  ],
];

const CONTEXT_FACTORY = 'app-context.ts';
const FACTORY_MAY_USE = new Set(['getDb()', 'the raw connection']);

function productionSources(dir: string = SRC_ROOT): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (['__tests__', 'test-helpers', 'node_modules'].includes(entry)) continue;
      if (relative(SRC_ROOT, full) === 'db') continue;
      out.push(...productionSources(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts') && !entry.includes('.test.')) {
      out.push(full);
    }
  }
  return out;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
}

export function syncHandleUses(rel: string, src: string): string[] {
  const code = stripComments(src);
  return SYNC_HANDLE_MARKERS.filter(
    ([name, pattern]) =>
      pattern.test(code) && !(rel === CONTEXT_FACTORY && FACTORY_MAY_USE.has(name))
  ).map(([name]) => `${rel}: ${name}`);
}

describe('only src/db/ touches the synchronous database', () => {
  test('no production file outside src/db/ can reach a sync query', () => {
    const files = productionSources();
    expect(files.length).toBeGreaterThan(100);
    const uses = files.flatMap((file) =>
      syncHandleUses(relative(SRC_ROOT, file), readFileSync(file, 'utf-8'))
    );
    expect(
      uses,
      'Query through appContext().asyncDb or a repository; only src/db/ (migrations, connection upkeep) may hold the synchronous bun:sqlite handle:'
    ).toEqual([]);
  });

  test('the markers catch every way of reaching the sync handle', () => {
    const flagged = (src: string, rel = 'api/x.ts') => syncHandleUses(rel, src).length;
    expect(flagged("import { drizzle } from 'drizzle-orm/bun-sqlite';")).toBe(1);
    expect(flagged("import { Database } from 'bun:sqlite';")).toBe(1);
    expect(flagged("import type { Database } from 'bun:sqlite';")).toBe(0);
    expect(flagged('constructor(db: AppDatabase) {}')).toBe(1);
    expect(flagged('const db = getDb();')).toBe(1);
    expect(flagged('openAsyncDatabase(handle.$client)')).toBe(1);
    expect(flagged('appContext().db.select().from(users).all();')).toBe(1);
    expect(flagged('const { db, asyncDb } = appContext();')).toBe(1);
    expect(flagged('const { asyncDb } = appContext();')).toBe(0);
    expect(flagged('await appContext().asyncDb.select().from(users).get();')).toBe(0);
    expect(flagged('// getDb() in a comment')).toBe(0);
    expect(flagged('createAppContext(getDb().$client);', 'app-context.ts')).toBe(0);
  });

  test('the restore service, the biggest transaction in the app, runs on the async session', () => {
    const restore = readFileSync(join(SRC_ROOT, 'api/sync/restore.ts'), 'utf-8');
    expect(syncHandleUses('api/sync/restore.ts', restore)).toEqual([]);
    expect(restore).toContain('return appContext().asyncDb;');
  });
});
