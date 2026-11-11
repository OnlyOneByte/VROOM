/** Trip types mirroring the backend. Distance is derived, never stored; use tripDistance(). */

// Must match the backend TRIP_PURPOSES tuple.
export const TRIP_PURPOSES = ['business', 'personal', 'commute', 'other'] as const;
export type TripPurpose = (typeof TRIP_PURPOSES)[number];

export interface Trip {
	id: string;
	vehicleId: string;
	startOdometer: number;
	endOdometer: number;
	purpose: TripPurpose;
	tripDate: string;
	startLocation?: string | null;
	endLocation?: string | null;
	note?: string | null;
	createdAt: string;
	updatedAt: string;
}

// Every purpose key is always present, 0 when none.
export type MilesByPurpose = Record<TripPurpose, number>;

/** Mirrors the backend buildTripSummary() result. */
export interface TripSummary {
	tripCount: number;
	totalMiles: number;
	milesByPurpose: MilesByPurpose;
	averageTripMiles: number;
	businessMiles: number;
	businessMileageValue: number;
	rate: number;
}

/** Driven miles, clamped at 0. Mirrors the backend tripDistance. */
export function tripDistance(trip: Pick<Trip, 'startOdometer' | 'endOdometer'>): number {
	return Math.max(0, trip.endOdometer - trip.startOdometer);
}
