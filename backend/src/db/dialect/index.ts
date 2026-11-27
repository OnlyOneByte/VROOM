import { type Column, type SQL, type SQLWrapper, sql } from 'drizzle-orm';
import { ACTIVE_DIALECT, type DialectName } from './active';

const SQL_TYPES = {
  sqlite: { bigint: 'INTEGER', real: 'REAL', text: 'TEXT' },
  pg: { bigint: 'BIGINT', real: 'DOUBLE PRECISION', text: 'TEXT' },
} as const;

type SqlType = keyof (typeof SQL_TYPES)['sqlite'];

export interface DialectSql {
  extractMonth(column: Column): SQL<number>;
  formatYearMonth(column: Column): SQL<string>;
  toDateTimeString(column: Column): SQL<string>;
  jsonArraySome(array: SQLWrapper, test: (element: SQL) => SQL): SQL;
  jsonArrayIsEmpty(array: SQLWrapper): SQL;
  leftJoinJsonArrayElements(array: SQLWrapper, alias: string): { join: SQL; element: SQL };
  typedParam(value: string | number, type: SqlType): SQL;
  jsonMergePatch(object: SQLWrapper, patch: Record<string, unknown>): SQL;
  jsonAddMissingEntries(
    object: SQLWrapper,
    parent: string,
    entries: Record<string, Record<string, unknown>>
  ): SQL;
}

function checkedParam(value: string | number, type: SqlType): string | number {
  if (type === 'bigint' && !Number.isSafeInteger(value)) {
    throw new TypeError(`typedParam: ${String(value)} is not a whole number`);
  }
  return value;
}

