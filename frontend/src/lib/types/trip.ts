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
	driverId?: string | null;
	createdAt: string;
	updatedAt: string;
}

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

export function tripDistance(trip: Pick<Trip, 'startOdometer' | 'endOdometer'>): number {
	return Math.max(0, trip.endOdometer - trip.startOdometer);
}
