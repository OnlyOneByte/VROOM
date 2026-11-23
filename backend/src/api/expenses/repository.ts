import { createId } from '@paralleldrive/cuid2';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lt,
  lte,
  max,
  min,
  ne,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { AppDatabase } from '../../db/connection';
import { getDb } from '../../db/connection';
import type { Expense, NewExpense, SplitMethod } from '../../db/schema';
import { expenses, odometerEntries, photos, vehicles } from '../../db/schema';
import { formatYearMonth } from '../../db/sql-helpers';
import type { DrizzleTransaction } from '../../db/types';
import { ConflictError, DatabaseError, NotFoundError, ValidationError } from '../../errors';
import { zonedCalendar } from '../../utils/analytics-charts';
import { getPeriodStartDate } from '../../utils/calculations';
import { logger } from '../../utils/logger';
import { clampPagination, type PaginatedResult } from '../../utils/pagination';
import { BaseRepository } from '../../utils/repository';
import { zonedDayWindow, zonedMidnight } from '../../utils/time-zone';
import { expenseSplitService } from './split-service';
import {
  type OdometerCheck,
  type OdometerNeighbours,
  odometerOrderError,
  type SplitConfig,
} from './validation';

export interface ExpenseFilters {
  vehicleId?: string;
  userId?: string;
  category?: string | string[];
  startDate?: Date;
  endDate?: Date;
  tags?: string[];
  search?: string;
  timeZone?: string;
  startDateIsDay?: boolean;
  endDateIsDay?: boolean;
}

type ExpenseSortBy = 'date' | 'amount' | 'category';
type SortDirection = 'asc' | 'desc';

export interface PaginatedExpenseFilters extends ExpenseFilters {
  limit?: number;
  offset?: number;
  sortBy?: ExpenseSortBy;
  sortDir?: SortDirection;
}

// Sort columns are looked up here, never interpolated into SQL.
const EXPENSE_SORT_COLUMNS = {
  date: expenses.date,
  amount: expenses.expenseAmount,
  category: expenses.category,
} as const;

interface Readings {
  at(tx: DrizzleTransaction, bound: 'before' | 'after', edge: Date): Date | null;
  bound(tx: DrizzleTransaction, kind: 'max' | 'min', from: Date, to: Date): number | null;
}

function expenseReadings(vehicleId: string, excludeId?: string): Readings {
  const where = (...bounds: SQL[]) =>
    and(
      eq(expenses.vehicleId, vehicleId),
      isNotNull(expenses.mileage),
      ...bounds,
      excludeId ? ne(expenses.id, excludeId) : undefined
    );
  return {
    at: (tx, side, edge) =>
      tx
        .select({ date: expenses.date })
        .from(expenses)
        .where(where(side === 'before' ? lt(expenses.date, edge) : gte(expenses.date, edge)))
        .orderBy(side === 'before' ? desc(expenses.date) : asc(expenses.date))
        .limit(1)
        .get()?.date ?? null,
    bound: (tx, kind, from, to) =>
      tx
        .select({ value: kind === 'max' ? max(expenses.mileage) : min(expenses.mileage) })
        .from(expenses)
        .where(where(gte(expenses.date, from), lt(expenses.date, to)))
        .get()?.value ?? null,
  };
}

function manualReadings(vehicleId: string, excludeId?: string): Readings {
  const where = (...bounds: SQL[]) =>
    and(
      eq(odometerEntries.vehicleId, vehicleId),
      ...bounds,
      excludeId ? ne(odometerEntries.id, excludeId) : undefined
    );
  const at = odometerEntries.recordedAt;
  return {
    at: (tx, side, edge) =>
      tx
        .select({ date: at })
        .from(odometerEntries)
        .where(where(side === 'before' ? lt(at, edge) : gte(at, edge)))
        .orderBy(side === 'before' ? desc(at) : asc(at))
        .limit(1)
        .get()?.date ?? null,
    bound: (tx, kind, from, to) =>
      tx
        .select({
          value: kind === 'max' ? max(odometerEntries.odometer) : min(odometerEntries.odometer),
        })
        .from(odometerEntries)
        .where(where(gte(at, from), lt(at, to)))
        .get()?.value ?? null,
  };
}

function pick(values: (number | null)[], kind: 'max' | 'min'): number | null {
  const present = values.filter((v): v is number => v != null);
  if (present.length === 0) return null;
  return kind === 'max' ? Math.max(...present) : Math.min(...present);
}