function checkedParent(parent: string): string {
  if (!/^[A-Za-z]\w*$/.test(parent)) {
    throw new TypeError(`jsonAddMissingEntries: bad key ${parent}`);
  }
  return parent;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const sqliteSql: DialectSql = {
  // Timestamp columns store Unix seconds. 'unixepoch' is required, or SQLite reads the value as a Julian day.
  extractMonth: (column) => sql<number>`cast(strftime('%m', ${column}, 'unixepoch') as integer)`,
  formatYearMonth: (column) => sql<string>`strftime('%Y-%m', ${column}, 'unixepoch')`,
  toDateTimeString: (column) => sql<string>`datetime(${column}, 'unixepoch')`,
  jsonArraySome: (array, test) =>
    sql`EXISTS (SELECT 1 FROM json_each(${array}) AS je WHERE ${test(sql`je.value`)})`,
  jsonArrayIsEmpty: (array) => sql`NOT EXISTS (SELECT 1 FROM json_each(${array}))`,
  leftJoinJsonArrayElements: (array, alias) => {
    const name = sql.identifier(alias);
    return {
      join: sql`LEFT JOIN json_each(${array}) AS ${name} ON ${sqlTrue()}`,
      element: sql`${name}.value`,
    };
  },
  typedParam: (value, type) =>
    sql`CAST(${checkedParam(value, type)} AS ${sql.raw(SQL_TYPES.sqlite[type])})`,
  jsonMergePatch: (object, patch) =>
    sql`json_patch(coalesce(${object}, '{}'), ${JSON.stringify(patch)})`,
  jsonAddMissingEntries: (object, parent, entries) => {
    const key = checkedParent(parent);
    return Object.entries(entries).reduce(
      (merged, [entry, value]) =>
        sql`json_patch(${merged}, json_object(${key}, json_object(${entry}, json(CASE WHEN EXISTS (SELECT 1 FROM json_each(${object}, ${`$.${key}`}) WHERE key = ${entry}) THEN '{}' ELSE ${JSON.stringify(value)} END))))`,
      sql`coalesce(${object}, '{}')`
    );
  },
};

const utc = (column: Column) => sql`(to_timestamp(${column}) AT TIME ZONE 'UTC')`;
const jsonb = (value: SQLWrapper) => sql`(${value})::jsonb`;

function pgMergePatch(target: SQL, patch: Record<string, unknown>): SQL {
  return Object.entries(patch).reduce((merged, [key, value]) => {
    const name = sql`${key}::text`;
    if (value === null) return sql`(${merged} - ${name})`;
    if (isPlainObject(value)) {
      const child = sql`(CASE WHEN jsonb_typeof(${merged} -> ${name}) = 'object' THEN ${merged} -> ${name} ELSE '{}'::jsonb END)`;
      return sql`(${merged} || jsonb_build_object(${name}, ${pgMergePatch(child, value)}))`;
    }
    return sql`(${merged} || jsonb_build_object(${name}, ${JSON.stringify(value)}::jsonb))`;
  }, target);
}

const pgSql: DialectSql = {
  extractMonth: (column) => sql<number>`cast(extract(month from ${utc(column)}) as integer)`,
  formatYearMonth: (column) => sql<string>`to_char(${utc(column)}, 'YYYY-MM')`,
  toDateTimeString: (column) => sql<string>`to_char(${utc(column)}, 'YYYY-MM-DD HH24:MI:SS')`,
  jsonArraySome: (array, test) =>
    sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${jsonb(array)}) AS je(value) WHERE ${test(sql`je.value`)})`,
  jsonArrayIsEmpty: (array) =>
    sql`NOT EXISTS (SELECT 1 FROM jsonb_array_elements(${jsonb(array)}))`,
  leftJoinJsonArrayElements: (array, alias) => {
    const name = sql.identifier(alias);
    return {
      join: sql`LEFT JOIN LATERAL jsonb_array_elements_text(${jsonb(array)}) AS ${name}(value) ON ${sqlTrue()}`,
      element: sql`${name}.value`,
    };
  },
  typedParam: (value, type) =>
    sql`CAST(${checkedParam(value, type)} AS ${sql.raw(SQL_TYPES.pg[type])})`,
  jsonMergePatch: (object, patch) =>
    pgMergePatch(sql`coalesce(${jsonb(object)}, '{}'::jsonb)`, patch),
  jsonAddMissingEntries: (object, parent, entries) => {
    const key = sql`${checkedParent(parent)}::text`;
    const original = sql`coalesce(${jsonb(object)}, '{}'::jsonb)`;
    return Object.entries(entries).reduce(
      (merged, [entry, value]) =>
        sql`(CASE WHEN jsonb_typeof(${original} -> ${key}) = 'object' AND (${original} -> ${key}) ? ${entry}::text THEN ${merged} ELSE jsonb_set(${merged}, ARRAY[${key}], (CASE WHEN jsonb_typeof(${merged} -> ${key}) = 'object' THEN ${merged} -> ${key} ELSE '{}'::jsonb END) || jsonb_build_object(${entry}::text, ${JSON.stringify(value)}::jsonb)) END)`,
      original
    );
  },
};

export const DIALECT_SQL: Record<DialectName, DialectSql> = { sqlite: sqliteSql, pg: pgSql };

const active = DIALECT_SQL[ACTIVE_DIALECT];

export const {
  extractMonth,
  formatYearMonth,
  toDateTimeString,
  jsonArraySome,
  jsonArrayIsEmpty,
  leftJoinJsonArrayElements,
  typedParam,
  jsonMergePatch,
  jsonAddMissingEntries,
} = active;

export function sqlTrue(): SQL {
  return sql`TRUE`;
}

export function sqlFalse(): SQL {
  return sql`FALSE`;
}

export function rawJsonValue<T>(value: unknown): T | null {
  if (value == null || value === '') return null;
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

export interface RawQueryable {
  all<T>(query: SQL): T[] | Promise<T[]>;
}

export async function rawAll<T>(db: RawQueryable, query: SQL): Promise<T[]> {
  return db.all<T>(query);
}

export function countNum(expression: SQLWrapper = sql`*`): SQL<number> {
  return sql<number>`count(${expression})`.mapWith(Number);
}

export function sumNum(expression: SQLWrapper): SQL<number> {
  return sql<number>`COALESCE(SUM(${expression}), 0)`.mapWith(Number);
}

export const UPKEEP_QUERIES = {
  health: 'SELECT 1 as health',
  checkpoint: 'PRAGMA wal_checkpoint(TRUNCATE)',
  forceCheckpoint: 'PRAGMA wal_checkpoint(RESTART)',
} as const;

export type DbErrorKind = 'unique' | 'foreign_key' | 'not_null';

const DRIVER_CODE_KINDS: Record<string, DbErrorKind> = {
  SQLITE_CONSTRAINT_UNIQUE: 'unique',
  SQLITE_CONSTRAINT_PRIMARYKEY: 'unique',
  SQLITE_CONSTRAINT_FOREIGNKEY: 'foreign_key',
  SQLITE_CONSTRAINT_NOTNULL: 'not_null',
  '23505': 'unique',
  '23503': 'foreign_key',
  '23502': 'not_null',
};

const SQLSTATE = /^\d{2}[0-9A-Z]{3}$/;

function codeOf(e: Error): string | undefined {
  const { code, errno } = e as Error & { code?: unknown; errno?: unknown };
  if (typeof code === 'string' && (code.startsWith('SQLITE_') || SQLSTATE.test(code))) return code;
  if (typeof errno === 'string' && SQLSTATE.test(errno)) return errno;
  return undefined;
}

// bun:sqlite sets `code`; drizzle may wrap the driver error, so the cause chain is walked too.
function driverErrorCode(err: unknown): string | undefined {
  for (let e: unknown = err; e instanceof Error; e = e.cause) {
    const code = codeOf(e);
    if (code !== undefined) return code;
  }
  return undefined;
}

export function isDriverError(err: unknown): boolean {
  return driverErrorCode(err) !== undefined;
}

export function looksLikeDriverError(err: unknown): boolean {
  return isDriverError(err) || (err instanceof Error && err.message.includes('SQLITE_'));
}

export function classifyDbError(err: unknown): DbErrorKind | null {
  const code = driverErrorCode(err);
  if (code !== undefined) return DRIVER_CODE_KINDS[code] ?? null;
  if (!(err instanceof Error) || err.cause !== undefined) return null;
  if (err.message.includes('FOREIGN KEY constraint failed')) return 'foreign_key';
  if (err.message.includes('NOT NULL constraint failed')) return 'not_null';
  return null;
}
