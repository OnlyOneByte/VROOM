import { z } from 'zod';
import { ChargeUnit, DistanceUnit, type UnitPreferences, VolumeUnit } from '../types';

export const unitPreferencesSchema = z.object({
  distanceUnit: z.enum(DistanceUnit, {
    message: "Invalid distanceUnit: must be 'miles' or 'kilometers'",
  }),
  volumeUnit: z.enum(VolumeUnit, {
    message: "Invalid volumeUnit: must be 'gallons_us', 'gallons_uk', or 'liters'",
  }),
  chargeUnit: z.enum(ChargeUnit, {
    message: "Invalid chargeUnit: must be 'kwh'",
  }),
});

export const partialUnitPreferencesSchema = unitPreferencesSchema.partial();

export function mergeUnitPreferences(
  existing: UnitPreferences | null | undefined,
  partial: Partial<UnitPreferences> | undefined
): UnitPreferences | undefined {
  if (!partial) return undefined;
  return { ...(existing ?? {}), ...partial } as UnitPreferences;
}
