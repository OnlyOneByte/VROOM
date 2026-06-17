/**
 * Shared unitPreferences Zod schema + partial-merge helper (C238 dedup).
 *
 * `unitPreferencesSchema` / `partialUnitPreferencesSchema` were declared BYTE-IDENTICALLY in both
 * vehicles/routes.ts and settings/routes.ts (same enums, same error-message strings), and the PUT
 * handlers in both files repeated the same `partial ? { ...existing, ...partial } : undefined` merge.
 * Two sources of truth for the same validation contract — a future enum or message change would have
 * to be made in both or silently drift. One home here (pure: depends only on zod + the type enums,
 * NOT on the repo-heavy validation.ts).
 */

import { z } from 'zod';
import { ChargeUnit, DistanceUnit, type UnitPreferences, VolumeUnit } from '../types';

/** Full unitPreferences object — every unit required (used for create). */
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

/** Partial version for PATCH/PUT updates (each field optional). */
export const partialUnitPreferencesSchema = unitPreferencesSchema.partial();

/**
 * Merge a partial unitPreferences update over the existing values, returning a full UnitPreferences —
 * or `undefined` when there's nothing to merge (so the caller can conditionally include the field in
 * its DB update and leave the column untouched when no unit fields were sent). A null/undefined
 * `existing` is spread harmlessly (an empty object), matching the prior inline behavior at both sites.
 */
export function mergeUnitPreferences(
  existing: UnitPreferences | null | undefined,
  partial: Partial<UnitPreferences> | undefined
): UnitPreferences | undefined {
  if (!partial) return undefined;
  return { ...(existing ?? {}), ...partial } as UnitPreferences;
}