function odometerNeighbours(
  tx: DrizzleTransaction,
  { vehicleId, date, timeZone, excludeId }: OdometerCheck
): OdometerNeighbours {
  const sources = [expenseReadings(vehicleId, excludeId), manualReadings(vehicleId, excludeId)];
  const day = zonedDayWindow(date, timeZone);
  const nearest = (side: 'before' | 'after') => {
    const times = sources
      .map((s) => s.at(tx, side, side === 'before' ? day.dayStart : day.nextDay)?.getTime())
      .filter((t): t is number => t != null);
    if (times.length === 0) return null;
    const time = side === 'before' ? Math.max(...times) : Math.min(...times);
    return zonedDayWindow(new Date(time), timeZone);
  };
  const earlierDay = nearest('before');
  const laterDay = nearest('after');
  return {
    before: earlierDay
      ? pick(
          sources.map((s) => s.bound(tx, 'max', earlierDay.dayStart, day.dayStart)),
          'max'
        )
      : null,
    after: laterDay
      ? pick(
          sources.map((s) => s.bound(tx, 'min', day.nextDay, laterDay.nextDay)),
          'min'
        )
      : null,
  };
}

export function assertOdometerInOrder(tx: DrizzleTransaction, check: OdometerCheck | null): void {
  if (!check) return;
  const neighbours = odometerNeighbours(tx, check);
  const error = odometerOrderError(check.mileage, neighbours, check.initialMileage);
  if (error) throw new ValidationError(error);
}

function startOfDayIfDateOnly(d: Date, timeZone: string | undefined, isDay: boolean): Date {
  if (!timeZone || !isDay) return d;
  return zonedMidnight(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), timeZone);
}

