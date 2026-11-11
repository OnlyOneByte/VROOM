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

// Must match the frontend's CATEGORY_LABELS word for word.
export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  fuel: 'Fuel & Charging',
  maintenance: 'Maintenance',
  financial: 'Financial',
  regulatory: 'Regulatory',
  enhancement: 'Enhancement',
  misc: 'Misc',
};

export const EXPENSE_CATEGORY_DESCRIPTIONS: Record<ExpenseCategory, string> = {
  fuel: 'Fuel, gas, and electric charging costs',
  maintenance: 'Keeping the car running (oil, repairs, tires)',
  financial: 'Loans, insurance',
  regulatory: 'Government-required (registration, inspection, tickets)',
  enhancement: 'Optional improvements (tint, accessories, detailing)',
  misc: 'Misc operating costs (tolls, parking, car washes, etc.)',
};

export type PaymentFrequency = 'monthly' | 'bi-weekly' | 'weekly' | 'custom';

// Defined in db so the reminders column type and the expense split API share one shape without db
// depending on api. Absolute amounts are cents.
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
