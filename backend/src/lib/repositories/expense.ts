import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import type { Expense, NewExpense } from '../../db/schema.js';
import { expenses, vehicles } from '../../db/schema.js';
import { BaseRepository } from './base.js';
import type { IExpenseRepository } from './interfaces.js';

export class ExpenseRepository
  extends BaseRepository<Expense, NewExpense>
  implements IExpenseRepository
{
  constructor() {
    super(expenses);
  }

  async findByVehicleId(vehicleId: string): Promise<Expense[]> {
    try {
      const result = await this.database
        .select()
        .from(expenses)
        .where(eq(expenses.vehicleId, vehicleId))
        .orderBy(desc(expenses.date));
      return result;
    } catch (error) {
      console.error(`Error finding expenses for vehicle ${vehicleId}:`, error);
      throw new Error('Failed to find expenses for vehicle');
    }
  }

  async findByVehicleIdAndDateRange(
    vehicleId: string,
    startDate: Date,
    endDate: Date
  ): Promise<Expense[]> {
    try {
      const result = await this.database
        .select()
        .from(expenses)
        .where(
          and(
            eq(expenses.vehicleId, vehicleId),
            gte(expenses.date, startDate),
            lte(expenses.date, endDate)
          )
        )
        .orderBy(desc(expenses.date));
      return result;
    } catch (error) {
      console.error(`Error finding expenses for vehicle ${vehicleId} in date range:`, error);
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
          gallons: expenses.gallons,
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
      console.error(`Error finding expenses for user ${userId}:`, error);
      throw new Error('Failed to find expenses for user');
    }
  }

  /**
   * @deprecated Use findByCategory or filter by tags instead. The type field is deprecated.
   */
  async findByType(vehicleId: string, _type: string): Promise<Expense[]> {
    try {
      // Type field is deprecated, return all expenses for the vehicle
      const result = await this.database
        .select()
        .from(expenses)
        .where(eq(expenses.vehicleId, vehicleId))
        .orderBy(desc(expenses.date));
      return result;
    } catch (error) {
      console.error(`Error finding expenses for vehicle ${vehicleId}:`, error);
      throw new Error('Failed to find expenses');
    }
  }

  async findByCategory(vehicleId: string, category: string): Promise<Expense[]> {
    try {
      const result = await this.database
        .select()
        .from(expenses)
        .where(and(eq(expenses.vehicleId, vehicleId), eq(expenses.category, category)))
        .orderBy(desc(expenses.date));
      return result;
    } catch (error) {
      console.error(
        `Error finding expenses by category ${category} for vehicle ${vehicleId}:`,
        error
      );
      throw new Error('Failed to find expenses by category');
    }
  }

  async findFuelExpenses(vehicleId: string): Promise<Expense[]> {
    try {
      const result = await this.database
        .select()
        .from(expenses)
        .where(and(eq(expenses.vehicleId, vehicleId), eq(expenses.category, 'fuel')))
        .orderBy(desc(expenses.date));
      return result;
    } catch (error) {
      console.error(`Error finding fuel expenses for vehicle ${vehicleId}:`, error);
      throw new Error('Failed to find fuel expenses');
    }
  }

  async batchCreate(expenseList: NewExpense[]): Promise<Expense[]> {
    try {
      const result = await this.database.insert(expenses).values(expenseList).returning();
      return result;
    } catch (error) {
      console.error('Error batch creating expenses:', error);
      throw new Error('Failed to batch create expenses');
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
      console.error(`Error getting total by category for vehicle ${vehicleId}:`, error);
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
      console.error(
        `Error getting monthly totals for vehicle ${vehicleId} in year ${year}:`,
        error
      );
      throw new Error('Failed to get monthly totals');
    }
  }
}
