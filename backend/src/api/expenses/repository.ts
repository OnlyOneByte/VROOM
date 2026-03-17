import { createId } from '@paralleldrive/cuid2';
import { and, desc, eq, gte, inArray, lte, type SQL, sql } from 'drizzle-orm';
import { CONFIG } from '../../config';
import type { AppDatabase } from '../../db/connection';
import { getDb } from '../../db/connection';
import type { Expense, NewExpense, SplitMethod } from '../../db/schema';
import { expenses, photos, vehicles } from '../../db/schema';
import { formatYearMonth, toDateTimeString } from '../../db/sql-helpers';
import { DatabaseError, NotFoundError } from '../../errors';
import { logger } from '../../utils/logger';
import type { PaginatedResult } from '../../utils/pagination';
import { BaseRepository } from '../../utils/repository';
import { expenseSplitService } from './split-service';
import type { SplitConfig } from './validation';
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

// Re-export from shared pagination module for backward compat
export type { PaginatedResult } from '../../utils/pagination';

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
  constructor(db: AppDatabase) {
    super(db, expenses);
  }

  /**
   * Find an expense by ID scoped to a user. Returns null if not found or not owned.
   */
  async findByIdAndUserId(id: string, userId: string): Promise<Expense | null> {
    const result = await this.db
      .select()
      .from(expenses)
      .where(and(eq(expenses.id, id), eq(expenses.userId, userId)))
      .limit(1);
    return result[0] ?? null;
  }

  /**
   * Paginated find with SQL-level filtering, LIMIT/OFFSET, and totalCount.
   * Filters by expenses.userId directly.
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

      // Filter by expenses.userId directly — no vehicles JOIN needed
      const baseWhere = and(eq(expenses.userId, filters.userId ?? ''), ...conditions);

      const [countResult] = await this.db
        .select({ count: sql<number>`count(*)` })
        .from(expenses)
        .where(baseWhere);

      const totalCount = countResult?.count ?? 0;

      const data = await this.db
        .select()
        .from(expenses)
        .where(baseWhere)
        .orderBy(desc(expenses.date))
        .limit(limit)
        .offset(offset);

      return {
        data,
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
   * Filters by expenses.userId directly.
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
        .select()
        .from(expenses)
        .where(and(eq(expenses.userId, filters.userId ?? ''), ...conditions))
        .orderBy(desc(expenses.date));

      return result;
    } catch (error) {
      logger.error('Failed to find expenses', {
        filters,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to find expenses', error);
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
          lastExpenseDate: sql<string>`MAX(${toDateTimeString(expenses.date)})`,
        })
        .from(expenses)
        .where(eq(expenses.userId, userId))
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
   * Filters by expenses.userId directly.
   */
  async getSummary(filters: ExpenseSummaryFilters): Promise<ExpenseSummary> {
    try {
      const periodConditions: SQL[] = [eq(expenses.userId, filters.userId)];

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
        eq(expenses.userId, filters.userId),
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
          .where(periodWhere),

        // Category breakdown
        this.db
          .select({
            category: expenses.category,
            amount: sql<number>`SUM(${expenses.expenseAmount})`,
            count: sql<number>`count(*)`,
          })
          .from(expenses)
          .where(periodWhere)
          .groupBy(expenses.category),

        // Monthly trend
        this.db
          .select({
            period: formatYearMonth(expenses.date).as('period'),
            amount: sql<number>`SUM(${expenses.expenseAmount})`,
            count: sql<number>`count(*)`,
          })
          .from(expenses)
          .where(periodWhere)
          .groupBy(formatYearMonth(expenses.date))
          .orderBy(formatYearMonth(expenses.date)),

        // Recent amount (last 30 days, always computed regardless of period)
        this.db
          .select({
            amount: sql<number>`COALESCE(SUM(${expenses.expenseAmount}), 0)`,
          })
          .from(expenses)
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

  /**
   * Delete all expenses linked to a source (e.g., insurance term, financing).
   * Used when a source entity is deleted/updated to replace auto-created expenses.
   */
  async deleteBySource(sourceType: string, sourceId: string, userId: string): Promise<number> {
    try {
      const linked = await this.db
        .select({ id: expenses.id })
        .from(expenses)
        .where(
          and(
            eq(expenses.sourceType, sourceType),
            eq(expenses.sourceId, sourceId),
            eq(expenses.userId, userId)
          )
        );

      if (linked.length === 0) return 0;

      const linkedIds = linked.map((e) => e.id);

      await this.db.transaction(async (tx) => {
        await tx
          .delete(photos)
          .where(and(eq(photos.entityType, 'expense'), inArray(photos.entityId, linkedIds)));
        await tx
          .delete(expenses)
          .where(
            and(
              eq(expenses.sourceType, sourceType),
              eq(expenses.sourceId, sourceId),
              eq(expenses.userId, userId)
            )
          );
      });

      return linked.length;
    } catch (error) {
      logger.error('Failed to delete expenses by source', {
        sourceType,
        sourceId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to delete expenses by source', error);
    }
  }

  /**
   * Null-out source fields on expenses linked to a source.
   * Used when a source entity is deactivated but expenses should persist.
   */
  async clearSource(sourceType: string, sourceId: string, userId: string): Promise<number> {
    try {
      const result = await this.db
        .update(expenses)
        .set({ sourceType: null, sourceId: null })
        .where(
          and(
            eq(expenses.sourceType, sourceType),
            eq(expenses.sourceId, sourceId),
            eq(expenses.userId, userId)
          )
        );

      return result.changes;
    } catch (error) {
      logger.error('Failed to clear source on expenses', {
        sourceType,
        sourceId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to clear source on expenses', error);
    }
  }

  // ===========================================================================
  // Split Expense Methods
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
   * Create a split expense as sibling rows sharing a groupId.
   * Validates vehicle ownership, then calls expenseSplitService.createSiblings().
   */
  async createSplitExpense(
    data: {
      splitConfig: SplitConfig;
      category: string;
      tags?: string[];
      date: Date;
      description?: string;
      totalAmount: number;
      sourceType?: string;
      sourceId?: string;
    },
    userId: string
  ): Promise<Expense[]> {
    try {
      await this.validateVehicleOwnership(data.splitConfig, userId);

      const allocations = expenseSplitService.computeAllocations(
        data.splitConfig,
        data.totalAmount
      );
      const splitMethod: SplitMethod = data.splitConfig.method;

      return await this.db.transaction(async (tx) => {
        const groupId = createId();

        return expenseSplitService.createSiblings(tx, {
          groupId,
          userId,
          splitMethod,
          groupTotal: data.totalAmount,
          allocations,
          category: data.category,
          date: data.date,
          tags: data.tags,
          description: data.description,
          sourceType: data.sourceType,
          sourceId: data.sourceId,
        });
      });
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      logger.error('Failed to create split expense', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to create split expense', error);
    }
  }

  /**
   * Get a split expense group by groupId. Validates user ownership.
   */
  async getSplitExpense(groupId: string, userId: string): Promise<Expense[]> {
    const siblings = await this.db
      .select()
      .from(expenses)
      .where(and(eq(expenses.groupId, groupId), eq(expenses.userId, userId)));

    if (siblings.length === 0) {
      throw new NotFoundError('Split expense');
    }

    return siblings;
  }

  /**
   * Delete a split expense group and all associated photos.
   * Uses batch deletes with inArray() to avoid N+1 queries.
   */
  async deleteSplitExpense(groupId: string, userId: string): Promise<void> {
    const siblings = await this.db
      .select({ id: expenses.id })
      .from(expenses)
      .where(and(eq(expenses.groupId, groupId), eq(expenses.userId, userId)));

    if (siblings.length === 0) {
      throw new NotFoundError('Split expense');
    }

    const siblingIds = siblings.map((s) => s.id);

    try {
      await this.db.transaction(async (tx) => {
        // Delete photos attached to sibling expenses
        await tx
          .delete(photos)
          .where(and(eq(photos.entityType, 'expense'), inArray(photos.entityId, siblingIds)));

        // Delete all sibling expense rows
        await tx.delete(expenses).where(eq(expenses.groupId, groupId));
      });
    } catch (error) {
      logger.error('Failed to delete split expense', {
        groupId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to delete split expense', error);
    }
  }

  /**
   * Update a split expense: delete old siblings, insert new ones with same groupId,
   * and migrate photos from old siblings to the first new sibling.
   */
  async updateSplitExpense(
    groupId: string,
    data: { splitConfig: SplitConfig; totalAmount?: number },
    userId: string
  ): Promise<Expense[]> {
    const oldSiblings = await this.db
      .select()
      .from(expenses)
      .where(and(eq(expenses.groupId, groupId), eq(expenses.userId, userId)));

    if (oldSiblings.length === 0) {
      throw new NotFoundError('Split expense');
    }

    try {
      await this.validateVehicleOwnership(data.splitConfig, userId);

      const firstOld = oldSiblings[0];
      if (!firstOld) {
        throw new NotFoundError('Split expense');
      }
      const totalAmount = data.totalAmount ?? firstOld.groupTotal ?? firstOld.expenseAmount;
      const allocations = expenseSplitService.computeAllocations(data.splitConfig, totalAmount);
      const splitMethod: SplitMethod = data.splitConfig.method;
      const oldSiblingIds = oldSiblings.map((s) => s.id);

      return await this.db.transaction(async (tx) => {
        // 1. Collect photo IDs from old siblings
        const oldPhotos = await tx
          .select({ id: photos.id })
          .from(photos)
          .where(and(eq(photos.entityType, 'expense'), inArray(photos.entityId, oldSiblingIds)));

        const photoIds = oldPhotos.map((p) => p.id);

        // 2. Delete old siblings
        await tx.delete(expenses).where(eq(expenses.groupId, groupId));

        // 3. Insert new siblings with same groupId
        const newSiblings = await expenseSplitService.createSiblings(tx, {
          groupId,
          userId,
          splitMethod,
          groupTotal: totalAmount,
          allocations,
          category: firstOld.category,
          date: firstOld.date,
          tags: firstOld.tags ?? undefined,
          description: firstOld.description ?? undefined,
          sourceType: firstOld.sourceType ?? undefined,
          sourceId: firstOld.sourceId ?? undefined,
        });

        // 4. Migrate photos to first new sibling
        if (photoIds.length > 0 && newSiblings[0]) {
          await tx
            .update(photos)
            .set({ entityId: newSiblings[0].id })
            .where(inArray(photos.id, photoIds));
        }

        return newSiblings;
      });
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      logger.error('Failed to update split expense', {
        groupId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to update split expense', error);
    }
  }
}

// Export singleton instance
export const expenseRepository = new ExpenseRepository(getDb());
