import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { openAsyncPostgres, portableDatabase } from '../async-postgres';
import { openAsyncDatabase, sqliteOnlyMethods } from '../async-sqlite';

function members(target: object): Map<string, string> {
  const found = new Map<string, string>();
  for (let o: object | null = target; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    for (const name of Object.getOwnPropertyNames(o)) {
      if (name === 'constructor' || found.has(name)) continue;
      const kind = typeof (target as Record<string, unknown>)[name];
      if (kind === 'function' || name === 'query') found.set(name, kind);
    }
  }
  return found;
}

const sqlite = openAsyncDatabase(new Database(':memory:')).db;
const pg = portableDatabase(openAsyncPostgres({ query: async () => [] }).db);

describe('the shared database type', () => {
  const portable = [...members(sqlite)].filter(
    ([name]) => !(sqliteOnlyMethods as readonly string[]).includes(name)
  );

  test('covers the query surface the repositories use', () => {
    const names = portable.map(([name]) => name);
    for (const name of ['select', 'insert', 'update', 'delete', 'transaction', 'query']) {
      expect(names).toContain(name);
    }
  });

  test('every member it keeps from SQLite exists on the Postgres database too', () => {
    const onPg = members(pg);
    const missing = portable.filter(([name, kind]) => onPg.get(name) !== kind).map(([n]) => n);
    expect(missing, 'add these to sqliteOnlyMethods or give Postgres an equivalent').toEqual([]);
  });

  test('leaves out the SQLite-only methods, which Postgres lacks', () => {
    const onPg = members(pg);
    for (const name of sqliteOnlyMethods.filter((n) => n !== '$client')) {
      expect(onPg.has(name), name).toBe(false);
    }
  });
});
