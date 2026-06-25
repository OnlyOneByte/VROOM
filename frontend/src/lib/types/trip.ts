/**
 * Trip & Location types (trips-location T6 — the FE data layer). Mirror the backend shapes:
 *   - Trip            ← db/schema.ts `trips` ($inferSelect), dates serialized as ISO strings over the wire.
 *   - TripPurpose     ← backend TRIP_PURPOSES (D4 enum) — one source of truth for the FE form/filter.
 *   - TripSummary     ← backend buildTripSummary() output (R4 mileage rollup, C212).
 * distance is DERIVED on the backend (max(0, end−start), never stored); the FE computes the same for
 * display via a shared helper rather than expecting a column.
 */

/** The four trip purposes (D4) — kept identical to the backend TRIP_PURPOSES tuple. */
export const TRIP_PURPOSES = ['business', 'personal', 'commute', 'other'] as const;
export type TripPurpose = (typeof TRIP_PURPOSES)[number];

export interface Trip {
	id: string;
	vehicleId: string;
	startOdometer: number;
	endOdometer: number;
	purpose: TripPurpose;
	/** ISO timestamp (the backend stores a timestamp; serialized as a string over the wire). */
	tripDate: string;
	startLocation?: string | null;
	endLocation?: string | null;
	note?: string | null;
	createdAt: string;
	updatedAt: string;
}

/** Miles driven per purpose — every D4 key always present (0 when none). Mirrors the backend MilesByPurpose. */
export type MilesByPurpose = Record<TripPurpose, number>;

/** The mileage-summary rollup (R4) — the backend buildTripSummary() result shape. */
export interface TripSummary {
	tripCount: number;
	totalMiles: number;
	milesByPurpose: MilesByPurpose;
	averageTripMiles: number;
	businessMiles: number;
	businessMileageValue: number;
	rate: number;
}

/** Derived trip distance: driven miles, clamped at 0 (R2/#46) — the FE mirror of the backend tripDistance. */
export function tripDistance(trip: Pick<Trip, 'startOdometer' | 'endOdometer'>): number {
	return Math.max(0, trip.endOdometer - trip.startOdometer);
}
