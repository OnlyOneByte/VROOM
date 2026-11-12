import type { PhotoCategory } from '#lib/types/index.ts';

export const SCROLL_HEIGHTS = {
	TABLE_DEFAULT: '600px'
} as const;

export const PHOTO_CATEGORY_LABELS: Record<PhotoCategory, string> = {
	vehicle_photos: 'Vehicle Photos',
	expense_receipts: 'Expense Receipts',
	insurance_docs: 'Insurance Docs',
	odometer_readings: 'Odometer Readings'
};
