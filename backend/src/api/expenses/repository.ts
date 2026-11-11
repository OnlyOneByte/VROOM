import { createId } from '@paralleldrive/cuid2';
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, type SQL, sql } from 'drizzle-orm';
import type { AppDatabase } from '../../db/connection';
import { getDb } from '../../db/connection';
import type { Expense, NewExpense, SplitMethod } from '../../db/schema';
import { expenses, photos } from '../../db/schema';
import { formatYearMonth, toDateTimeString } from '../../db/sql-helpers';
import { DatabaseError, NotFoundError } from '../../errors';
import { getPeriodStartDate } from '../../utils/calculations';
import { logger } from '../../utils/logger';
import { clampPagination, type PaginatedResult } from '../../utils/pagination';
import { BaseRepository } from '../../utils/repository';
import { assertVehiclesOwned } from '../../utils/vehicle-ownership';
import { expenseSplitService } from './split-service';
import { type SplitConfig, splitConfigVehicleIds } from './validation';
export interface ExpenseFilters {
  vehicleId?: string;
  userId?: string;
  category?: string;
  startDate?: Date;
  endDate?: Date;
  /** Tags — a row must carry EVERY listed tag (AND semantics). */
  tags?: string[];
  /** Free-text search over description + category (case-insensitive substring). */
  search?: string;
}

/** Columns a caller may sort the expense list by. */
export type ExpenseSortBy = 'date' | 'amount' | 'category';
export type SortDirection = 'asc' | 'desc';

export interface PaginatedExpenseFilters extends ExpenseFilters {
  limit?: number;
  offset?: number;
  /** Sort column (default 'date'). Allowlisted — never an arbitrary string. */
  sortBy?: ExpenseSortBy;
  /** Sort direction (default 'desc'). */
  sortDir?: SortDirection;
}

// A lookup rather than SQL interpolation, so unexpected input can only fall back to the default.
const EXPENSE_SORT_COLUMNS = {
  date: expenses.date,
  amount: expenses.expenseAmount,
  category: expenses.category,
} as const;

