/**
 * UI-related constants
 * Centralized configuration for consistent UI behavior
 */

/**
 * Scroll heights for different table/list views
 */
export const SCROLL_HEIGHTS = {
	TABLE_DEFAULT: '600px',
	TABLE_COMPACT: '400px',
	TABLE_LARGE: '800px'
} as const;

/**
 * Notification system configuration
 */
export const NOTIFICATION_CONFIG = {
	MAX_HISTORY_SIZE: 100,
	DEFAULT_DURATION: 5000,
	ERROR_DURATION: 8000,
	WARNING_DURATION: 6000,
	SUCCESS_DURATION: 5000,
	INFO_DURATION: 5000
} as const;

/**
 * Animation durations (in milliseconds)
 */
export const ANIMATION_DURATION = {
	FAST: 150,
	NORMAL: 300,
	SLOW: 500
} as const;

/**
 * Breakpoints for responsive design (matches Tailwind defaults)
 */
export const BREAKPOINTS = {
	SM: 640,
	MD: 768,
	LG: 1024,
	XL: 1280,
	'2XL': 1536
} as const;

/**
 * Z-index layers for consistent stacking
 */
export const Z_INDEX = {
	DROPDOWN: 1000,
	STICKY: 1020,
	FIXED: 1030,
	MODAL_BACKDROP: 1040,
	MODAL: 1050,
	POPOVER: 1060,
	TOOLTIP: 1070,
	NOTIFICATION: 1080
} as const;
