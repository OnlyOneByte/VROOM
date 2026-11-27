import { type Column, type SQL, type SQLWrapper, sql } from 'drizzle-orm';

// Timestamp columns store Unix seconds. 'unixepoch' is required, or SQLite reads the value as a Julian day.
export function extractMonth(column: Column): SQL<number> {
  return sql<number>`cast(strftime('%m', ${column}, 'unixepoch') as integer)`;
}

export function formatYearMonth(column: Column): SQL<string> {
  return sql<string>`strftime('%Y-%m', ${column}, 'unixepoch')`;
}

export function toDateTimeString(column: Column): SQL<string> {
  return sql<string>`datetime(${column}, 'unixepoch')`;
}

export function sqlTrue(): SQL {
  return sql`TRUE`;
}

export function sqlFalse(): SQL {
  return sql`FALSE`;
}

export function jsonArraySome(array: SQLWrapper, test: (element: SQL) => SQL): SQL {
  return sql`EXISTS (SELECT 1 FROM json_each(${array}) AS je WHERE ${test(sql`je.value`)})`;
}

export function jsonArrayIsEmpty(array: SQLWrapper): SQL {
  return sql`NOT EXISTS (SELECT 1 FROM json_each(${array}))`;
}

export function leftJoinJsonArrayElements(
  array: SQLWrapper,
  alias: string
): { join: SQL; element: SQL } {
  const name = sql.identifier(alias);
  return {
    join: sql`LEFT JOIN json_each(${array}) AS ${name} ON ${sqlTrue()}`,
    element: sql`${name}.value`,
  };
}

export function rawJsonValue<T>(value: unknown): T | null {
  if (value == null || value === '') return null;
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

const SQL_TYPES = { bigint: 'INTEGER', real: 'REAL', text: 'TEXT' } as const;

export function typedParam(value: string | number, type: keyof typeof SQL_TYPES): SQL {
  if (type === 'bigint' && !Number.isSafeInteger(value)) {
    throw new TypeError(`typedParam: ${String(value)} is not a whole number`);
  }
  return sql`CAST(${value} AS ${sql.raw(SQL_TYPES[type])})`;
}

export interface RawQueryable {
  all<T>(query: SQL): T[] | Promise<T[]>;
}

export async function rawAll<T>(db: RawQueryable, query: SQL): Promise<T[]> {
  return db.all<T>(query);
}

export function jsonMergePatch(object: SQLWrapper, patch: Record<string, unknown>): SQL {
  return sql`json_patch(coalesce(${object}, '{}'), ${JSON.stringify(patch)})`;
}

export function jsonAddMissingEntries(
  object: SQLWrapper,
  parent: string,
  entries: Record<string, Record<string, unknown>>
): SQL {
  if (!/^[A-Za-z]\w*$/.test(parent)) {
    throw new TypeError(`jsonAddMissingEntries: bad key ${parent}`);
  }
  return Object.entries(entries).reduce(
    (merged, [key, value]) =>
      sql`json_patch(${merged}, json_object(${parent}, json_object(${key}, json(CASE WHEN EXISTS (SELECT 1 FROM json_each(${object}, ${`$.${parent}`}) WHERE key = ${key}) THEN '{}' ELSE ${JSON.stringify(value)} END))))`,
    sql`coalesce(${object}, '{}')`
  );
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
};

// bun:sqlite sets `code`; drizzle may wrap the driver error, so the cause chain is walked too.
function driverErrorCode(err: unknown): string | undefined {
  for (let e: unknown = err; e instanceof Error; e = e.cause) {
    const code = (e as Error & { code?: unknown }).code;
    if (typeof code === 'string' && code.startsWith('SQLITE_')) return code;
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
