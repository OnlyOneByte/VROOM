import { eq, and, gte, lte, sql, desc } from 'drizzle-orm';
import { db } from '../../db/connection.js';
import { expenses, vehicles } from '../../db/schema.js';
import type { Expense, NewExpense } from '../../db/schema.js';
import type { IExpenseRepository } from './interfaces.js';
import { BaseRepository } from './base.js';

export class ExpenseRepository extends BaseRepository<Expense, NewExpense> implements IExpenseRepository {
  constructor() {
    super(expenses);
  }

  async findByVehicleId(vehicleId: string): Promise<Expense[]> {
    try {
      const result = await db
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

  async findByVehicleIdAndDateRange(vehicleId: string, startDate: Date, endDate: Date): Promise<Expense[]> {
    try {
      const result = await db
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
      const result = await db
        .select({
          id: expenses.id,
          vehicleId: expenses.vehicleId,
          type: expenses.type,
          category: expenses.category,
          amount: expenses.amount,
          currency: expenses.currency,
          date: expenses.date,
          mileage: expenses.mileage,
          gallons: expenses.gallons,
          description: expenses.description,
          receiptUrl: expenses.receiptUrl,
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

  async findByType(vehicleId: string, type: string): Promise<Expense[]> {
    try {
      const result = await db
        .select()
        .from(expenses)
        .where(and(eq(expenses.vehicleId, vehicleId), eq(expenses.type, type)))
        .orderBy(desc(expenses.date));
      return result;
    } catch (error) {
      console.error(`Error finding expenses by type ${type} for vehicle ${vehicleId}:`, error);
      throw new Error('Failed to find expenses by type');
    }
  }

  async findByCategory(vehicleId: string, category: string): Promise<Expense[]> {
    try {
      const result = await db
        .select()
        .from(expenses)
        .where(and(eq(expenses.vehicleId, vehicleId), eq(expenses.category, category)))
        .orderBy(desc(expenses.date));
      return result;
    } catch (error) {
      console.error(`Error finding expenses by category ${category} for vehicle ${vehicleId}:`, error);
      throw new Error('Failed to find expenses by category');
    }
  }

  async findFuelExpenses(vehicleId: string): Promise<Expense[]> {
    try {
      const result = await db
        .select()
        .from(expenses)
        .where(and(eq(expenses.vehicleId, vehicleId), eq(expenses.type, 'fuel')))
        .orderBy(desc(expenses.date));
      return result;
    } catch (error) {
      console.error(`Error finding fuel expenses for vehicle ${vehicleId}:`, error);
      throw new Error('Failed to find fuel expenses');
    }
  }

  async batchCreate(expenseList: NewExpense[]): Promise<Expense[]> {
    try {
      const result = await db.insert(expenses).values(expenseList).returning();
      return result;
    } catch (error) {
      console.error('Error batch creating expenses:', error);
      throw new Error('Failed to batch create expenses');
    }
  }

  async getTotalByCategory(vehicleId: string, startDate?: Date, endDate?: Date): Promise<{ category: string; total: number }[]> {
    try {
      let query = db
        .select({
          category: expenses.category,
          total: sql<number>`sum(${expenses.amount})`.as('total'),
        })
        .from(expenses)
        .where(eq(expenses.vehicleId, vehicleId))
        .groupBy(expenses.category);

      if (startDate && endDate) {
        query = query.where(
          and(
            eq(expenses.vehicleId, vehicleId),
            gte(expenses.date, startDate),
            lte(expenses.date, endDate)
          )
        );
      }

      const result = await query;
      return result.map(row => ({
        category: row.category,
        total: Number(row.total) || 0,
      }));
    } catch (error) {
      console.error(`Error getting total by category for vehicle ${vehicleId}:`, error);
      throw new Error('Failed to get total by category');
    }
  }

  async getMonthlyTotals(vehicleId: string, year: number): Promise<{ month: number; total: number }[]> {
    try {
      const result = await db
        .select({
          month: sql<number>`cast(strftime('%m', ${expenses.date}) as integer)`.as('month'),
          total: sql<number>`sum(${expenses.amount})`.as('total'),
        })
        .from(expenses)
        .where(
          and(
            eq(expenses.vehicleId, vehicleId),
            sql`strftime('%Y', ${expenses.date}) = ${year.toString()}`
          )
        )
        .groupBy(sql`strftime('%m', ${expenses.date})`)
        .orderBy(sql`month`);

      return result.map(row => ({
        month: row.month,
        total: Number(row.total) || 0,
      }));
    } catch (error) {
      console.error(`Error getting monthly totals for vehicle ${vehicleId} in year ${year}:`, error);
      throw new Error('Failed to get monthly totals');
    }
  }
}