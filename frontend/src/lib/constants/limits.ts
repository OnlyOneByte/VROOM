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
