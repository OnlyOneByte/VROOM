import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { inject, injectable } from 'inversify';
import type { Expense, NewExpense } from '../../db/schema.js';
import { expenses, vehicles } from '../../db/schema.js';
import { TYPES } from '../di/types.js';
import { DatabaseError } from '../errors.js';
import { logger } from '../utils/logger.js';
import { BaseRepository } from './base.js';
import type { IExpenseRepository } from './interfaces.js';
import { QueryBuilder } from './query-builder.js';

@injectable()
export class ExpenseRepository
  extends BaseRepository<Expense, NewExpense>
  implements IExpenseRepository
{
  private queryBuilder: QueryBuilder<Expense>;

  constructor(@inject(TYPES.Database) db: BunSQLiteDatabase<Record<string, unknown>>) {
    super(db, expenses);
    this.queryBuilder = new QueryBuilder(this.database);
  }

  async findByVehicleId(vehicleId: string): Promise<Expense[]> {
    try {
      return await this.queryBuilder.findMany(
        expenses,
        eq(expenses.vehicleId, vehicleId),
        desc(expenses.date)
      );
    } catch (error) {
      logger.error('Failed to find expenses by vehicle', {
        vehicleId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError(`Failed to find expenses for vehicle ${vehicleId}`, error);
    }
  }

  async findByVehicleIdAndDateRange(
    vehicleId: string,
    startDate: Date,
    endDate: Date
  ): Promise<Expense[]> {
    try {
      return await this.queryBuilder.findMany(
        expenses,
        and(
          eq(expenses.vehicleId, vehicleId),
          gte(expenses.date, startDate),
          lte(expenses.date, endDate)
        ),
        desc(expenses.date)
      );
    } catch (error) {
      logger.error('Error finding expenses for vehicle in date range', { vehicleId, error });
      throw new Error('Failed to find expenses for date range');
    }
  }

  async findByUserId(userId: string): Promise<Expense[]> {
    try {
      const result = await this.database
        .select({
          id: expenses.id,
          vehicleId: expenses.vehicleId,
          category: expenses.category,
          amount: expenses.amount,
          currency: expenses.currency,
          date: expenses.date,
          mileage: expenses.mileage,
          volume: expenses.volume,
          charge: expenses.charge,
          description: expenses.description,
          receiptUrl: expenses.receiptUrl,
          tags: expenses.tags,
          createdAt: expenses.createdAt,
          updatedAt: expenses.updatedAt,
        })
        .from(expenses)
        .innerJoin(vehicles, eq(expenses.vehicleId, vehicles.id))
        .where(eq(vehicles.userId, userId))
        .orderBy(desc(expenses.date));
      return result;
    } catch (error) {
      logger.error('Failed to find expenses by user', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError(`Failed to find expenses for user ${userId}`, error);
    }
  }

  async findByUserIdAndDateRange(
    userId: string,
    startDate: Date,
    endDate: Date
  ): Promise<Expense[]> {
    try {
      const result = await this.database
        .select({
          id: expenses.id,
          vehicleId: expenses.vehicleId,
          category: expenses.category,
          amount: expenses.amount,
          currency: expenses.currency,
          date: expenses.date,
          mileage: expenses.mileage,
          volume: expenses.volume,
          charge: expenses.charge,
          description: expenses.description,
          receiptUrl: expenses.receiptUrl,
          tags: expenses.tags,
          createdAt: expenses.createdAt,
          updatedAt: expenses.updatedAt,
        })
        .from(expenses)
        .innerJoin(vehicles, eq(expenses.vehicleId, vehicles.id))
        .where(
          and(
            eq(vehicles.userId, userId),
            gte(expenses.date, startDate),
            lte(expenses.date, endDate)
          )
        )
        .orderBy(desc(expenses.date));
      return result;
    } catch (error) {
      logger.error('Error finding expenses for user in date range', { userId, error });
      throw new Error('Failed to find expenses for user in date range');
    }
  }

  async findByCategory(vehicleId: string, category: string): Promise<Expense[]> {
    try {
      return await this.queryBuilder.findMany(
        expenses,
        and(eq(expenses.vehicleId, vehicleId), eq(expenses.category, category)),
        desc(expenses.date)
      );
    } catch (error) {
      logger.error('Error finding expenses by category for vehicle', {
        category,
        vehicleId,
        error,
      });
      throw new Error('Failed to find expenses by category');
    }
  }

  async findFuelExpenses(vehicleId: string): Promise<Expense[]> {
    try {
      return await this.queryBuilder.findMany(
        expenses,
        and(eq(expenses.vehicleId, vehicleId), eq(expenses.category, 'fuel')),
        desc(expenses.date)
      );
    } catch (error) {
      logger.error('Error finding fuel expenses for vehicle', { vehicleId, error });
      throw new Error('Failed to find fuel expenses');
    }
  }

  async batchCreate(expenseList: NewExpense[]): Promise<Expense[]> {
    try {
      const result = await this.database.insert(expenses).values(expenseList).returning();
      logger.info('Batch created expenses', { count: result.length });
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to batch create expenses', {
        count: expenseList.length,
        error: errorMessage,
      });

      // Handle specific SQLite errors
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

      const query = this.database
        .select({
          category: expenses.category,
          total: sql<number>`sum(${expenses.amount})`.as('total'),
        })
        .from(expenses)
        .where(and(...whereConditions))
        .groupBy(expenses.category);

      const result = await query;
      return result.map((row) => ({
        category: row.category,
        total: Number(row.total) || 0,
      }));
    } catch (error) {
      logger.error('Error getting total by category for vehicle', { vehicleId, error });
      throw new Error('Failed to get total by category');
    }
  }

  async getMonthlyTotals(
    vehicleId: string,
    year: number
  ): Promise<{ month: number; total: number }[]> {
    try {
      const startDate = new Date(year, 0, 1); // January 1st of the year
      const endDate = new Date(year, 11, 31, 23, 59, 59); // December 31st of the year

      const result = await this.database
        .select({
          month:
            sql<number>`cast(strftime('%m', datetime(${expenses.date} / 1000, 'unixepoch')) as integer)`.as(
              'month'
            ),
          total: sql<number>`sum(${expenses.amount})`.as('total'),
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
      throw new Error('Failed to get monthly totals');
    }
  }
}
