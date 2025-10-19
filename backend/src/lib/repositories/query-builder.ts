import type { SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

/**
 * QueryBuilder provides reusable query patterns to reduce code duplication
 * across repositories. It handles common operations like findOne, findMany,
 * and exists checks with consistent error handling.
 */
export class QueryBuilder<T> {
  constructor(private db: BunSQLiteDatabase<Record<string, unknown>>) {}

  /**
   * Find a single record matching the where clause
   * @param table - The table to query
   * @param where - The where clause
   * @param orderBy - Optional order by clause
   * @returns The first matching record or null
   */
  async findOne<TResult = T>(
    table: SQLiteTable,
    where: SQL,
    orderBy?: SQL
  ): Promise<TResult | null> {
    let query = this.db.select().from(table).where(where).limit(1);

    if (orderBy) {
      query = query.orderBy(orderBy) as typeof query;
    }

    const result = await query;
    return (result[0] as TResult) || null;
  }

  /**
   * Find multiple records matching the where clause
   * @param table - The table to query
   * @param where - Optional where clause
   * @param orderBy - Optional order by clause
   * @param limit - Optional limit
   * @returns Array of matching records
   */
  async findMany<TResult = T>(
    table: SQLiteTable,
    where?: SQL,
    orderBy?: SQL,
    limit?: number
  ): Promise<TResult[]> {
    let query = this.db.select().from(table);

    if (where) {
      query = query.where(where) as typeof query;
    }

    if (orderBy) {
      query = query.orderBy(orderBy) as typeof query;
    }

    if (limit) {
      query = query.limit(limit) as typeof query;
    }

    return query as Promise<TResult[]>;
  }

  /**
   * Check if a record exists matching the where clause
   * @param table - The table to query
   * @param where - The where clause
   * @returns True if at least one record exists
   */
  async exists(table: SQLiteTable, where: SQL): Promise<boolean> {
    const result = await this.db.select({ count: sql<number>`count(*)` }).from(table).where(where);

    return Number(result[0]?.count) > 0;
  }

  /**
   * Count records matching the where clause
   * @param table - The table to query
   * @param where - Optional where clause
   * @returns The count of matching records
   */
  async count(table: SQLiteTable, where?: SQL): Promise<number> {
    let query = this.db.select({ count: sql<number>`count(*)` }).from(table);

    if (where) {
      query = query.where(where) as typeof query;
    }

    const result = await query;
    return Number(result[0]?.count) || 0;
  }
}
