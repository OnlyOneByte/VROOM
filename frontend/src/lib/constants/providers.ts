/**
 * Provider-related constants shared across settings components.
 */

import type { Component } from 'svelte';
import type { PhotoCategory, CategorySetting } from '$lib/types';

export interface ProviderTypeOption {
	id: string;
	label: string;
	description: string;
	icon: Component<Record<string, unknown>>;
	disabled: boolean;
}

/**
 * Default folder settings for new providers — all categories enabled with sensible paths.
 */
export const DEFAULT_FOLDER_SETTINGS: Record<PhotoCategory, CategorySetting> = {
	vehicle_photos: { enabled: true, folderPath: '/Vehicle Photos' },
	expense_receipts: { enabled: true, folderPath: '/Receipts' },
	insurance_docs: { enabled: true, folderPath: '/Insurance' },
	odometer_readings: { enabled: true, folderPath: '/Odometer' }
};