function endOfDayIfDateOnly(d: Date, timeZone: string | undefined, isDay: boolean): Date {
  if (timeZone) {
    if (!isDay) return d;
    const nextDay = zonedMidnight(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate() + 1,
      timeZone
    );
    return new Date(nextDay.getTime() - 1);
  }
  const isLocalMidnight =
    d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0;
  if (!isLocalMidnight) return d;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function buildExpenseConditions(filters: ExpenseFilters): SQL[] {
  const conditions: SQL[] = [];

  if (filters.vehicleId) {
    conditions.push(eq(expenses.vehicleId, filters.vehicleId));
  }
  if (typeof filters.category === 'string') {
    conditions.push(eq(expenses.category, filters.category));
  } else if (filters.category?.length) {
    conditions.push(inArray(expenses.category, filters.category));
  }
  if (filters.startDate) {
    conditions.push(
      gte(
        expenses.date,
        startOfDayIfDateOnly(filters.startDate, filters.timeZone, filters.startDateIsDay === true)
      )
    );
  }
  if (filters.endDate) {
    conditions.push(
      lte(
        expenses.date,
        endOfDayIfDateOnly(filters.endDate, filters.timeZone, filters.endDateIsDay === true)
      )
    );
  }
  if (filters.tags?.length) {
    for (const tag of filters.tags) {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM json_each(${expenses.tags}) WHERE json_each.value = ${tag})`
      );
    }
  }
  const search = filters.search?.trim();
  if (search) conditions.push(searchCondition(search));

  return conditions;
}

const CURRENCY_AROUND = /^\p{Sc}?\s*(.*?)\s*\p{Sc}?$/u;
const DECIMAL_TAIL = /^(.*\d)[.,](\d{1,2})$/;
const GROUPED_WHOLE = /^\d{1,3}(?<sep>[.,\s])\d{3}(?:\k<sep>\d{3})*$/;

function parseWhole(digits: string, decimalMark?: string): number | null {
  if (/^\d+$/.test(digits)) return Number(digits);
  const grouped = GROUPED_WHOLE.exec(digits);
  if (!grouped || grouped.groups?.sep === decimalMark) return null;
  return Number(digits.replace(/\D/g, ''));
}

export function parseAmountTerm(term: string): { whole: number; cents?: number } | null {
  const core = CURRENCY_AROUND.exec(term)?.[1] ?? '';
  const decimal = DECIMAL_TAIL.exec(core);
  if (decimal) {
    const whole = parseWhole(decimal[1] ?? '', core.charAt(decimal[1]?.length ?? 0));
    if (whole !== null) return { whole, cents: Number((decimal[2] ?? '').padEnd(2, '0')) };
  }
  const whole = parseWhole(core);
  return whole === null ? null : { whole };
}

function amountCondition(term: string): SQL | undefined {
  const amount = parseAmountTerm(term);
  if (!amount) return undefined;
  const whole = amount.whole * 100;
  if (amount.cents === undefined) {
    return sql`(${expenses.expenseAmount} >= ${whole} AND ${expenses.expenseAmount} < ${whole + 100})`;
  }
  return eq(expenses.expenseAmount, whole + amount.cents);
}

function searchCondition(search: string): SQL {
  const escaped = search.toLowerCase().replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const pattern = `%${escaped}%`;
  const like = (column: SQL) => sql`lower(${column}) LIKE ${pattern} ESCAPE '\\'`;
  const amount = amountCondition(search);
  return sql`(${like(sql`${expenses.description}`)}
    OR ${like(sql`${expenses.category}`)}
    OR ${like(sql`${expenses.location}`)}
    OR EXISTS (SELECT 1 FROM json_each(${expenses.tags}) WHERE ${like(sql`json_each.value`)})
    OR EXISTS (SELECT 1 FROM ${vehicles} WHERE ${vehicles.id} = ${expenses.vehicleId}
      AND (${like(sql`${vehicles.nickname}`)} OR ${like(sql`${vehicles.make}`)} OR ${like(sql`${vehicles.model}`)}))
    ${amount ? sql`OR ${amount}` : sql``})`;
}

export type { PaginatedResult } from '../../utils/pagination';

interface ExpenseSummaryFilters {
  userId: string;
  vehicleId?: string;
  period?: '7d' | '30d' | '90d' | '1y' | 'all';
  timeZone?: string;
}

export interface ExpenseSummary {
  totalAmount: number;
  expenseCount: number;
  monthlyAverage: number;
  recentAmount: number;
  categoryBreakdown: Array<{ category: string; amount: number; count: number }>;
  monthlyTrend: Array<{ period: string; amount: number; count: number }>;
  costBuckets: CostBuckets;
}

export const OWNERSHIP_CATEGORIES = ['financial'] as const;

export interface CostBucketTotals {
  ownershipTotal: number;
  runningTotal: number;
}

export interface VehicleCostBuckets extends CostBucketTotals {
  vehicleId: string;
  previous: CostBucketTotals | null;
}

export interface CostBuckets extends CostBucketTotals {
  previous: CostBucketTotals | null;
  byVehicle: VehicleCostBuckets[];
}

function sumBuckets(rows: CostBucketTotals[]): CostBucketTotals {
  return rows.reduce(
    (acc, row) => ({
      ownershipTotal: acc.ownershipTotal + row.ownershipTotal,
      runningTotal: acc.runningTotal + row.runningTotal,
    }),
    { ownershipTotal: 0, runningTotal: 0 }
  );
}

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

function replayFor(existing: Expense, vehicleId: string): Expense {
  if (existing.vehicleId !== vehicleId) {
    throw new ConflictError('This request was already used for a different expense');
  }
  return existing;
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

  async findReplay(clientId: string, userId: string, vehicleId: string): Promise<Expense | null> {
    const existing = await this.findByClientId(clientId, userId);
    return existing && replayFor(existing, vehicleId);
  }

  async createIdempotent(
    data: NewExpense,
    odometer: OdometerCheck | null = null
  ): Promise<Expense> {
    const { clientId, userId } = data;
    try {
      return this.db.transaction((tx) => {
        if (clientId) {
          const existing = tx
            .select()
            .from(expenses)
            .where(and(eq(expenses.clientId, clientId), eq(expenses.userId, userId)))
            .get();
          if (existing) return replayFor(existing, data.vehicleId);
        }
        assertOdometerInOrder(tx, odometer);
        return tx.insert(expenses).values(data).returning().get();
      });
    } catch (error) {
      if (!clientId || error instanceof ValidationError || error instanceof ConflictError)
        throw error;
      const raced = await this.findByClientId(clientId, userId);
      if (raced) return replayFor(raced, data.vehicleId);
      throw error;
    }
  }

  async update(
    id: string,
    data: Partial<NewExpense>,
    odometer: OdometerCheck | null = null
  ): Promise<Expense> {
    return this.db.transaction((tx) => {
      assertOdometerInOrder(tx, odometer);
      const updated = tx
        .update(expenses)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(expenses.id, id))
        .returning()
        .get();
      if (!updated) throw new NotFoundError('Resource');
      return updated;
    });
  }

  // bun:sqlite transactions must stay synchronous; an async callback autocommits each insert alone.
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

  private async zonedMonthlyTrend(
    where: SQL | undefined,
    timeZone: string
  ): Promise<Array<{ period: string; amount: number; count: number }>> {
    const rows = await this.db
      .select({ date: expenses.date, amount: expenses.expenseAmount })
      .from(expenses)
      .where(where);
    const calendar = zonedCalendar(timeZone);
    const months = new Map<string, { amount: number; count: number }>();
    for (const row of rows) {
      const period = calendar.day(row.date).slice(0, 7);
      const bucket = months.get(period) ?? { amount: 0, count: 0 };
      bucket.amount += row.amount;
      bucket.count += 1;
      months.set(period, bucket);
    }
    return [...months.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, bucket]) => ({ period, ...bucket }));
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

      const [totals, categoryBreakdown, monthlyTrend, recentTotals, costBuckets] =
        await Promise.all([
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

          filters.timeZone
            ? this.zonedMonthlyTrend(periodWhere, filters.timeZone)
            : this.db
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

          this.costBuckets(filters, period),
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
        costBuckets,
      };
    } catch (error) {
      logger.error('Failed to get expense summary', {
        filters,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to get expense summary', error);
    }
  }

  private async costBuckets(
    filters: ExpenseSummaryFilters,
    period: NonNullable<ExpenseSummaryFilters['period']>
  ): Promise<CostBuckets> {
    const now = new Date();
    const start = getPeriodStartDate(period, now);
    const previousStart = start
      ? new Date(start.getTime() - (now.getTime() - start.getTime()))
      : null;
    const conditions: SQL[] = [eq(expenses.userId, filters.userId)];
    if (filters.vehicleId) conditions.push(eq(expenses.vehicleId, filters.vehicleId));
    if (previousStart) conditions.push(gte(expenses.date, previousStart));

    const isOwnership = inArray(expenses.category, [...OWNERSHIP_CATEGORIES]);
    const inCurrent = start ? gte(expenses.date, start) : sql`1`;
    const inPrevious = start ? lt(expenses.date, start) : sql`0`;
    const bucketSum = (when: SQL) =>
      sql<number>`COALESCE(SUM(CASE WHEN ${when} THEN ${expenses.expenseAmount} ELSE 0 END), 0)`;

    const rows = await this.db
      .select({
        vehicleId: expenses.vehicleId,
        ownershipTotal: bucketSum(sql`${inCurrent} AND ${isOwnership}`),
        runningTotal: bucketSum(sql`${inCurrent} AND NOT ${isOwnership}`),
        previousOwnershipTotal: bucketSum(sql`${inPrevious} AND ${isOwnership}`),
        previousRunningTotal: bucketSum(sql`${inPrevious} AND NOT ${isOwnership}`),
      })
      .from(expenses)
      .where(and(...conditions))
      .groupBy(expenses.vehicleId);

    const byVehicle = rows.map((row) => ({
      vehicleId: row.vehicleId,
      ownershipTotal: Number(row.ownershipTotal) || 0,
      runningTotal: Number(row.runningTotal) || 0,
      previous: start
        ? {
            ownershipTotal: Number(row.previousOwnershipTotal) || 0,
            runningTotal: Number(row.previousRunningTotal) || 0,
          }
        : null,
    }));
    return {
      ...sumBuckets(byVehicle),
      previous: start
        ? sumBuckets(byVehicle.map((row) => row.previous ?? { ownershipTotal: 0, runningTotal: 0 }))
        : null,
      byVehicle,
    };
  }

  // photo-service imports this module, so receipt file removal has to stay with the caller.
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
    { ownerId, createdBy }: { ownerId: string; createdBy: string | null }
  ): Promise<Expense[]> {
    try {
      const allocations = expenseSplitService.computeAllocations(
        data.splitConfig,
        data.totalAmount
      );
      const splitMethod: SplitMethod = data.splitConfig.method;

      // bun:sqlite transactions must stay synchronous; an async callback autocommits each insert alone.
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
        ownerId,
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
    try {
      // bun:sqlite transactions must stay synchronous; an async callback autocommits each insert alone.
      return this.db.transaction((tx) => {
        const [firstOld, ...restOld] = tx
          .select()
          .from(expenses)
          .where(this.groupOwnedBy(groupId, userId))
          .orderBy(asc(expenses.createdAt), asc(expenses.id))
          .all();
        if (!firstOld) {
          throw new NotFoundError('Split expense');
        }

        const totalAmount =
          data.splitConfig.method === 'absolute'
            ? data.splitConfig.allocations.reduce((sum, a) => sum + a.amount, 0)
            : (data.totalAmount ?? firstOld.groupTotal ?? firstOld.expenseAmount);

        return expenseSplitService.updateSiblingsSync(tx, {
          groupId,
          existing: [firstOld, ...restOld],
          createdBy,
          splitMethod: data.splitConfig.method,
          groupTotal: totalAmount,
          allocations: expenseSplitService.computeAllocations(data.splitConfig, totalAmount),
        });
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
