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

import { type Column, sql, type SQL } from 'drizzle-orm';

/**
 * Extract month number (1-12) from a Drizzle timestamp column.
 */
export function extractMonth(column: Column): SQL<number> {
	return sql<number>`cast(strftime('%m', ${column}) as integer)`;
}

/**
 * Format a Drizzle timestamp column as 'YYYY-MM' string.
 */
export function formatYearMonth(column: Column): SQL<string> {
	return sql<string>`strftime('%Y-%m', ${column})`;
}

/**
 * Convert a Drizzle timestamp column to an ISO datetime string.
 */
export function toDateTimeString(column: Column): SQL<string> {
	return sql<string>`datetime(${column}, 'unixepoch')`;
}
