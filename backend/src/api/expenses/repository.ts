import { createId } from '@paralleldrive/cuid2';
import { and, asc, desc, eq, gte, inArray, lte, type SQL, sql } from 'drizzle-orm';
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

// Map the allowlisted sort key to its real column. Keeping this as a lookup (not
// string interpolation into SQL) means an unexpected value can only fall back to
// the default, never inject. `id` is appended as a stable tiebreaker so equal
// amounts/categories have a deterministic order across pages (pagination would
// otherwise drop/duplicate rows on ties).
const EXPENSE_SORT_COLUMNS = {
  date: expenses.date,
  amount: expenses.expenseAmount,
  category: expenses.category,
} as const;

/**
 * If `d` falls exactly on LOCAL midnight (the date-only `YYYY-MM-DD` DatePicker signature), return
 * the inclusive end of that local day (23:59:59.999); otherwise return `d` unchanged. Detection +
 * construction use local Y/M/D parts (not a hardcoded UTC instant), so the behavior is
 * host-independent — a date-only end bound covers its whole day on any server timezone, and a
 * deliberate mid-day timestamp is left alone. See the `endDate` note in buildExpenseConditions.
 */
function endOfDayIfDateOnly(d: Date): Date {
  const isLocalMidnight =
    d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0;
  if (!isLocalMidnight) return d;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

/**
 * Build the shared WHERE conditions for an expense query (everything EXCEPT the
 * userId scope, which the caller ANDs in). Used by BOTH findPaginated and findAll so
 * the list table and the CSV export filter identically — a divergence here is exactly
 * how "export shows more rows than the filtered table" bugs creep in. Tags use AND
 * semantics (a row must carry every listed tag); search is a case-insensitive LIKE
 * over description + category.
 */
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
    // `endDate` from the UI is a date-only `YYYY-MM-DD` (the DatePicker), coerced to LOCAL
    // midnight (00:00:00.000) — the START of that day. A bare `lte(date, midnight)` therefore
    // drops every same-day expense not stamped at exactly midnight, so a "through Mar 31" filter
    // silently hides all of Mar 31 (the C6/C61/C103 local-vs-UTC boundary class, here on the
    // most-used list + the CSV export — both route through this one builder). Treat a midnight
    // endDate as INCLUSIVE of the whole local day by extending it to 23:59:59.999 local; a
    // non-midnight endDate (a deliberate full timestamp) is honored as-is.
    conditions.push(lte(expenses.date, endOfDayIfDateOnly(filters.endDate)));
  }
  // SQL-level tag filtering via json_each (a row must carry EVERY listed tag).
  if (filters.tags?.length) {
    for (const tag of filters.tags) {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM json_each(${expenses.tags}) WHERE json_each.value = ${tag})`
      );
    }
  }
  // Free-text search over description + category (case-insensitive). LIKE is
  // case-insensitive for ASCII in SQLite by default; lower() handles mixed case too.
  // Escape the LIKE metacharacters (`%` `_` and the escape char `\`) in the user's term so a
  // search for a literal "50%" or "oil_change" matches the TEXT, not a wildcard — without the
  // ESCAPE clause a `%` means "any chars" (over-matches every row) and `_` means "any one char"
  // (bug #41). Order matters: escape `\` FIRST so we don't double-escape the ones we just added.
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
   * All expenses materialized from a source (e.g. a recurring-expense reminder), scoped to a user
   * and ordered by date. The READ counterpart to clearSource/deleteBySource — backs the recurring-
   * expenses T6 "this reminder materialized N expenses" view. Returns [] when nothing is linked.
   */
  /**
   * The tenant-scoped predicate for a source-linked expense set: (sourceType, sourceId) AND the
   * owning userId. EVERY source read AND destructive write (findBySource / deleteBySource read +
   * delete-write / clearSource update — 4 sites) routes through this single source so the userId
   * scope can't drift apart. These methods act on AUTO-MATERIALIZED expenses (reminder/insurance/
   * financing cascade cleanup), so a divergent copy dropping the userId leg would let one user's
   * source-entity delete/deactivate wipe or null ANOTHER user's expenses (a cross-tenant destructive
   * write — the C109/#57/#62 class). One predicate keeps the boundary in lockstep structurally.
   */
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

  /** IDs of all expenses for a vehicle (for photo cascade cleanup on delete). */
  async findIdsByVehicleId(vehicleId: string): Promise<string[]> {
    return this.findIdsByColumn(expenses.vehicleId, vehicleId);
  }

  /**
   * The tenant-scoped predicate for a split-expense group: groupId AND the owning userId.
   * EVERY split-group read AND destructive write goes through this single source so the
   * ownership scope and the deletion scope can never drift apart — a divergent copy that
   * dropped the userId predicate would be a cross-tenant read or (worse) a cross-tenant
   * DELETE. Behavior-identical today (groupId is a server cuid2, single-owner), but this
   * keeps the C109 defense-in-depth boundary in lockstep structurally instead of by comment.
   */
  private groupOwnedBy(groupId: string, userId: string): SQL | undefined {
    return and(eq(expenses.groupId, groupId), eq(expenses.userId, userId));
  }

  /** IDs of all sibling expenses in a split group, scoped to a user. */
  async findIdsByGroupId(groupId: string, userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: expenses.id })
      .from(expenses)
      .where(this.groupOwnedBy(groupId, userId));
    return rows.map((r) => r.id);
  }

  /**
   * vehicle-sharing T5b-2b: the split group's distinct vehicleIds + its owner-stamped `userId`, read
   * UNSCOPED (by groupId alone). The share-aware split routes call this FIRST to discover which
   * vehicles to gate through `requireVehicleWrite/Read` — exactly as the single-expense write path
   * loads the (owner-stamped) row unscoped via `findById` before authorizing on its vehicle. Every
   * sibling carries the same `userId` (the owner-stamp invariant), so `ownerId` is taken from row 0;
   * returns null when the group does not exist (caller → 404, existence-hiding).
   */
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

  /**
   * Find an expense by its offline idempotency key, scoped to a user.
   * Returns null if no row with that clientId exists for the user.
   */
  async findByClientId(clientId: string, userId: string): Promise<Expense | null> {
    const result = await this.db
      .select()
      .from(expenses)
      .where(and(eq(expenses.clientId, clientId), eq(expenses.userId, userId)))
      .limit(1);
    return result[0] ?? null;
  }

  /**
   * Idempotent create for offline-outbox writes. If an expense with the same
   * (userId, clientId) already exists, returns it instead of inserting a duplicate
   * — so a retried offline POST is a no-op. When clientId is absent this is a plain
   * create. The pre-check + unique index together close the retry race: a concurrent
   * duplicate insert hits the unique constraint, which we recover by re-reading.
   *
   * `overwrite` (#98, C51): when the caller is a conflict RESOLUTION choosing keep-local (not a blind
   * retry), a (userId, clientId) collision must APPLY the local edit, not silently discard it. With the
   * flag set, an existing row is UPDATED with the new data (preserving its id/userId/clientId/createdAt —
   * clientId/userId are stripped from the patch so the identity + idempotency key never change) instead
   * of returned unchanged. Default false keeps the plain-retry path a pure no-op (NORTH_STAR #1: a
   * resolved offline edit is never lost).
   */
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
      // Lost the race: another request inserted the same (userId, clientId).
      // Re-read and return the winner rather than surfacing a constraint error.
      const raced = await this.findByClientId(data.clientId, data.userId);
      if (raced) {
        // Same overwrite contract on the raced winner so a concurrent keep-local still applies the edit.
        return overwrite ? this.applyLocalOverwrite(raced.id, data) : raced;
      }
      throw error;
    }
  }

  /**
   * Apply a keep-local overwrite (#98) onto the existing (userId, clientId) row: replace its mutable
   * fields with the local edit while keeping the identity + idempotency keys IMMUTABLE — clientId/userId
   * are stripped from the patch so they (and the row id/createdAt) never change. ONE source of truth for
   * the overwrite, shared by both createIdempotent collision branches (the pre-check hit + the raced
   * winner) so the immutability contract can't drift between them.
   */
  private applyLocalOverwrite(rowId: string, data: NewExpense): Promise<Expense> {
    const { clientId: _clientId, userId: _userId, ...patch } = data;
    return this.update(rowId, patch);
  }

  /**
   * Commit a batch of CSV-imported expenses ATOMICALLY and IDEMPOTENTLY.
   *
   * All inserts run in a single transaction, so a failure on any row rolls back the whole
   * batch — the user never ends up with a half-imported file (and a fix-and-re-import can't
   * double-write the rows that already committed). Each row carries a deterministic
   * `clientId` (see import-csv.ts), so re-importing the same file is a no-op: a row whose
   * (userId, clientId) already exists is skipped and counted as a duplicate rather than
   * inserted again. The unique partial index on (userId, clientId) backs this at the DB level.
   *
   * Returns the count actually inserted and the count skipped as already-present duplicates.
   */
  async importExpenses(
    rows: NewExpense[],
    userId: string
  ): Promise<{ imported: number; duplicates: number }> {
    if (rows.length === 0) return { imported: 0, duplicates: 0 };
    try {
      return await this.db.transaction(async (tx) => {
        let imported = 0;
        let duplicates = 0;
        for (const row of rows) {
          const data = { ...row, userId };
          if (data.clientId) {
            const existing = await tx
              .select({ id: expenses.id })
              .from(expenses)
              .where(and(eq(expenses.clientId, data.clientId), eq(expenses.userId, userId)))
              .limit(1);
            if (existing.length > 0) {
              duplicates += 1;
              continue;
            }
          }
          await tx.insert(expenses).values(data);
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

  /**
   * Paginated find with SQL-level filtering, LIMIT/OFFSET, and totalCount.
   * Filters by expenses.userId directly.
   */
  async findPaginated(filters: PaginatedExpenseFilters): Promise<PaginatedResult<Expense>> {
    try {
      const { limit, offset } = clampPagination(filters);

      const conditions = buildExpenseConditions(filters);

      // Filter by expenses.userId directly — no vehicles JOIN needed
      const baseWhere = and(eq(expenses.userId, filters.userId ?? ''), ...conditions);

      const [countResult] = await this.db
        .select({ count: sql<number>`count(*)` })
        .from(expenses)
        .where(baseWhere);

      const totalCount = countResult?.count ?? 0;

      // Sort by the allowlisted column (default date), with a stable id tiebreaker
      // so ties don't reorder across pages. dir() applies the chosen direction to
      // the primary column; the tiebreaker matches it so order is fully determined.
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

  /**
   * Unpaginated find for internal callers that need all matching expenses.
   * Filters by expenses.userId directly.
   */
  async findAll(filters: ExpenseFilters): Promise<Expense[]> {
    try {
      // Same condition set as findPaginated (incl. tags + search) so the CSV export
      // returns exactly the rows the filtered table shows — see buildExpenseConditions.
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
        // Shared one-source-of-truth window (see calculations.ts). The `?? new Date(0)` keeps
        // the prior defensive fallback for a value outside the 5 known periods (unreachable in
        // practice — period is a fixed enum — but behavior-identical to the old default branch).
        const startDate = getPeriodStartDate(period) ?? new Date(0);
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
        .where(this.sourceScope(sourceType, sourceId, userId));

      if (linked.length === 0) return 0;

      const linkedIds = linked.map((e) => e.id);

      await this.db.transaction(async (tx) => {
        await tx
          .delete(photos)
          .where(and(eq(photos.entityType, 'expense'), inArray(photos.entityId, linkedIds)));
        await tx.delete(expenses).where(this.sourceScope(sourceType, sourceId, userId));
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

  // ===========================================================================
  // Split Expense Methods
  // ===========================================================================

  /**
   * Validate that all vehicle IDs in a split config belong to the given user.
   * Throws NotFoundError if any vehicle is not found or not owned.
   */
  private async validateVehicleOwnership(splitConfig: SplitConfig, userId: string): Promise<void> {
    // splitConfigVehicleIds owns the `even ? vehicleIds : allocations.map(...)` extraction (one source
    // of truth, C50); assertVehiclesOwned (C376) owns the cross-tenant `userId AND id IN (ids)` query +
    // NotFoundError throw, shared with the insurance term path.
    await assertVehiclesOwned(this.db, splitConfigVehicleIds(splitConfig), userId);
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
    userId: string,
    // vehicle-sharing T5b-2b: the row-stamp owner (design §2.1 — every sibling's `userId`) and the
    // actual author (`createdBy`). The route resolves these from the share seam and asserts the
    // single-owner invariant + WRITE access BEFORE calling, so the repo no longer re-runs the strict
    // owner-only `validateVehicleOwnership`. Default ownerId=userId / createdBy=null keeps a
    // non-shared caller (and existing unit tests that pass only `userId`) byte-identical to pre-T5b-2b.
    ownerId: string = userId,
    createdBy: string | null = null
  ): Promise<Expense[]> {
    try {
      const allocations = expenseSplitService.computeAllocations(
        data.splitConfig,
        data.totalAmount
      );
      const splitMethod: SplitMethod = data.splitConfig.method;

      return await this.db.transaction(async (tx) => {
        const groupId = createId();

        return expenseSplitService.createSiblings(tx, {
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

  /**
   * Get a split expense group by groupId. Validates user ownership.
   */
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

  /**
   * Delete a split expense group and all associated photos.
   * Uses batch deletes with inArray() to avoid N+1 queries.
   */
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
      await this.db.transaction(async (tx) => {
        // Delete photos attached to sibling expenses
        await tx
          .delete(photos)
          .where(and(eq(photos.entityType, 'expense'), inArray(photos.entityId, siblingIds)));

        // Delete all sibling expense rows. AND the userId scope (not groupId alone): the read above is
        // userId-scoped, so the destructive write must match it — keeping ownership and deletion on the
        // SAME predicate. Behavior-identical today (groupId is a server cuid2, single-owner), but a
        // defense-in-depth boundary so a future cross-user group can never be cross-deleted (the C109
        // detectConflicts tenant-scope class).
        await tx.delete(expenses).where(this.groupOwnedBy(groupId, userId));
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
    userId: string,
    // vehicle-sharing T5b-2b: provenance of the regenerated siblings. The route resolves the stamp
    // owner (passed as `userId` — the group is owner-stamped, so the `groupOwnedBy` read below matches)
    // and the acting author. `validateVehicleOwnership(config, userId)` then enforces the NEW vehicle
    // set is entirely the owner's (the single-owner invariant for a shared editor). Default null keeps
    // a non-shared caller identical to pre-T5b-2b.
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
      // For an ABSOLUTE split the total is DEFINITIONALLY the sum of the per-vehicle
      // allocations, so derive it from them rather than trusting an omitted `totalAmount`
      // or the stale stored `groupTotal`. updateSplitSchema makes `totalAmount` optional
      // AND gates its absolute-sum refinement on it being present (validation.ts:64,102),
      // so an absolute edit that omits `totalAmount` would otherwise fall back to the OLD
      // groupTotal — stamping every sibling with a header that no longer matches the legs
      // (edit 30/30→40/40 with no total keeps groupTotal=60 while the legs sum to 80, a
      // persistent stored inconsistency that violates Property 3: legs sum to groupTotal).
      // When `totalAmount` IS sent for absolute, validation already forces sum===total, so
      // this yields the identical value (no behavior change). Even/percentage carry no
      // absolute amounts in the config → they still need the caller's total to divide.
      const totalAmount =
        data.splitConfig.method === 'absolute'
          ? Math.round(data.splitConfig.allocations.reduce((sum, a) => sum + a.amount, 0) * 100) /
            100
          : (data.totalAmount ?? firstOld.groupTotal ?? firstOld.expenseAmount);
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

        // 2. Delete old siblings (userId-scoped to match the read above — same predicate for the
        // ownership check and the destructive write; see deleteSplitExpense for the rationale).
        await tx.delete(expenses).where(this.groupOwnedBy(groupId, userId));

        // 3. Insert new siblings with same groupId
        const newSiblings = await expenseSplitService.createSiblings(tx, {
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
