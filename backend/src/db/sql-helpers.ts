/**
 * Dialect-aware SQL helpers for date/time operations.
 *
 * Currently implements SQLite syntax. When adding PostgreSQL support,
 * swap implementations based on DB_DIALECT env var:
 *   - extractMonth:    EXTRACT(MONTH FROM col)::integer
 *   - formatYearMonth: to_char(col, 'YYYY-MM')
 *   - toDateTimeString: col::text (PG timestamps are already ISO)
 *
 * These helpers abstract the only SQLite-specific raw SQL in the codebase,
 * keeping all other queries portable via Drizzle's query builder.
 */

import { type Column, type SQL, sql } from 'drizzle-orm';

/**
 * Extract month number (1-12) from a Drizzle timestamp column.
 *
 * The column is stored as a Unix-epoch integer (Drizzle `mode: 'timestamp'` =
 * SECONDS), so strftime MUST be told 'unixepoch' — without it SQLite reads the
 * integer as a Julian day number and returns wrong/garbage months. (PostgreSQL
 * swap: EXTRACT(MONTH FROM col)::integer — no unixepoch needed.)
 */
export function extractMonth(column: Column): SQL<number> {
  return sql<number>`cast(strftime('%m', ${column}, 'unixepoch') as integer)`;
}

/**
 * Format a Drizzle timestamp column as 'YYYY-MM' string.
 *
 * MUST pass 'unixepoch' — the column is Unix SECONDS (Drizzle `mode: 'timestamp'`).
 * Omitting it made the monthly-trend GROUP BY collapse distinct months into bogus
 * buckets, which surfaced as blank dashboard charts + a $0 monthly average.
 * (PostgreSQL swap: to_char(col, 'YYYY-MM').)
 */
export function formatYearMonth(column: Column): SQL<string> {
  return sql<string>`strftime('%Y-%m', ${column}, 'unixepoch')`;
}

/**
 * Convert a Drizzle timestamp column to an ISO datetime string.
 */
export function toDateTimeString(column: Column): SQL<string> {
  return sql<string>`datetime(${column}, 'unixepoch')`;
}
