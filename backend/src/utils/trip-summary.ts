/**
 * Trip mileage-summary rollup (trips-location T5, design §5, R4) — a PURE function over already-fetched
 * trip rows. Kept DB-free (no analytics-repository singleton bind, the C77 trap): the route fetches the
 * user's/vehicle's trips via tripRepository, then calls this. Split-safe BY CONSTRUCTION — trips never
 * split, so there's no volume=null sibling / denominator class (#18/#56) to guard.
 *
 * The reimbursement report (R4): total miles by purpose, business-$ = businessMiles × rate, trip count,
 * and average trip distance (div-guarded count>0). Distance per trip is the shared derived
 * `tripDistance` (max(0, end−start), R2/#46) — never a stored column, so a later odometer correction can't
 * desync it. The business-mileage rate is a PARAMETER (not read from a stored field): D3 ratified a
 * configurable rate in userPreferences + an optional per-trip override, but that persistence is a separate
 * schema/migration slice (see the §7 note — trips deliberately introduced no rate column yet), so T5
 * computes the math against a supplied rate and leaves the rate's STORAGE to that follow-on.
 */

import { tripDistance } from '../api/trips/repository';
import { TRIP_PURPOSES, type TripPurpose } from '../api/trips/validation';
import type { Trip } from '../db/schema';
import { toMonthKey } from './analytics-charts';

/** Miles driven per purpose (every purpose present, 0 when none) + the grand total. */
export type MilesByPurpose = Record<TripPurpose, number>;

export interface TripSummary {
  tripCount: number;
  totalMiles: number;
  /** Miles by purpose — all four keys always present (0 if no trips of that purpose). */
  milesByPurpose: MilesByPurpose;
  /** Average trip distance = totalMiles / tripCount, or 0 when there are no trips (div-guard). */
  averageTripMiles: number;
  /** The business-mileage reimbursement $ = business miles × rate (the R4 headline). */
  businessMiles: number;
  businessMileageValue: number;
  /** The rate used (echoed back so the caller/UI can label the figure unambiguously). */
  rate: number;
}

/** A zeroed miles-by-purpose map with every D4 purpose key present. */
function zeroMilesByPurpose(): MilesByPurpose {
  // Build from TRIP_PURPOSES so a future purpose can't be silently missing (the source-of-truth tuple).
  return Object.fromEntries(TRIP_PURPOSES.map((p) => [p, 0])) as MilesByPurpose;
}

/**
 * Roll up a set of trips into the mileage summary (R4). `rate` is the business-mileage reimbursement rate
 * (currency per mile); pass 0 to omit the $ figure. Robust to an empty list → all zeros (never NaN).
 * `trips` is assumed already tenant-scoped by the caller (tripRepository finders are userId-scoped).
 */
export function buildTripSummary(trips: Trip[], rate = 0): TripSummary {
  const milesByPurpose = zeroMilesByPurpose();
  let totalMiles = 0;

  for (const trip of trips) {
    const miles = tripDistance(trip);
    totalMiles += miles;
    // A trip's purpose is the D4 enum at the write boundary; guard an unexpected value (legacy/imported
    // row) by bucketing it under 'other' rather than crashing or silently dropping its miles.
    const purpose: TripPurpose = (TRIP_PURPOSES as readonly string[]).includes(trip.purpose)
      ? (trip.purpose as TripPurpose)
      : 'other';
    milesByPurpose[purpose] += miles;
  }

  const tripCount = trips.length;
  const businessMiles = milesByPurpose.business;

  return {
    tripCount,
    totalMiles,
    milesByPurpose,
    averageTripMiles: tripCount > 0 ? totalMiles / tripCount : 0,
    businessMiles,
    businessMileageValue: businessMiles * rate,
    rate,
  };
}

/** Per-YYYY-MM-month rollup (R5 local tripDate bucketing) — a summary per calendar month the trips touch. */
export function buildTripSummaryByMonth(trips: Trip[], rate = 0): Record<string, TripSummary> {
  const byMonth = new Map<string, Trip[]>();
  for (const trip of trips) {
    const key = toMonthKey(trip.tripDate);
    const bucket = byMonth.get(key);
    if (bucket) bucket.push(trip);
    else byMonth.set(key, [trip]);
  }
  const out: Record<string, TripSummary> = {};
  for (const [month, monthTrips] of byMonth) {
    out[month] = buildTripSummary(monthTrips, rate);
  }
  return out;
}
