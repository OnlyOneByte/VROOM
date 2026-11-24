import { DEFAULT_UNIT_PREFERENCES, type UnitPreferences } from '../../../types';
import type { CommunityExpense, CommunityVehicle } from '../aggregator';

export const NOW = new Date('2026-06-01T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

export function fillUps(options: {
  count?: number;
  distance?: number;
  volume?: number;
  cents?: number;
  fuelType?: string;
  startMileage?: number;
}): CommunityExpense[] {
  const {
    count = 6,
    distance = 300,
    volume = 10,
    cents = 4000,
    fuelType = 'Regular',
    startMileage = 10_000,
  } = options;
  return Array.from({ length: count }, (_, i) => ({
    date: new Date(NOW.getTime() - (count - i) * 20 * DAY),
    category: 'fuel',
    expenseAmount: cents,
    mileage: startMileage + i * distance,
    volume,
    fuelType,
    missedFillup: false,
    sourceType: null,
  }));
}

export function vehicle(
  ownerId: string,
  overrides: Partial<CommunityVehicle> & { units?: UnitPreferences } = {}
): CommunityVehicle {
  const { units, ...rest } = overrides;
  return {
    ownerId,
    vehicleId: `${ownerId}-v${Math.random().toString(36).slice(2, 8)}`,
    catalogModelId: 'honda-civic',
    modelYear: 2019,
    vehicleType: 'gas',
    vehicleKind: 'car',
    unitPreferences: units ?? DEFAULT_UNIT_PREFERENCES,
    currency: 'USD',
    region: null,
    firstRecordAt: new Date(NOW.getTime() - 400 * DAY),
    lastRecordAt: new Date(NOW.getTime() - 20 * DAY),
    expenses: fillUps({}),
    odometerReadings: [],
    insurancePremiums: [],
    ...rest,
  };
}

export function owners(count: number, prefix = 'owner'): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}-${i}`);
}

export const NO_NOISE = () => 0.5;
