/**
 * Application limits and thresholds
 */

export const NOTIFICATION_LIMITS = {
	/** Maximum number of notifications to keep in history */
	MAX_HISTORY: 100
} as const;

export const DISPLAY_LIMITS = {
	/** Number of recently synced expenses to show */
	RECENT_SYNCED_EXPENSES: 5,

	/** Maximum items to show in a preview list */
	PREVIEW_LIST_MAX: 10
} as const;

export const PAGINATION = {
	/** Default page size for lists */
	DEFAULT_PAGE_SIZE: 20,

	/** Page size options */
	PAGE_SIZE_OPTIONS: [10, 20, 50, 100] as const
} as const;

/** Maintenance thresholds (in days) */
export const MAINTENANCE_THRESHOLDS = {
	/** Days since last maintenance to show "due soon" warning */
	DUE_SOON: 60,

	/** Days since last maintenance to show "overdue" alert */
	OVERDUE: 90
} as const;

/** Vehicle age thresholds (in days) */
export const VEHICLE_AGE_THRESHOLDS = {
	/** Vehicles added within this many days are considered "recent" */
	RECENT: 30
} as const;

/** Expense analysis periods (in days) */
export const EXPENSE_PERIODS = {
	/** Recent expense period for analysis */
	RECENT: 30,

	/** Comparison period (previous period) */
	COMPARISON: 60
} as const;
