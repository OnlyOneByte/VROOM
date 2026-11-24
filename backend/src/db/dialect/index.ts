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

export const sqlTrue: SQL = sql`1`;
export const sqlFalse: SQL = sql`0`;

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
    join: sql`LEFT JOIN json_each(${array}) AS ${name} ON ${sqlTrue}`,
    element: sql`${name}.value`,
  };
}

export function rawJsonValue<T>(value: unknown): T | null {
  if (value == null || value === '') return null;
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

const SQL_TYPES = { integer: sql`INTEGER`, real: sql`REAL`, text: sql`TEXT` } as const;

export function typedParam(value: string | number, type: keyof typeof SQL_TYPES): SQL {
  return sql`CAST(${value} AS ${SQL_TYPES[type]})`;
}

export interface RawQueryable {
  all<T>(query: SQL): T[];
}

export function rawAll<T>(db: RawQueryable, query: SQL): T[] {
  return db.all<T>(query);
}

export function jsonMergePatch(object: SQLWrapper, patch: Record<string, unknown>): SQL {
  return sql`json_patch(coalesce(${object}, '{}'), ${JSON.stringify(patch)})`;
}

export function countNum(expression: SQLWrapper = sql`*`): SQL<number> {
  return sql<number>`count(${expression})`.mapWith(Number);
}

export function sumNum(expression: SQLWrapper): SQL<number> {
  return sql<number>`COALESCE(SUM(${expression}), 0)`.mapWith(Number);
}

export type DbErrorKind = 'unique' | 'foreign_key' | 'not_null';

const UNIQUE_VIOLATION_CODES = new Set([
  'SQLITE_CONSTRAINT_UNIQUE',
  'SQLITE_CONSTRAINT_PRIMARYKEY',
]);

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
  if (code !== undefined && UNIQUE_VIOLATION_CODES.has(code)) return 'unique';
  if (!(err instanceof Error)) return null;
  if (err.message.includes('FOREIGN KEY constraint failed')) return 'foreign_key';
  if (err.message.includes('NOT NULL constraint failed')) return 'not_null';
  return null;
}
