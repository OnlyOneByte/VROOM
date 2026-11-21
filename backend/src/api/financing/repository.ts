import { and, asc, eq, inArray } from 'drizzle-orm';
import type { AppDatabase } from '../../db/connection';
import { getDb } from '../../db/connection';
import type { NewVehicleFinancing, VehicleFinancing } from '../../db/schema';
import { expenses, vehicleFinancing } from '../../db/schema';
import { DatabaseError } from '../../errors';
import { logger } from '../../utils/logger';
import { BaseRepository } from '../../utils/repository';

export const PAYOFF_BALANCE_THRESHOLD = 100;

export function isEligibleForPayoff(computedBalance: number): boolean {
  return computedBalance <= PAYOFF_BALANCE_THRESHOLD;
}

export function withComputedBalance<T>(
  financing: T,
  computedBalance: number
): T & { computedBalance: number; eligibleForPayoff: boolean } {
  return { ...financing, computedBalance, eligibleForPayoff: isEligibleForPayoff(computedBalance) };
}

const MS_PER_DAY = 86_400_000;

function utcDayStart(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function addUtcMonthsClamped(dayStart: number, months: number): number {
  const start = new Date(dayStart);
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Date.UTC(year, month, Math.min(start.getUTCDate(), lastDay));
}

export function elapsedMonths(startDate: Date, date: Date): number {
  const start = utcDayStart(startDate);
  const end = utcDayStart(date);
  if (end <= start) return 0;
  const from = new Date(start);
  const to = new Date(end);
  let whole =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + to.getUTCMonth() - from.getUTCMonth();
  let anchor = addUtcMonthsClamped(start, whole);
  if (anchor > end) {
    whole--;
    anchor = addUtcMonthsClamped(start, whole);
  }
  const next = addUtcMonthsClamped(start, whole + 1);
  return whole + Math.round((end - anchor) / MS_PER_DAY) / Math.round((next - anchor) / MS_PER_DAY);
}

export interface AmortizationTerms {
  originalAmount: number;
  apr: number | null;
  startDate: Date;
  financingType: string;
}

export interface DatedPayment {
  date: Date;
  amount: number;
}

export function amortizedBalance(terms: AmortizationTerms, payments: DatedPayment[]): number {
  const monthlyRate =
    terms.financingType === 'loan' && terms.apr && terms.apr > 0 ? terms.apr / 100 / 12 : 0;
  const ordered = [...payments].sort((a, b) => a.date.getTime() - b.date.getTime());
  let balance = terms.originalAmount;
  const first = ordered[0];
  let accruedMonths = first ? Math.max(0, elapsedMonths(terms.startDate, first.date) - 1) : 0;
  for (const payment of ordered) {
    const months = Math.max(accruedMonths, elapsedMonths(terms.startDate, payment.date));
    const interest = Math.round(balance * monthlyRate * (months - accruedMonths));
    accruedMonths = months;
    balance = Math.max(0, balance + interest - payment.amount);
  }
  return balance;
}

export class FinancingRepository extends BaseRepository<VehicleFinancing, NewVehicleFinancing> {
  constructor(db: AppDatabase) {
    super(db, vehicleFinancing);
  }

  async findByVehicleId(vehicleId: string): Promise<VehicleFinancing | null> {
    const result = await this.db
      .select()
      .from(vehicleFinancing)
      .where(eq(vehicleFinancing.vehicleId, vehicleId))
      .limit(1);
    return result[0] || null;
  }

  async computeBalance(financingId: string): Promise<number> {
    const balances = await this.computeBalances([financingId]);
    return balances.get(financingId) ?? 0;
  }

  async computeBalances(financingIds: string[]): Promise<Map<string, number>> {
    const balances = new Map<string, number>();
    if (financingIds.length === 0) {
      return balances;
    }
    try {
      const records = await this.db
        .select({
          id: vehicleFinancing.id,
          originalAmount: vehicleFinancing.originalAmount,
          apr: vehicleFinancing.apr,
          startDate: vehicleFinancing.startDate,
          financingType: vehicleFinancing.financingType,
        })
        .from(vehicleFinancing)
        .where(inArray(vehicleFinancing.id, financingIds));

      const paymentRows = await this.db
        .select({
          sourceId: expenses.sourceId,
          date: expenses.date,
          amount: expenses.expenseAmount,
        })
        .from(expenses)
        .where(and(eq(expenses.sourceType, 'financing'), inArray(expenses.sourceId, financingIds)))
        .orderBy(asc(expenses.date), asc(expenses.id));

      const paymentsByFinancing = new Map<string, DatedPayment[]>();
      for (const row of paymentRows) {
        if (row.sourceId) {
          const list = paymentsByFinancing.get(row.sourceId) ?? [];
          list.push({ date: row.date, amount: row.amount });
          paymentsByFinancing.set(row.sourceId, list);
        }
      }

      for (const record of records) {
        balances.set(record.id, amortizedBalance(record, paymentsByFinancing.get(record.id) ?? []));
      }

      return balances;
    } catch (error) {
      logger.error('Error batch-computing financing balances', {
        count: financingIds.length,
        error,
      });
      throw new DatabaseError('Failed to compute financing balances', error);
    }
  }
}

export const financingRepository = new FinancingRepository(getDb());
