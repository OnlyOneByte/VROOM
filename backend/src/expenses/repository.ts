import { and, desc, eq, gte, lte, type SQL, sql } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { getDb } from '../db/connection';
import type { Expense, NewExpense } from '../db/schema';
import { expenses, vehicles } from '../db/schema';
import { DatabaseError } from '../errors';
import { BaseRepository } from '../utils/base-repository';
import { logger } from '../utils/logger';

export interface ExpenseFilters {
  vehicleId?: string;
  userId?: string;
  category?: string;
  startDate?: Date;
  endDate?: Date;
}

export class ExpenseRepository extends BaseRepository<Expense, NewExpense> {
  constructor(db: BunSQLiteDatabase<Record<string, unknown>>) {
    super(db, expenses);
  }

  /**
   * Unified find method with optional filters
   * Replaces: findByVehicleId, findByUserId, findByCategory, findByVehicleIdAndDateRange, etc.
   */
  async find(filters: ExpenseFilters = {}): Promise<Expense[]> {
    try {
      const conditions: SQL[] = [];

      // Build WHERE conditions based on provided filters
      if (filters.vehicleId) {
        conditions.push(eq(expenses.vehicleId, filters.vehicleId));
      }

      if (filters.category) {
        conditions.push(eq(expenses.category, filters.category));
      }

      if (filters.startDate) {
        conditions.push(gte(expenses.date, filters.startDate));
      }

      if (filters.endDate) {
        conditions.push(lte(expenses.date, filters.endDate));
      }

      // If userId is provided, we need to join with vehicles table
      if (filters.userId) {
        const result = await this.db
          .select()
          .from(expenses)
          .innerJoin(vehicles, eq(expenses.vehicleId, vehicles.id))
          .where(and(eq(vehicles.userId, filters.userId), ...conditions))
          .orderBy(desc(expenses.date));

        return result.map((row) => row.expenses);
      }

      // Simple query without join
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
      return await this.db.select().from(expenses).where(whereClause).orderBy(desc(expenses.date));
    } catch (error) {
      logger.error('Failed to find expenses', {
        filters,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to find expenses', error);
    }
  }

  async batchCreate(expenseList: NewExpense[]): Promise<Expense[]> {
    try {
      const result = await this.db.insert(expenses).values(expenseList).returning();
      logger.info('Batch created expenses', { count: result.length });
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to batch create expenses', {
        count: expenseList.length,
        error: errorMessage,
      });

      if (errorMessage.includes('FOREIGN KEY constraint')) {
        throw new DatabaseError('Invalid vehicle reference in batch expense creation', error);
      }

      throw new DatabaseError('Failed to batch create expenses', error);
    }
  }

  async getTotalByCategory(
    vehicleId: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<{ category: string; total: number }[]> {
    try {
      const whereConditions = [eq(expenses.vehicleId, vehicleId)];

      if (startDate && endDate) {
        whereConditions.push(gte(expenses.date, startDate));
        whereConditions.push(lte(expenses.date, endDate));
      }

      const result = await this.db
        .select({
          category: expenses.category,
          total: sql<number>`sum(${expenses.expenseAmount})`.as('total'),
        })
        .from(expenses)
        .where(and(...whereConditions))
        .groupBy(expenses.category);

      return result.map((row) => ({
        category: row.category,
        total: Number(row.total) || 0,
      }));
    } catch (error) {
      logger.error('Error getting total by category for vehicle', { vehicleId, error });
      throw new DatabaseError('Failed to get total by category', error);
    }
  }

  async getMonthlyTotals(
    vehicleId: string,
    year: number
  ): Promise<{ month: number; total: number }[]> {
    try {
      const startDate = new Date(year, 0, 1);
      const endDate = new Date(year, 11, 31, 23, 59, 59);

      const result = await this.db
        .select({
          month:
            sql<number>`cast(strftime('%m', datetime(${expenses.date} / 1000, 'unixepoch')) as integer)`.as(
              'month'
            ),
          total: sql<number>`sum(${expenses.expenseAmount})`.as('total'),
        })
        .from(expenses)
        .where(
          and(
            eq(expenses.vehicleId, vehicleId),
            gte(expenses.date, startDate),
            lte(expenses.date, endDate)
          )
        )
        .groupBy(sql`strftime('%m', datetime(${expenses.date} / 1000, 'unixepoch'))`)
        .orderBy(sql`month`);

      return result.map((row) => ({
        month: row.month,
        total: Number(row.total) || 0,
      }));
    } catch (error) {
      logger.error('Error getting monthly totals for vehicle', { vehicleId, year, error });
      throw new DatabaseError('Failed to get monthly totals', error);
    }
  }
}

// Export singleton instance
export const expenseRepository = new ExpenseRepository(getDb());
