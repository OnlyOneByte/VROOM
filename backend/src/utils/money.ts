import { z } from 'zod';
import type { CostBuckets, CostBucketTotals, ExpenseSummary } from '../api/expenses/repository';
import { CONFIG } from '../config';
import type { SplitConfig } from '../db/types';
import { ValidationError } from '../errors';
import SHARED_CURRENCIES from '../shared-currencies.json';

// Round before truncating: 12.34 * 100 is 1233.9999… in binary floating point.
export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

const NO_DECIMALS = new Set(SHARED_CURRENCIES.noDecimals);

export function minorUnitScale(currency: string): number {
  return NO_DECIMALS.has(currency) ? 1 : 100;
}

export function currencyFormatOptions(currency: string): Intl.NumberFormatOptions {
  const digits = Math.log10(minorUnitScale(currency));
  return {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  };
}

export function toMajor(scale: number) {
  const major = (minor: number): number => minor / scale;
  const majorOrNull = (minor: number | null): number | null =>
    minor == null ? minor : major(minor);
  return { major, majorOrNull };
}

const PARSED_SCALE = 100;

export function parsedToMinor(cents: number, scale: number): number {
  const minor = (cents * scale) / PARSED_SCALE;
  if (!Number.isInteger(minor)) {
    const digits = Math.log10(scale);
    throw new ValidationError(
      digits > 0
        ? `Amounts in this currency can have at most ${digits} decimal places`
        : 'Amounts in this currency must be whole numbers'
    );
  }
  return minor;
}

function parsedFieldsToMinor<T extends object>(
  row: T,
  fields: readonly string[],
  scale: number
): T {
  const out = { ...row } as Record<string, unknown>;
  for (const f of fields) {
    const v = out[f];
    if (typeof v === 'number') out[f] = parsedToMinor(v, scale);
  }
  return out as T;
}

export function splitConfigFromApi<T extends SplitConfig>(split: T, scale: number): T {
  if (split.method !== 'absolute') return split;
  return {
    ...split,
    allocations: split.allocations.map((a) => ({ ...a, amount: parsedToMinor(a.amount, scale) })),
  };
}

