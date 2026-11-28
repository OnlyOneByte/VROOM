import type { PhotoCategory } from '#lib/types/index.ts';

export const SCROLL_HEIGHTS = {
	TABLE_DEFAULT: '600px'
} as const;

export const PHOTO_CATEGORY_LABELS: Record<PhotoCategory, string> = {
	vehicle_photos: 'Vehicle photos',
	expense_receipts: 'Expense receipts',
	insurance_docs: 'Insurance docs',
	odometer_readings: 'Odometer readings'
};
