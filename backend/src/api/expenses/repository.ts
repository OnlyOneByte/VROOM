import { createId } from '@paralleldrive/cuid2';
import { and, asc, desc, eq, gte, inArray, lte, type SQL, sql } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { getDb } from '../../db/connection';
import type {
  Expense,
  ExpenseGroup,
  NewExpense,
  NewExpenseGroup,
  SplitConfig,
} from '../../db/schema';
import { expenseGroups, expenses, vehicles } from '../../db/schema';
import { DatabaseError, NotFoundError } from '../../errors';
import { logger } from '../../utils/logger';
import { BaseRepository } from '../../utils/repository';
import { expenseSplitService } from './split-service';

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

  async findFinancingByVehicleId(vehicleId: string): Promise<Expense[]> {
    try {
      return await this.db
        .select()
        .from(expenses)
        .where(and(eq(expenses.vehicleId, vehicleId), eq(expenses.isFinancingPayment, true)))
        .orderBy(asc(expenses.date));
    } catch (error) {
      logger.error('Failed to find financing expenses for vehicle', {
        vehicleId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to find financing expenses', error);
    }
  }
  // ===========================================================================
  // Expense Group Methods
  // ===========================================================================

  /**
   * Validate that all vehicle IDs in a split config belong to the given user.
   * Throws NotFoundError if any vehicle is not found or not owned.
   */
  private async validateVehicleOwnership(splitConfig: SplitConfig, userId: string): Promise<void> {
    const vehicleIds =
      splitConfig.method === 'even'
        ? splitConfig.vehicleIds
        : splitConfig.allocations.map((a) => a.vehicleId);

    const ownedVehicles = await this.db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(and(eq(vehicles.userId, userId), inArray(vehicles.id, vehicleIds)));

    const ownedIds = new Set(ownedVehicles.map((v) => v.id));
    for (const vid of vehicleIds) {
      if (!ownedIds.has(vid)) {
        throw new NotFoundError('Vehicle');
      }
    }
  }

  /**
   * Create an expense group and materialize child expenses.
   * Validates vehicle ownership, inserts group, calls materializeChildren.
   */
  async createExpenseGroup(
    data: {
      splitConfig: SplitConfig;
      category: string;
      tags?: string[];
      date: Date;
      description?: string;
      totalAmount: number;
      insurancePolicyId?: string;
      insuranceTermId?: string;
    },
    userId: string
  ): Promise<{ group: ExpenseGroup; children: Expense[] }> {
    try {
      await this.validateVehicleOwnership(data.splitConfig, userId);

      return await this.db.transaction(async (tx) => {
        const groupId = createId();
        const now = new Date();

        const newGroup: NewExpenseGroup = {
          id: groupId,
          userId,
          splitConfig: data.splitConfig,
          category: data.category,
          tags: data.tags ?? null,
          date: data.date,
          description: data.description ?? null,
          totalAmount: data.totalAmount,
          insurancePolicyId: data.insurancePolicyId ?? null,
          insuranceTermId: data.insuranceTermId ?? null,
          createdAt: now,
          updatedAt: now,
        };

        const [group] = await tx.insert(expenseGroups).values(newGroup).returning();
        const children = await expenseSplitService.materializeChildren(tx, group);

        return { group, children };
      });
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      logger.error('Failed to create expense group', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to create expense group', error);
    }
  }

  /**
   * Get an expense group with its children. Validates user ownership.
   */
  async getExpenseGroup(
    groupId: string,
    userId: string
  ): Promise<{ group: ExpenseGroup; children: Expense[] }> {
    const groupRows = await this.db
      .select()
      .from(expenseGroups)
      .where(and(eq(expenseGroups.id, groupId), eq(expenseGroups.userId, userId)))
      .limit(1);

    const group = groupRows[0];
    if (!group) {
      throw new NotFoundError('Expense group');
    }

    const children = await this.db
      .select()
      .from(expenses)
      .where(eq(expenses.expenseGroupId, groupId));

    return { group, children };
  }

  /**
   * Delete an expense group and its children.
   * Children are deleted first (application-level cascade), then the group.
   */
  async deleteExpenseGroup(groupId: string, userId: string): Promise<void> {
    const groupRows = await this.db
      .select()
      .from(expenseGroups)
      .where(and(eq(expenseGroups.id, groupId), eq(expenseGroups.userId, userId)))
      .limit(1);

    if (!groupRows[0]) {
      throw new NotFoundError('Expense group');
    }

    try {
      await this.db.transaction(async (tx) => {
        // Delete children first (application-level cascade)
        await tx.delete(expenses).where(eq(expenses.expenseGroupId, groupId));
        // Then delete the group
        await tx.delete(expenseGroups).where(eq(expenseGroups.id, groupId));
      });
    } catch (error) {
      logger.error('Failed to delete expense group', {
        groupId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to delete expense group', error);
    }
  }

  /**
   * Update an expense group's split config and regenerate children.
   * Validates ownership and optionally vehicle ownership for new config.
   */
  async updateExpenseGroup(
    groupId: string,
    data: { splitConfig: SplitConfig; totalAmount?: number },
    userId: string
  ): Promise<{ group: ExpenseGroup; children: Expense[] }> {
    const groupRows = await this.db
      .select()
      .from(expenseGroups)
      .where(and(eq(expenseGroups.id, groupId), eq(expenseGroups.userId, userId)))
      .limit(1);

    if (!groupRows[0]) {
      throw new NotFoundError('Expense group');
    }

    try {
      await this.validateVehicleOwnership(data.splitConfig, userId);

      return await this.db.transaction(async (tx) => {
        return expenseSplitService.updateSplit(tx, groupId, data.splitConfig, data.totalAmount);
      });
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      logger.error('Failed to update expense group', {
        groupId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to update expense group', error);
    }
  }
}

// Export singleton instance
export const expenseRepository = new ExpenseRepository(getDb());
