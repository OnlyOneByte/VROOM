import { tripDistance } from '../api/trips/repository';
import { TRIP_PURPOSES, type TripPurpose } from '../api/trips/validation';
import type { Trip } from '../db/schema';

export type DistanceByPurpose = Record<TripPurpose, number>;

export interface TripSummary {
  tripCount: number;
  totalDistance: number;
  distanceByPurpose: DistanceByPurpose;
  averageTripDistance: number;
  businessDistance: number;
  businessMileageValue: number;
  rate: number;
}

function zeroDistanceByPurpose(): DistanceByPurpose {
  return Object.fromEntries(TRIP_PURPOSES.map((p) => [p, 0])) as DistanceByPurpose;
}

type TripDistanceConverter = (distance: number, vehicleId: string) => number;

const sameUnit: TripDistanceConverter = (distance) => distance;

export function buildTripSummary(
  trips: Trip[],
  rate = 0,
  toUserDistance: TripDistanceConverter = sameUnit
): TripSummary {
  const distanceByPurpose = zeroDistanceByPurpose();
  let totalDistance = 0;

  for (const trip of trips) {
    const distance = toUserDistance(tripDistance(trip), trip.vehicleId);
    totalDistance += distance;
    const purpose: TripPurpose = (TRIP_PURPOSES as readonly string[]).includes(trip.purpose)
      ? (trip.purpose as TripPurpose)
      : 'other';
    distanceByPurpose[purpose] += distance;
  }

  const tripCount = trips.length;
  const businessDistance = distanceByPurpose.business;

  return {
    tripCount,
    totalDistance,
    distanceByPurpose,
    averageTripDistance: tripCount > 0 ? totalDistance / tripCount : 0,
    businessDistance,
    businessMileageValue: businessDistance * rate,
    rate,
  };
}
