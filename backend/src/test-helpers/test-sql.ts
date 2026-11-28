import type { Database } from 'bun:sqlite';
import { type PGlite, types } from '@electric-sql/pglite';

export type SqlParam = string | number | boolean | null | bigint | Uint8Array;

export interface TestSql {
  run(text: string, params?: readonly SqlParam[]): Promise<void>;
  get<T = Record<string, unknown>>(text: string, params?: readonly SqlParam[]): Promise<T | null>;
  all<T = Record<string, unknown>>(text: string, params?: readonly SqlParam[]): Promise<T[]>;
}

const PLACEHOLDER_OR_SKIPPED =
  /\b[Ee]'(?:[^'\\]|\\[\s\S]|'')*'|'(?:[^']|'')*'|"(?:[^"]|"")*"|\$(\w*)\$[\s\S]*?\$\1\$|--[^\n]*|\/\*[\s\S]*?\*\/|\?(\d*)/g;

export function positionalPlaceholders(text: string): string {
  let highest = 0;
  return text.replace(PLACEHOLDER_OR_SKIPPED, (match, _tag, index: string | undefined) => {
    if (!match.startsWith('?')) return match;
    const n = index ? Number(index) : highest + 1;
    highest = Math.max(highest, n);
    return `$${n}`;
  });
}

export function sqliteTestSql(db: Database): TestSql {
  return {
    async run(text, params = []) {
      db.run(text, params as SqlParam[]);
    },
    async get<T>(text: string, params: readonly SqlParam[] = []) {
      return (db.query(text).get(...(params as SqlParam[])) as T | null) ?? null;
    },
    async all<T>(text: string, params: readonly SqlParam[] = []) {
      return db.query(text).all(...(params as SqlParam[])) as T[];
    },
  };
}

const SQLITE_SHAPED = {
  [types.BOOL]: (value: string) => (value === 't' ? 1 : 0),
  [types.JSON]: (value: string) => value,
  [types.JSONB]: (value: string) => value,
  [types.NUMERIC]: (value: string) => Number(value),
};

export function pgliteTestSql(client: PGlite): TestSql {
  const rows = async <T>(text: string, params: readonly SqlParam[]) =>
    (
      await client.query<T>(positionalPlaceholders(text), [...params], {
        parsers: SQLITE_SHAPED,
      })
    ).rows;
  return {
    async run(text, params = []) {
      await rows(text, params);
    },
    async get<T>(text: string, params: readonly SqlParam[] = []) {
      return (await rows<T>(text, params))[0] ?? null;
    },
    all: (text, params = []) => rows(text, params),
  };
}
