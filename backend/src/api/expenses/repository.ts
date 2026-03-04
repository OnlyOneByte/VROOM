import { createId } from '@paralleldrive/cuid2';
import { and, asc, desc, eq, gte, inArray, lte, type SQL, sql } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { CONFIG } from '../../config';
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

export interface PaginatedExpenseFilters extends ExpenseFilters {
  limit?: number;
  offset?: number;
  tags?: string[];
}

export interface PaginatedResult<T> {
  data: T[];
  totalCount: number;
}

export interface ExpenseSummaryFilters {
  userId: string;
  vehicleId?: string;
  period?: '7d' | '30d' | '90d' | '1y' | 'all';
}

export interface ExpenseSummary {
  totalAmount: number;
  expenseCount: number;
  monthlyAverage: number;
  recentAmount: number;
  categoryBreakdown: Array<{ category: string; amount: number; count: number }>;
  monthlyTrend: Array<{ period: string; amount: number; count: number }>;
}

/**
 * Compute monthly average using the calendar span between the first and last
 * months in the trend, so months with zero expenses still count.
 */
function computeMonthlyAverage(
  totalAmount: number,
  monthlyTrend: Array<{ period: string }>
): number {
  if (monthlyTrend.length === 0) return 0;
  const firstMonth = monthlyTrend[0]?.period;
  const lastMonth = monthlyTrend[monthlyTrend.length - 1]?.period;
  if (!firstMonth || !lastMonth) return 0;
  const [firstYear, firstMon] = firstMonth.split('-').map(Number) as [number, number];
  const [lastYear, lastMon] = lastMonth.split('-').map(Number) as [number, number];
  const calendarMonths = (lastYear - firstYear) * 12 + (lastMon - firstMon) + 1;
  return totalAmount / Math.max(calendarMonths, 1);
}

export class ExpenseRepository extends BaseRepository<Expense, NewExpense> {
  constructor(db: BunSQLiteDatabase<Record<string, unknown>>) {
    super(db, expenses);
  }

