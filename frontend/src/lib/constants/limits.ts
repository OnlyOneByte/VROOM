export const NOTIFICATION_LIMITS = {
	MAX_HISTORY: 100
} as const;

export const EXPENSE_LIMITS = {
	MAX_AMOUNT: 1_000_000
} as const;

export const VEHICLE_LIMITS = {
	MIN_YEAR: 1900,
	MAX_YEARS_AHEAD: 1,
	VIN_MIN_LENGTH: 11,
	VIN_MAX_LENGTH: 17
} as const;

export const TRIP_LIMITS = {
	NOTE_MAX_LENGTH: 500
} as const;

export function maxVehicleYear(): number {
	return new Date().getFullYear() + VEHICLE_LIMITS.MAX_YEARS_AHEAD;
}

export const DISPLAY_LIMITS = {
	RECENT_SYNCED_EXPENSES: 5
} as const;
