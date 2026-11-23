import type { AppDatabase } from './connection';

export type DrizzleTransaction = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];

export const EXPENSE_CATEGORIES = [
  'fuel',
  'maintenance',
  'financial',
  'regulatory',
  'enhancement',
  'misc',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export type PaymentFrequency = 'monthly' | 'bi-weekly' | 'weekly' | 'custom';

export type SplitConfig =
  | { method: 'even'; vehicleIds: string[] }
  | { method: 'absolute'; allocations: { vehicleId: string; amount: number }[] }
  | { method: 'percentage'; allocations: { vehicleId: string; percentage: number }[] };

export const ELECTRIC_FUEL_TYPES = [
  'Electric',
  'Level 1 (Home)',
  'Level 2 (AC)',
  'DC Fast Charging',
] as const;

export function isElectricFuelType(fuelType: string | null): boolean {
  return (
    fuelType !== null &&
    ELECTRIC_FUEL_TYPES.includes(fuelType as (typeof ELECTRIC_FUEL_TYPES)[number])
  );
}
