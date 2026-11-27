export const EXPENSE_CATEGORIES = [
  'fuel',
  'maintenance',
  'financial',
  'regulatory',
  'enhancement',
  'misc',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const VEHICLE_TYPES = ['gas', 'electric', 'hybrid'] as const;

export const VEHICLE_KINDS = ['car', 'motorcycle', 'van', 'truck', 'rv', 'other'] as const;

export type VehicleKind = (typeof VEHICLE_KINDS)[number];

export function isVehicleKind(value: unknown): value is VehicleKind {
  return typeof value === 'string' && (VEHICLE_KINDS as readonly string[]).includes(value);
}

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

export const CHARGER_TYPES = ['home', 'workplace', 'public_l2', 'dc_fast'] as const;
export type ChargerType = (typeof CHARGER_TYPES)[number];

export function isElectricFuelType(fuelType: string | null): boolean {
  return (
    fuelType !== null &&
    ELECTRIC_FUEL_TYPES.includes(fuelType as (typeof ELECTRIC_FUEL_TYPES)[number])
  );
}