function minorFieldsToMajor<T extends Record<string, unknown>>(
  row: T,
  moneyFields: readonly (keyof T)[],
  scale: number
): T {
  const out = { ...row };
  for (const f of moneyFields) {
    const v = out[f];
    if (typeof v === 'number') {
      out[f] = (v / scale) as T[keyof T];
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

export const expenseFromApi = <T extends object>(row: T, scale: number) =>
  parsedFieldsToMinor(row, EXPENSE_MONEY_FIELDS, scale);
export const financingFromApi = <T extends object>(row: T, scale: number) =>
  parsedFieldsToMinor(row, FINANCING_MONEY_FIELDS, scale);
export const insuranceTermFromApi = <T extends object>(row: T, scale: number) =>
  parsedFieldsToMinor(row, INSURANCE_TERM_MONEY_FIELDS, scale);
export const insuranceClaimFromApi = <T extends object>(row: T, scale: number) =>
  parsedFieldsToMinor(row, INSURANCE_CLAIM_MONEY_FIELDS, scale);
export const vehicleFromApi = <T extends object>(row: T, scale: number) =>
  parsedFieldsToMinor(row, VEHICLE_MONEY_FIELDS, scale);

export function reminderFromApi<T extends { expenseSplitConfig?: SplitConfig | null }>(
  row: T,
  scale: number
): T {
  const r = parsedFieldsToMinor(row, REMINDER_MONEY_FIELDS, scale);
  return r.expenseSplitConfig
    ? { ...r, expenseSplitConfig: splitConfigFromApi(r.expenseSplitConfig, scale) }
    : r;
}

function mapMoney<T extends Record<string, unknown>>(
  row: T,
  fields: readonly (keyof T)[],
  scale: number
): T;
function mapMoney<T extends Record<string, unknown>>(
  row: T | null | undefined,
  fields: readonly (keyof T)[],
  scale: number
): T | null | undefined;
function mapMoney<T extends Record<string, unknown>>(
  row: T | null | undefined,
  fields: readonly (keyof T)[],
  scale: number
): T | null | undefined {
  return row == null ? row : minorFieldsToMajor(row, fields, scale);
}

export const expenseToApi = <T extends Record<string, unknown>>(row: T, scale: number) =>
  mapMoney(row, EXPENSE_MONEY_FIELDS as readonly (keyof T)[], scale);
export const financingToApi = <T extends Record<string, unknown>>(row: T, scale: number) =>
  mapMoney(row, FINANCING_MONEY_FIELDS as readonly (keyof T)[], scale);
export const insuranceTermToApi = <T extends Record<string, unknown>>(row: T, scale: number) =>
  mapMoney(row, INSURANCE_TERM_MONEY_FIELDS as readonly (keyof T)[], scale);
export const insuranceClaimToApi = <T extends Record<string, unknown>>(row: T, scale: number) =>
  mapMoney(row, INSURANCE_CLAIM_MONEY_FIELDS as readonly (keyof T)[], scale);
const vehicleToApi = <T extends Record<string, unknown>>(row: T, scale: number) =>
  mapMoney(row, VEHICLE_MONEY_FIELDS as readonly (keyof T)[], scale);
function splitConfigToApi(split: SplitConfig, scale: number): SplitConfig {
  if (split.method !== 'absolute') return split;
  return {
    ...split,
    allocations: split.allocations.map((a) => ({ ...a, amount: a.amount / scale })),
  };
}

export function reminderToApi<T extends Record<string, unknown>>(row: T, scale: number): T {
  const r = mapMoney(row, REMINDER_MONEY_FIELDS as readonly (keyof T)[], scale);
  const split = r.expenseSplitConfig as SplitConfig | null | undefined;
  return split ? { ...r, expenseSplitConfig: splitConfigToApi(split, scale) } : r;
}

export function financingWithBalanceToApi<T extends Record<string, unknown>>(
  row: T,
  scale: number
): T {
  const withMoney = financingToApi(row, scale);
  return typeof withMoney.computedBalance === 'number'
    ? { ...withMoney, computedBalance: withMoney.computedBalance / scale }
    : withMoney;
}

export function vehicleRowToApi<T extends Record<string, unknown>>(row: T, scale: number): T {
  const { carShareRules: _rules, ...rest } = vehicleToApi(row, scale);
  const v = rest as T;
  const fin = v.financing as Record<string, unknown> | null | undefined;
  if (fin && typeof fin === 'object') {
    return { ...v, financing: financingWithBalanceToApi(fin, scale) };
  }
  return v;
}

export function reminderWithVehiclesToApi<T extends { reminder: Record<string, unknown> }>(
  row: T,
  scale: number
): T {
  return { ...row, reminder: reminderToApi(row.reminder, scale) };
}

export function expenseSummaryToApi(summary: ExpenseSummary, scale: number): ExpenseSummary {
  const { major } = toMajor(scale);
  return {
    ...summary,
    totalAmount: major(summary.totalAmount),
    monthlyAverage: major(summary.monthlyAverage),
    recentAmount: major(summary.recentAmount),
    categoryBreakdown: summary.categoryBreakdown.map((r) => ({ ...r, amount: major(r.amount) })),
    monthlyTrend: summary.monthlyTrend.map((r) => ({ ...r, amount: major(r.amount) })),
    costBuckets: costBucketsToApi(summary.costBuckets, scale),
  };
}

function bucketTotalsToApi<T extends CostBucketTotals>(totals: T, scale: number): T {
  return {
    ...totals,
    ownershipTotal: totals.ownershipTotal / scale,
    runningTotal: totals.runningTotal / scale,
  };
}

function costBucketsToApi(buckets: CostBuckets, scale: number): CostBuckets {
  return {
    ...bucketTotalsToApi(buckets, scale),
    previous: buckets.previous && bucketTotalsToApi(buckets.previous, scale),
    byVehicle: buckets.byVehicle.map((row) => ({
      ...bucketTotalsToApi(row, scale),
      previous: row.previous && bucketTotalsToApi(row.previous, scale),
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

export function formatMoneyForMessage(minor: number, currency: string): string {
  return (minor / minorUnitScale(currency)).toLocaleString(
    'en-US',
    currencyFormatOptions(currency)
  );
}

export function formatDateForMessage(date: Date, options: Intl.DateTimeFormatOptions): string {
  return date.toLocaleDateString('en-US', options);
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
