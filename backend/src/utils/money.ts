import { z } from 'zod';
import type { CostBuckets, CostBucketTotals, ExpenseSummary } from '../api/expenses/repository';
import { CONFIG } from '../config';
import type { SplitConfig } from '../db/types';

// Round before truncating: 12.34 * 100 is 1233.9999… in binary floating point.
export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function centsToDollars(cents: number): number {
  return cents / 100;
}

function centsFieldsToDollars<T extends Record<string, unknown>>(
  row: T,
  moneyFields: readonly (keyof T)[]
): T {
  const out = { ...row };
  for (const f of moneyFields) {
    const v = out[f];
    if (typeof v === 'number') {
      out[f] = centsToDollars(v) as T[keyof T];
    }
  }
  return out;
}

const EXPENSE_MONEY_FIELDS = ['expenseAmount', 'groupTotal'] as const;
const FINANCING_MONEY_FIELDS = [
  'originalAmount',
  'paymentAmount',
  'residualValue',
  'excessMileageFee',
] as const;
const INSURANCE_TERM_MONEY_FIELDS = [
  'deductibleAmount',
  'coverageLimit',
  'totalCost',
  'monthlyCost',
  'paymentAmount',
] as const;
const INSURANCE_CLAIM_MONEY_FIELDS = ['payoutAmount'] as const;
const VEHICLE_MONEY_FIELDS = ['purchasePrice'] as const;
const REMINDER_MONEY_FIELDS = ['expenseAmount'] as const;

function mapMoney<T extends Record<string, unknown>>(row: T, fields: readonly (keyof T)[]): T;
function mapMoney<T extends Record<string, unknown>>(
  row: T | null | undefined,
  fields: readonly (keyof T)[]
): T | null | undefined;
function mapMoney<T extends Record<string, unknown>>(
  row: T | null | undefined,
  fields: readonly (keyof T)[]
): T | null | undefined {
  return row == null ? row : centsFieldsToDollars(row, fields);
}

export const expenseToApi = <T extends Record<string, unknown>>(row: T) =>
  mapMoney(row, EXPENSE_MONEY_FIELDS as readonly (keyof T)[]);
export const financingToApi = <T extends Record<string, unknown>>(row: T) =>
  mapMoney(row, FINANCING_MONEY_FIELDS as readonly (keyof T)[]);
export const insuranceTermToApi = <T extends Record<string, unknown>>(row: T) =>
  mapMoney(row, INSURANCE_TERM_MONEY_FIELDS as readonly (keyof T)[]);
export const insuranceClaimToApi = <T extends Record<string, unknown>>(row: T) =>
  mapMoney(row, INSURANCE_CLAIM_MONEY_FIELDS as readonly (keyof T)[]);
const vehicleToApi = <T extends Record<string, unknown>>(row: T) =>
  mapMoney(row, VEHICLE_MONEY_FIELDS as readonly (keyof T)[]);
function splitConfigToApi(split: SplitConfig): SplitConfig {
  if (split.method !== 'absolute') return split;
  return {
    ...split,
    allocations: split.allocations.map((a) => ({ ...a, amount: centsToDollars(a.amount) })),
  };
}

export function reminderToApi<T extends Record<string, unknown>>(row: T): T {
  const r = mapMoney(row, REMINDER_MONEY_FIELDS as readonly (keyof T)[]);
  const split = r.expenseSplitConfig as SplitConfig | null | undefined;
  return split ? { ...r, expenseSplitConfig: splitConfigToApi(split) } : r;
}

export function financingWithBalanceToApi<T extends Record<string, unknown>>(row: T): T {
  const withMoney = financingToApi(row);
  return typeof withMoney.computedBalance === 'number'
    ? { ...withMoney, computedBalance: centsToDollars(withMoney.computedBalance) }
    : withMoney;
}

export function vehicleRowToApi<T extends Record<string, unknown>>(row: T): T {
  const v = vehicleToApi(row);
  const fin = v.financing as Record<string, unknown> | null | undefined;
  if (fin && typeof fin === 'object') {
    return { ...v, financing: financingWithBalanceToApi(fin) };
  }
  return v;
}

export function reminderWithVehiclesToApi<T extends { reminder: Record<string, unknown> }>(
  row: T
): T {
  return { ...row, reminder: reminderToApi(row.reminder) };
}

export function expenseSummaryToApi(summary: ExpenseSummary): ExpenseSummary {
  return {
    ...summary,
    totalAmount: centsToDollars(summary.totalAmount),
    monthlyAverage: centsToDollars(summary.monthlyAverage),
    recentAmount: centsToDollars(summary.recentAmount),
    categoryBreakdown: summary.categoryBreakdown.map((r) => ({
      ...r,
      amount: centsToDollars(r.amount),
    })),
    monthlyTrend: summary.monthlyTrend.map((r) => ({ ...r, amount: centsToDollars(r.amount) })),
    costBuckets: costBucketsToApi(summary.costBuckets),
  };
}

function bucketTotalsToApi<T extends CostBucketTotals>(totals: T): T {
  return {
    ...totals,
    ownershipTotal: centsToDollars(totals.ownershipTotal),
    runningTotal: centsToDollars(totals.runningTotal),
  };
}

function costBucketsToApi(buckets: CostBuckets): CostBuckets {
  return {
    ...bucketTotalsToApi(buckets),
    previous: buckets.previous && bucketTotalsToApi(buckets.previous),
    byVehicle: buckets.byVehicle.map((row) => ({
      ...bucketTotalsToApi(row),
      previous: row.previous && bucketTotalsToApi(row.previous),
    })),
  };
}

// Refinements apply to the dollar value, so compose them before the cents transform.
function moneyDollarsToCents(build: (base: z.ZodNumber) => z.ZodNumber = (n) => n) {
  return build(z.number()).transform(dollarsToCents);
}

export function formatNumberForMessage(value: number): string {
  return value.toLocaleString('en-US');
}

const RELATIVE_DRIFT_TOLERANCE = 1e-12;
const MAX_EXPENSE_AMOUNT = CONFIG.validation.expense.maxAmount;

export function hasAtMostTwoDecimals(dollars: number): boolean {
  const cents = Math.round(dollars * 100);
  const drift = Math.abs(dollars - cents / 100);
  return (
    drift <= RELATIVE_DRIFT_TOLERANCE * Math.max(1, Math.abs(dollars)) &&
    (cents !== 0 || dollars === 0)
  );
}

export function boundedDollarsToCents(
  label: string,
  max: number,
  build: (base: z.ZodNumber) => z.ZodNumber = (n) => n
) {
  return moneyDollarsToCents((n) =>
    build(n)
      .max(max, `${label} must be ${formatNumberForMessage(max)} or less`)
      .refine(hasAtMostTwoDecimals, `${label} can have at most 2 decimal places`)
  );
}

export function expenseDollarsToCents(build: (base: z.ZodNumber) => z.ZodNumber = (n) => n) {
  return boundedDollarsToCents('Amount', MAX_EXPENSE_AMOUNT, build);
}
