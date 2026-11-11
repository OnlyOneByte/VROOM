// Mileage rollup over already-fetched trips. Pure, so callers fetch rows first. Distance is derived
// per trip, never stored. The reimbursement rate is a parameter, because trips do not store one.

import { tripDistance } from '../api/trips/repository';
import { TRIP_PURPOSES, type TripPurpose } from '../api/trips/validation';
import type { Trip } from '../db/schema';

export type MilesByPurpose = Record<TripPurpose, number>;

export interface TripSummary {
  tripCount: number;
  totalMiles: number;
  /** Always has every purpose key, with 0 for purposes that have no trips. */
  milesByPurpose: MilesByPurpose;
  averageTripMiles: number;
  businessMiles: number;
  businessMileageValue: number;
  rate: number;
}

function zeroMilesByPurpose(): MilesByPurpose {
  // Built from TRIP_PURPOSES so a new purpose cannot be missing from the map.
  return Object.fromEntries(TRIP_PURPOSES.map((p) => [p, 0])) as MilesByPurpose;
}

// Callers must pass only trips the user may see.
export function buildTripSummary(trips: Trip[], rate = 0): TripSummary {
  const milesByPurpose = zeroMilesByPurpose();
  let totalMiles = 0;

  for (const trip of trips) {
    const miles = tripDistance(trip);
    totalMiles += miles;
    // Unknown purposes (legacy or imported rows) go to 'other' rather than being dropped.
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