// Local-midnight detection, so the result does not depend on the server's timezone.
function endOfDayIfDateOnly(d: Date): Date {
  const isLocalMidnight =
    d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0;
  if (!isLocalMidnight) return d;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

// Shared by the list and export queries so they filter identically. Tags use AND semantics.
// The caller adds the userId scope.
function buildExpenseConditions(filters: ExpenseFilters): SQL[] {
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
    // A date-only end bound is local midnight; extend it to the end of that day so same-day rows are included.
    conditions.push(lte(expenses.date, endOfDayIfDateOnly(filters.endDate)));
  }
  if (filters.tags?.length) {
    for (const tag of filters.tags) {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM json_each(${expenses.tags}) WHERE json_each.value = ${tag})`
      );
    }
  }
  // Escape LIKE wildcards so the term matches literally. The backslash is escaped first.
  const search = filters.search?.trim();
  if (search) {
    const escaped = search.toLowerCase().replace(/[\\%_]/g, (ch) => `\\${ch}`);
    const pattern = `%${escaped}%`;
    conditions.push(
      sql`(lower(${expenses.description}) LIKE ${pattern} ESCAPE '\\' OR lower(${expenses.category}) LIKE ${pattern} ESCAPE '\\')`
    );
  }

  return conditions;
}

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

// Divides by the calendar span of the trend, so months with no expenses still count.
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

  async findByIdAndUserId(id: string, userId: string): Promise<Expense | null> {
    const result = await this.db
      .select()
      .from(expenses)
      .where(and(eq(expenses.id, id), eq(expenses.userId, userId)))
      .limit(1);
    return result[0] ?? null;
  }

  // Every source-linked read and write goes through this predicate so the userId scope cannot drift.
  private sourceScope(sourceType: string, sourceId: string, userId: string): SQL | undefined {
    return and(
      eq(expenses.sourceType, sourceType),
      eq(expenses.sourceId, sourceId),
      eq(expenses.userId, userId)
    );
  }

  async findBySource(sourceType: string, sourceId: string, userId: string): Promise<Expense[]> {
    return this.db
      .select()
      .from(expenses)
      .where(this.sourceScope(sourceType, sourceId, userId))
      .orderBy(asc(expenses.date));
  }

  async findIdsByVehicleId(vehicleId: string): Promise<string[]> {
    return this.findIdsByColumn(expenses.vehicleId, vehicleId);
  }

  private groupOwnedBy(groupId: string, userId: string): SQL | undefined {
    return and(eq(expenses.groupId, groupId), eq(expenses.userId, userId));
  }

  async findIdsByGroupId(groupId: string, userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: expenses.id })
      .from(expenses)
      .where(this.groupOwnedBy(groupId, userId));
    return rows.map((r) => r.id);
  }

  // Reads by groupId alone because the group is owner-stamped. Returns null when the group is absent.
  async getSplitGroupAccessInfo(
    groupId: string
  ): Promise<{ vehicleIds: string[]; ownerId: string } | null> {
    const rows = await this.db
      .select({ vehicleId: expenses.vehicleId, userId: expenses.userId })
      .from(expenses)
      .where(eq(expenses.groupId, groupId));
    if (rows.length === 0) return null;
    return { vehicleIds: [...new Set(rows.map((r) => r.vehicleId))], ownerId: rows[0].userId };
  }

  async findByClientId(clientId: string, userId: string): Promise<Expense | null> {
    const result = await this.db
      .select()
      .from(expenses)
      .where(and(eq(expenses.clientId, clientId), eq(expenses.userId, userId)))
      .limit(1);
    return result[0] ?? null;
  }

  // A retry with the same (userId, clientId) returns the existing row. With overwrite set, the
  // existing row is updated with the new data instead.
  async createIdempotent(data: NewExpense, overwrite = false): Promise<Expense> {
    if (!data.clientId) {
      return this.create(data);
    }
    const existing = await this.findByClientId(data.clientId, data.userId);
    if (existing) {
      return overwrite ? this.applyLocalOverwrite(existing.id, data) : existing;
    }

    try {
      return await this.create(data);
    } catch (error) {
      const raced = await this.findByClientId(data.clientId, data.userId);
      if (raced) {
        return overwrite ? this.applyLocalOverwrite(raced.id, data) : raced;
      }
      throw error;
    }
  }

  // clientId and userId are stripped from the patch so the identity and idempotency key never change.
  private applyLocalOverwrite(rowId: string, data: NewExpense): Promise<Expense> {
    const { clientId: _clientId, userId: _userId, ...patch } = data;
    return this.update(rowId, patch);
  }

  // All inserts run in one transaction. The callback must stay synchronous, since bun-sqlite would
  // otherwise autocommit each insert separately. Keys already present are skipped as duplicates;
  // existing clientIds are read once up front and the set grows as rows insert.
  async importExpenses(
    rows: NewExpense[],
    userId: string
  ): Promise<{ imported: number; duplicates: number }> {
    if (rows.length === 0) return { imported: 0, duplicates: 0 };
    try {
      const present = await this.db
        .select({ clientId: expenses.clientId })
        .from(expenses)
        .where(and(eq(expenses.userId, userId), isNotNull(expenses.clientId)));
      const seenClientIds = new Set<string>();
      for (const row of present) {
        if (row.clientId) seenClientIds.add(row.clientId);
      }

      return this.db.transaction((tx) => {
        let imported = 0;
        let duplicates = 0;
        for (const row of rows) {
          if (row.clientId && seenClientIds.has(row.clientId)) {
            duplicates += 1;
            continue;
          }
          tx.insert(expenses)
            .values({ ...row, userId })
            .run();
          if (row.clientId) seenClientIds.add(row.clientId);
          imported += 1;
        }
        return { imported, duplicates };
      });
    } catch (error) {
      logger.error('Failed to import expenses', {
        userId,
        rowCount: rows.length,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to import expenses', error);
    }
  }

  async findPaginated(filters: PaginatedExpenseFilters): Promise<PaginatedResult<Expense>> {
    try {
      const { limit, offset } = clampPagination(filters);

      const conditions = buildExpenseConditions(filters);

      const baseWhere = and(eq(expenses.userId, filters.userId ?? ''), ...conditions);

      const [countResult] = await this.db
        .select({ count: sql<number>`count(*)` })
        .from(expenses)
        .where(baseWhere);

      const totalCount = countResult?.count ?? 0;

      const sortColumn = EXPENSE_SORT_COLUMNS[filters.sortBy ?? 'date'];
      const dir = filters.sortDir === 'asc' ? asc : desc;
      const data = await this.db
        .select()
        .from(expenses)
        .where(baseWhere)
        .orderBy(dir(sortColumn), dir(expenses.id))
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

  async findAll(filters: ExpenseFilters): Promise<Expense[]> {
    try {
      const conditions = buildExpenseConditions(filters);

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

  // One grouped query, so the dashboard does not need one call per vehicle.
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

  async getSummary(filters: ExpenseSummaryFilters): Promise<ExpenseSummary> {
    try {
      const periodConditions: SQL[] = [eq(expenses.userId, filters.userId)];

      if (filters.vehicleId) {
        periodConditions.push(eq(expenses.vehicleId, filters.vehicleId));
      }

      const period = filters.period ?? 'all';
      if (period !== 'all') {
        const startDate = getPeriodStartDate(period) ?? new Date(0);
        periodConditions.push(gte(expenses.date, startDate));
      }

      const periodWhere = and(...periodConditions);

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
        this.db
          .select({
            totalAmount: sql<number>`COALESCE(SUM(${expenses.expenseAmount}), 0)`,
            expenseCount: sql<number>`count(*)`,
          })
          .from(expenses)
          .where(periodWhere),

        this.db
          .select({
            category: expenses.category,
            amount: sql<number>`SUM(${expenses.expenseAmount})`,
            count: sql<number>`count(*)`,
          })
          .from(expenses)
          .where(periodWhere)
          .groupBy(expenses.category),

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

  // Callers must first remove the linked receipts through photo-service, which owns the storage
  // files. This repository cannot import it because photo helpers import this module.
  async deleteBySource(sourceType: string, sourceId: string, userId: string): Promise<number> {
    try {
      const linked = await this.db
        .select({ id: expenses.id })
        .from(expenses)
        .where(this.sourceScope(sourceType, sourceId, userId));

      if (linked.length === 0) return 0;

      const linkedIds = linked.map((e) => e.id);

      this.db.transaction((tx) => {
        tx.delete(photos)
          .where(and(eq(photos.entityType, 'expense'), inArray(photos.entityId, linkedIds)))
          .run();
        tx.delete(expenses)
          .where(this.sourceScope(sourceType, sourceId, userId))
          .run();
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

  async clearSource(sourceType: string, sourceId: string, userId: string): Promise<number> {
    try {
      const result = await this.db
        .update(expenses)
        .set({ sourceType: null, sourceId: null })
        .where(this.sourceScope(sourceType, sourceId, userId))
        .returning();

      return result.length;
    } catch (error) {
      logger.error('Failed to clear source on expenses', {
        sourceType,
        sourceId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to clear source on expenses', error);
    }
  }

  private async validateVehicleOwnership(splitConfig: SplitConfig, userId: string): Promise<void> {
    await assertVehiclesOwned(this.db, splitConfigVehicleIds(splitConfig), userId);
  }

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
    userId: string,
    // ownerId stamps every sibling; createdBy records the acting author. The route checks access.
    ownerId: string = userId,
    createdBy: string | null = null
  ): Promise<Expense[]> {
    try {
      const allocations = expenseSplitService.computeAllocations(
        data.splitConfig,
        data.totalAmount
      );
      const splitMethod: SplitMethod = data.splitConfig.method;

      // Synchronous so every sibling inserts in one transaction that rolls back as a whole.
      return this.db.transaction((tx) => {
        const groupId = createId();

        return expenseSplitService.createSiblingsSync(tx, {
          groupId,
          userId: ownerId,
          createdBy,
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

  async getSplitExpense(groupId: string, userId: string): Promise<Expense[]> {
    const siblings = await this.db
      .select()
      .from(expenses)
      .where(this.groupOwnedBy(groupId, userId));

    if (siblings.length === 0) {
      throw new NotFoundError('Split expense');
    }

    return siblings;
  }

  async deleteSplitExpense(groupId: string, userId: string): Promise<void> {
    const siblings = await this.db
      .select({ id: expenses.id })
      .from(expenses)
      .where(this.groupOwnedBy(groupId, userId));

    if (siblings.length === 0) {
      throw new NotFoundError('Split expense');
    }

    const siblingIds = siblings.map((s) => s.id);

    try {
      this.db.transaction((tx) => {
        tx.delete(photos)
          .where(and(eq(photos.entityType, 'expense'), inArray(photos.entityId, siblingIds)))
          .run();

        tx.delete(expenses).where(this.groupOwnedBy(groupId, userId)).run();
      });
    } catch (error) {
      logger.error('Failed to delete split expense', {
        groupId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to delete split expense', error);
    }
  }

  async updateSplitExpense(
    groupId: string,
    data: { splitConfig: SplitConfig; totalAmount?: number },
    userId: string,
    createdBy: string | null = null
  ): Promise<Expense[]> {
    const oldSiblings = await this.db
      .select()
      .from(expenses)
      .where(this.groupOwnedBy(groupId, userId));

    if (oldSiblings.length === 0) {
      throw new NotFoundError('Split expense');
    }

    try {
      await this.validateVehicleOwnership(data.splitConfig, userId);

      const firstOld = oldSiblings[0];
      if (!firstOld) {
        throw new NotFoundError('Split expense');
      }
      // An absolute split's total is the sum of its allocations, so an omitted totalAmount cannot
      // leave a stale groupTotal behind. Even and percentage splits still need the caller's total.
      const totalAmount =
        data.splitConfig.method === 'absolute'
          ? data.splitConfig.allocations.reduce((sum, a) => sum + a.amount, 0)
          : (data.totalAmount ?? firstOld.groupTotal ?? firstOld.expenseAmount);
      const allocations = expenseSplitService.computeAllocations(data.splitConfig, totalAmount);
      const splitMethod: SplitMethod = data.splitConfig.method;
      const oldSiblingIds = oldSiblings.map((s) => s.id);

      // Synchronous: the delete and re-insert must roll back together, or a failure loses the group.
      return this.db.transaction((tx) => {
        const oldPhotos = tx
          .select({ id: photos.id })
          .from(photos)
          .where(and(eq(photos.entityType, 'expense'), inArray(photos.entityId, oldSiblingIds)))
          .all();

        const photoIds = oldPhotos.map((p) => p.id);

        tx.delete(expenses).where(this.groupOwnedBy(groupId, userId)).run();

        const newSiblings = expenseSplitService.createSiblingsSync(tx, {
          groupId,
          userId,
          createdBy,
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

        if (photoIds.length > 0 && newSiblings[0]) {
          tx.update(photos)
            .set({ entityId: newSiblings[0].id })
            .where(inArray(photos.id, photoIds))
            .run();
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

export const expenseRepository = new ExpenseRepository(getDb());
