import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';

// Drizzle transaction type — shared across repositories and services
export type DrizzleTransaction = Parameters<
  Parameters<BunSQLiteDatabase<Record<string, unknown>>['transaction']>[0]
>[0];

// Expense Categories - Single source of truth
export const EXPENSE_CATEGORIES = [
  'fuel',
  'maintenance',
  'financial',
  'regulatory',
  'enhancement',
  'misc',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  fuel: 'Fuel',
  maintenance: 'Maintenance',
  financial: 'Financial',
  regulatory: 'Regulatory',
  enhancement: 'Enhancement',
  misc: 'Misc Operating Costs',
};

export const EXPENSE_CATEGORY_DESCRIPTIONS: Record<ExpenseCategory, string> = {
  fuel: 'Fuel and gas costs',
  maintenance: 'Keeping the car running (oil, repairs, tires)',
  financial: 'Loans, insurance',
  regulatory: 'Government-required (registration, inspection, tickets)',
  enhancement: 'Optional improvements (tint, accessories, detailing)',
  misc: 'Misc operating costs (tolls, parking, car washes, etc.)',
};

export type PaymentFrequency = 'monthly' | 'bi-weekly' | 'weekly' | 'custom';

export type AuthProvider = 'google';

export type SharePermission = 'view' | 'edit';

export type ShareStatus = 'pending' | 'accepted' | 'declined';

// Generic type guard generator for string union types
function createEnumGuard<T extends string>(validValues: readonly T[]) {
  return (value: string): value is T => validValues.includes(value as T);
}

// Validation functions - generated using createEnumGuard
export const isValidExpenseCategory = createEnumGuard(EXPENSE_CATEGORIES);

export const isValidPaymentFrequency = createEnumGuard([
  'monthly',
  'bi-weekly',
  'weekly',
  'custom',
] as const);

export const isValidSharePermission = createEnumGuard(['view', 'edit'] as const);

export const isValidShareStatus = createEnumGuard(['pending', 'accepted', 'declined'] as const);
