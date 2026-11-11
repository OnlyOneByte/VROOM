// Money is stored and computed as integer cents. Dollars exist only at the input edge
// (dollarsToCents) and the response edge (centsToDollars).

import { z } from 'zod';
import type { ExpenseSummary } from '../api/expenses/repository';

// Round before truncating: 12.34 * 100 is 1233.9999… in binary floating point.
export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function centsToDollars(cents: number): number {
  return cents / 100;
}

// Shallow copy. Null or undefined money values stay absent.
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

// Apply at route response boundaries only. Repositories and analytics must keep reading cents.
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
export const reminderToApi = <T extends Record<string, unknown>>(row: T) =>
  mapMoney(row, REMINDER_MONEY_FIELDS as readonly (keyof T)[]);

// computedBalance is derived in cents upstream. It is converted only when present, because a
// freshly written row has none. The financing route and the vehicle route both embed financing, so
// they share this mapper to show the same balance.
export function financingWithBalanceToApi<T extends Record<string, unknown>>(row: T): T {
  const withMoney = financingToApi(row);
  return typeof withMoney.computedBalance === 'number'
    ? { ...withMoney, computedBalance: centsToDollars(withMoney.computedBalance) }
    : withMoney;
}

// Also converts the embedded financing. Shared with the assistant tools, which return vehicle rows
// too.
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
  };
}

// Bounds apply to the dollar value the client sent, so compose them on the base z.number()
// before the transform.
//  moneyDollarsToCents((n) => n.positive('Amount must be positive'))
//  moneyDollarsToCents((n) => n.min(0, 'Cannot be negative')).optional()
export function moneyDollarsToCents(build: (base: z.ZodNumber) => z.ZodNumber = (n) => n) {
  return build(z.number()).transform(dollarsToCents);
}
