import { tripDistance } from '../api/trips/repository';
import { TRIP_PURPOSES, type TripPurpose } from '../api/trips/validation';
import type { Trip } from '../db/schema';

export type MilesByPurpose = Record<TripPurpose, number>;

export interface TripSummary {
  tripCount: number;
  totalMiles: number;
  milesByPurpose: MilesByPurpose;
  averageTripMiles: number;
  businessMiles: number;
  businessMileageValue: number;
  rate: number;
}

function zeroMilesByPurpose(): MilesByPurpose {
  return Object.fromEntries(TRIP_PURPOSES.map((p) => [p, 0])) as MilesByPurpose;
}

export type TripDistanceConverter = (distance: number, vehicleId: string) => number;

const sameUnit: TripDistanceConverter = (distance) => distance;

export function buildTripSummary(
  trips: Trip[],
  rate = 0,
  toUserDistance: TripDistanceConverter = sameUnit
): TripSummary {
  const milesByPurpose = zeroMilesByPurpose();
  let totalMiles = 0;

  for (const trip of trips) {
    const miles = toUserDistance(tripDistance(trip), trip.vehicleId);
    totalMiles += miles;
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
