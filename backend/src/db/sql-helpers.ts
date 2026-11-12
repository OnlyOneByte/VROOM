import { type Column, type SQL, sql } from 'drizzle-orm';

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