  /**
   * Paginated find with SQL-level filtering, LIMIT/OFFSET, and totalCount.
   * Always joins with vehicles for userId ownership.
   */
  async findPaginated(filters: PaginatedExpenseFilters): Promise<PaginatedResult<Expense>> {
    try {
      const limit = Math.min(
        filters.limit ?? CONFIG.pagination.defaultPageSize,
        CONFIG.pagination.maxPageSize
      );
      const offset = filters.offset ?? 0;

      const conditions: SQL[] = [];

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

      // SQL-level tag filtering using json_each
      if (filters.tags?.length) {
        for (const tag of filters.tags) {
          conditions.push(
            sql`EXISTS (SELECT 1 FROM json_each(${expenses.tags}) WHERE json_each.value = ${tag})`
          );
        }
      }

      // Always join with vehicles for userId ownership
      const baseWhere = and(eq(vehicles.userId, filters.userId ?? ''), ...conditions);

      const [countResult] = await this.db
        .select({ count: sql<number>`count(*)` })
        .from(expenses)
        .innerJoin(vehicles, eq(expenses.vehicleId, vehicles.id))
        .where(baseWhere);

      const totalCount = countResult?.count ?? 0;

      const data = await this.db
        .select({ expenses })
        .from(expenses)
        .innerJoin(vehicles, eq(expenses.vehicleId, vehicles.id))
        .where(baseWhere)
        .orderBy(desc(expenses.date))
        .limit(limit)
        .offset(offset);

      return {
        data: data.map((r) => r.expenses),
        totalCount,
      };
    } catch (error) {
      logger.error('Failed to find paginated expenses', {
        filters,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to find paginated expenses', error);
    }
  }

  /**
   * Unpaginated find for internal callers that need all matching expenses.
   * Always joins with vehicles for userId ownership.
   */
  async findAll(filters: ExpenseFilters): Promise<Expense[]> {
    try {
      const conditions: SQL[] = [];

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

      const result = await this.db
        .select({ expenses })
        .from(expenses)
        .innerJoin(vehicles, eq(expenses.vehicleId, vehicles.id))
        .where(and(eq(vehicles.userId, filters.userId ?? ''), ...conditions))
        .orderBy(desc(expenses.date));

      return result.map((row) => row.expenses);
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

  /**
   * Returns per-vehicle expense stats (total, recent amount, last expense date)
   * in a single query. Used by the dashboard to avoid N+1 API calls.
   */
  async getPerVehicleStats(
    userId: string,
    recentDays = 30
  ): Promise<
    Array<{
      vehicleId: string;
      totalAmount: number;
      recentAmount: number;
      lastExpenseDate: string | null;
    }>
  > {
    try {
      const recentCutoffSec = Math.floor((Date.now() - recentDays * 24 * 60 * 60 * 1000) / 1000);
      const rows = await this.db
        .select({
          vehicleId: expenses.vehicleId,
          totalAmount: sql<number>`COALESCE(SUM(${expenses.expenseAmount}), 0)`,
          recentAmount: sql<number>`COALESCE(SUM(CASE WHEN ${expenses.date} >= ${recentCutoffSec} THEN ${expenses.expenseAmount} ELSE 0 END), 0)`,
          lastExpenseDate: sql<string>`MAX(datetime(${expenses.date}, 'unixepoch'))`,
        })
        .from(expenses)
        .innerJoin(vehicles, eq(expenses.vehicleId, vehicles.id))
        .where(eq(vehicles.userId, userId))
        .groupBy(expenses.vehicleId);

      return rows.map((r) => ({
        vehicleId: r.vehicleId,
        totalAmount: Number(r.totalAmount) || 0,
        recentAmount: Number(r.recentAmount) || 0,
        lastExpenseDate: r.lastExpenseDate ?? null,
      }));
    } catch (error) {
      logger.error('Failed to get per-vehicle stats', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to get per-vehicle stats', error);
    }
  }

  /**
   * Returns aggregated expense summary: totals, category breakdown, monthly trend, and recent spend.
   * All queries join with vehicles for userId ownership.
   */
  async getSummary(filters: ExpenseSummaryFilters): Promise<ExpenseSummary> {
    try {
      const periodConditions: SQL[] = [eq(vehicles.userId, filters.userId)];

      if (filters.vehicleId) {
        periodConditions.push(eq(expenses.vehicleId, filters.vehicleId));
      }

      // Build date filter based on period
      const period = filters.period ?? 'all';
      if (period !== 'all') {
        const now = new Date();
        let startDate: Date;
        switch (period) {
          case '7d':
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
          case '30d':
            startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            break;
          case '90d':
            startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
            break;
          case '1y':
            startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
            break;
          default:
            startDate = new Date(0);
        }
        periodConditions.push(gte(expenses.date, startDate));
      }

      const periodWhere = and(...periodConditions);

      // Recent amount conditions: always last 30 days, ignoring period filter
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const recentConditions: SQL[] = [
        eq(vehicles.userId, filters.userId),
        gte(expenses.date, thirtyDaysAgo),
      ];
      if (filters.vehicleId) {
        recentConditions.push(eq(expenses.vehicleId, filters.vehicleId));
      }
      const recentWhere = and(...recentConditions);

      const [totals, categoryBreakdown, monthlyTrend, recentTotals] = await Promise.all([
        // Total amount and count
        this.db
          .select({
            totalAmount: sql<number>`COALESCE(SUM(${expenses.expenseAmount}), 0)`,
            expenseCount: sql<number>`count(*)`,
          })
          .from(expenses)
          .innerJoin(vehicles, eq(expenses.vehicleId, vehicles.id))
          .where(periodWhere),

        // Category breakdown
        this.db
          .select({
            category: expenses.category,
            amount: sql<number>`SUM(${expenses.expenseAmount})`,
            count: sql<number>`count(*)`,
          })
          .from(expenses)
          .innerJoin(vehicles, eq(expenses.vehicleId, vehicles.id))
          .where(periodWhere)
          .groupBy(expenses.category),

        // Monthly trend
        this.db
          .select({
            period: sql<string>`strftime('%Y-%m', datetime(${expenses.date}, 'unixepoch'))`.as(
              'period'
            ),
            amount: sql<number>`SUM(${expenses.expenseAmount})`,
            count: sql<number>`count(*)`,
          })
          .from(expenses)
          .innerJoin(vehicles, eq(expenses.vehicleId, vehicles.id))
          .where(periodWhere)
          .groupBy(sql`strftime('%Y-%m', datetime(${expenses.date}, 'unixepoch'))`)
          .orderBy(sql`strftime('%Y-%m', datetime(${expenses.date}, 'unixepoch'))`),

        // Recent amount (last 30 days, always computed regardless of period)
        this.db
          .select({
            amount: sql<number>`COALESCE(SUM(${expenses.expenseAmount}), 0)`,
          })
          .from(expenses)
          .innerJoin(vehicles, eq(expenses.vehicleId, vehicles.id))
          .where(recentWhere),
      ]);

      const totalAmount = Number(totals[0]?.totalAmount) || 0;
      const expenseCount = Number(totals[0]?.expenseCount) || 0;
      const monthlyAverage = computeMonthlyAverage(totalAmount, monthlyTrend);

      return {
        totalAmount,
        expenseCount,
        monthlyAverage,
        recentAmount: Number(recentTotals[0]?.amount) || 0,
        categoryBreakdown: categoryBreakdown.map((row) => ({
          category: row.category,
          amount: Number(row.amount) || 0,
          count: Number(row.count) || 0,
        })),
        monthlyTrend: monthlyTrend.map((row) => ({
          period: row.period,
          amount: Number(row.amount) || 0,
          count: Number(row.count) || 0,
        })),
      };
    } catch (error) {
      logger.error('Failed to get expense summary', {
        filters,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to get expense summary', error);
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
