/**
 * UI-related constants
 * Centralized configuration for consistent UI behavior
 */

import type { PhotoCategory } from '$lib/types';

/**
 * Scroll heights for different table/list views
 */
export const SCROLL_HEIGHTS = {
	TABLE_DEFAULT: '600px'
} as const;

/**
 * Human-readable labels for photo categories
 */
export const PHOTO_CATEGORY_LABELS: Record<PhotoCategory, string> = {
	vehicle_photos: 'Vehicle Photos',
	expense_receipts: 'Expense Receipts',
	insurance_docs: 'Insurance Docs',
	odometer_readings: 'Odometer Readings'
};
