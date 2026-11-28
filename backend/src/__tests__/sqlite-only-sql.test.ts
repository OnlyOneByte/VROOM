import { expect } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { countRatchet } from '../test-helpers/debt-ratchet';

const SRC_ROOT = join(import.meta.dir, '..');
const DIALECT_DIR = join(SRC_ROOT, 'db', 'dialect');

const PATTERNS: Record<string, RegExp> = {
  json_each: /\bjson_each\b/gi,
  json_patch: /\bjson_patch\b/gi,
  strftime: /\bstrftime\b/gi,
  unixepoch: /\bunixepoch\b/gi,
  julianday: /\bjulianday\b/gi,
  rowid: /(?<![A-Za-z0-9])(?:rowid|ROWID)(?![A-Za-z0-9])/g,
  'INSERT OR': /\bINSERT\s+OR\s+(?:IGNORE|REPLACE|ABORT|FAIL|ROLLBACK)\b/gi,
  PRAGMA: /\bpragma\b/gi,
  'CROSS JOIN … ON':
    /\bCROSS\s+JOIN\s+(?:\w+(?:\((?:[^()]|\([^()]*\))*\))?|"[^"]+"|`[^`]+`|\$\{[^}]*\}|\((?:[^()]|\([^()]*\))*\))(?:\s+(?:AS\s+)?\w+)?\s+ON\b/gi,
  'raw db/tx query': /\b(?:db|tx)\.(?:all|get|run|values)\s*(?:<[^(]*?>)?\s*\(\s*sql\b/g,
  'builder .all()/.get()/.run()': /\)\s*\.(?:all|get|run)\s*\(\s*\)/g,
  'stored builder .all()/.get()/.run()': /\b[A-Za-z_$][\w$]*\.(?:all|get|run)\s*\(\s*\)/g,
  SQLITE_: /\bSQLITE_/g,
  sqlite_master: /\bsqlite_master\b/gi,
  randomblob: /\brandomblob\b/gi,
  'sql`0`/sql`1` predicate': /\bsql(?:<[^>]*>)?`\s*[01]\s*`/g,
};

const BASELINE: Record<string, number> = {
  'api/providers/routes.ts · sql`0`/sql`1` predicate': 1,
  'db/async-sqlite.ts · builder .all()/.get()/.run()': 1,
  'db/connection.ts · builder .all()/.get()/.run()': 2,
  'db/connection.ts · PRAGMA': 7,
  'scripts/postgres-move-smoke.ts · builder .all()/.get()/.run()': 1,
  'utils/chunk.ts · SQLITE_': 5,
};

function productionSources(dir: string = SRC_ROOT): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (['__tests__', 'test-helpers', 'node_modules'].includes(entry) || full === DIALECT_DIR) {
        continue;
      }
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

function countConstructs(src: string): Map<string, number> {
  const code = stripComments(src);
  const counts = new Map<string, number>();
  for (const [name, pattern] of Object.entries(PATTERNS)) {
    const n = code.match(pattern)?.length ?? 0;
    if (n > 0) counts.set(name, n);
  }
  return counts;
}

countRatchet({
  name: 'SQLite-only SQL stays inside the dialect layer',
  tolerated: BASELINE,
  guidance:
    'SQLite-only SQL belongs in backend/src/db/dialect/, the one place a second database dialect ' +
    'can replace it. Use (or add) a dialect helper there instead of writing the construct inline. ' +
    'See docs/conventions/DatabaseMigrations.md. New or grown sites (file · construct):',
  scan: () => {
    const counts = new Map<string, number>();
    for (const file of productionSources()) {
      const rel = relative(SRC_ROOT, file);
      for (const [name, n] of countConstructs(readFileSync(file, 'utf-8'))) {
        counts.set(`${rel} · ${name}`, n);
      }
    }
    return counts;
  },
  probe: () => {
    const one = (src: string, name: string) => countConstructs(src).get(name) ?? 0;
    expect(one('sql`EXISTS (SELECT 1 FROM json_each(e.tags))`', 'json_each')).toBe(1);
    expect(one("sql.raw(`json_patch(coalesce(x, '{}'), ?)`)", 'json_patch')).toBe(1);
    expect(one("sql`strftime('%Y-%m', e.date, 'unixepoch')`", 'strftime')).toBe(1);
    expect(one("sql`strftime('%Y-%m', e.date, 'unixepoch')`", 'unixepoch')).toBe(1);
    expect(one('ORDER BY rowid', 'rowid')).toBe(1);
    expect(one('encrypt(x, { rowId, userId })', 'rowid')).toBe(0);
    expect(one('SELECT last_insert_rowid()', 'rowid')).toBe(1);
    expect(one('ORDER BY _rowid_', 'rowid')).toBe(1);
    expect(one('INSERT OR IGNORE INTO t', 'INSERT OR')).toBe(1);
    expect(one("sqlite.exec('PRAGMA foreign_keys = ON')", 'PRAGMA')).toBe(1);
    expect(one('FROM b CROSS JOIN expenses e ON e.date >= b.t0', 'CROSS JOIN … ON')).toBe(1);
    expect(one('FROM p CROSS JOIN vu', 'CROSS JOIN … ON')).toBe(0);
    expect(one('FROM b CROSS JOIN $' + '{expenses} e ON e.date >= b.t0', 'CROSS JOIN … ON')).toBe(
      1
    );
    expect(one('CROSS JOIN (SELECT id FROM t) s ON s.id = b.id', 'CROSS JOIN … ON')).toBe(1);
    expect(one('CROSS JOIN (SELECT max(id) FROM t) s ON s.id = b.id', 'CROSS JOIN … ON')).toBe(1);
    expect(one('CROSS JOIN "expenses" e ON e.id = b.id', 'CROSS JOIN … ON')).toBe(1);
    expect(one('CROSS JOIN json_each(e.tags) t ON 1', 'CROSS JOIN … ON')).toBe(1);
    expect(one('this.db.all<{ n: number }>(sql`SELECT 1`)', 'raw db/tx query')).toBe(1);
    expect(one('await tx.all(sql`SELECT 1`)', 'raw db/tx query')).toBe(1);
    expect(one('db.select().from(t).all()', 'raw db/tx query')).toBe(0);
    const builder = 'builder .all()/.get()/.run()';
    expect(one('db.select().from(t).all()', builder)).toBe(1);
    expect(one('tx.select().from(t)\n  .where(x)\n  .get()', builder)).toBe(1);
    expect(one('tx.insert(t).values(row).run()', builder)).toBe(1);
    expect(one('cache.get(key)', builder)).toBe(0);
    expect(one('groupBy(rows).values()', builder)).toBe(0);
    const stored = 'stored builder .all()/.get()/.run()';
    expect(one('const q = db.select().from(t);\nawait q.get()', stored)).toBe(1);
    expect(one('await this.pending.all()', stored)).toBe(1);
    expect(one('db.select().from(t).all()', stored)).toBe(0);
    expect(one('cache.get(key)', stored)).toBe(0);
    expect(one("code === 'SQLITE_CONSTRAINT_UNIQUE'", 'SQLITE_')).toBe(1);
    expect(one('SELECT name FROM sqlite_master', 'sqlite_master')).toBe(1);
    expect(one('lower(hex(randomblob(12)))', 'randomblob')).toBe(1);
    expect(one('conditions.push(sql`0`)', 'sql`0`/sql`1` predicate')).toBe(1);
    expect(one('const yes = sql<boolean>`1`', 'sql`0`/sql`1` predicate')).toBe(1);
    expect(one('// json_each in a comment\n/* rowid */', 'json_each')).toBe(0);
    expect(one('// json_each in a comment\n/* rowid */', 'rowid')).toBe(0);
    expect(one("const url = 'https://example.com'; json_each", 'json_each')).toBe(1);
    expect(productionSources().length).toBeGreaterThan(100);
    expect(productionSources().some((f) => f.startsWith(DIALECT_DIR))).toBe(false);
    const dialect = countConstructs(readFileSync(join(DIALECT_DIR, 'index.ts'), 'utf-8'));
    expect(dialect.get('json_each')).toBeGreaterThan(0);
  },
});
