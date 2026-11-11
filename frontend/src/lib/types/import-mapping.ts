import type { ExpenseCategory } from './expense.js';
import type { DistanceUnit, VolumeUnit } from './settings.js';

/** Mapping types for importing from other expense trackers. Mirror the backend import-mapping contract. */

/** A VROOM-native expense field a foreign column can map onto (the subset the importer consumes). */
export type NativeImportField =
	| 'date'
	| 'vehicle'
	| 'category'
	| 'amount'
	| 'mileage'
	| 'volume'
	| 'fuelType'
	| 'description'
	| 'tags'
	| 'missedFillup';

export type ImportDateFormat = 'iso' | 'mdy' | 'dmy' | 'epoch';

export type ImportPresetId = 'fuelly' | 'fuelio' | 'drivvo';

/**
 * Sent as `mapping` to POST /expenses/import. Mirrors the backend columnMappingSchema; unmapped
 * fields are omitted from `columns`. Units are converted to the target vehicle's units server-side.
 */
export interface ImportColumnMapping {
	source?: string;
	columns: Partial<Record<NativeImportField, string>>;
	/** Stamped on every row when the file has no vehicle column. */
	targetVehicle?: string;
	dateFormat: ImportDateFormat;
	/** Source file's distance unit. */
	distanceUnit?: DistanceUnit;
	/** Source file's volume unit. */
	volumeUnit?: VolumeUnit;
	/** Lower-cased foreign category word to VROOM category. Unmatched words become `misc`. */
	categoryMap?: Record<string, ExpenseCategory>;
	/** Used for blank category cells. Fuel-tracker presets set `fuel`. */
	defaultCategory?: ExpenseCategory;
}

/** Mirrors the backend MappingPreset. A null detection result means the user maps columns manually. */
export interface ImportMappingPreset {
	id: ImportPresetId;
	label: string;
	/** Normalized header tokens that must all be present for a file to match. */
	signature: string[];
	columns: Partial<Record<NativeImportField, string>>;
	dateFormat: ImportDateFormat;
	distanceUnit?: DistanceUnit;
	volumeUnit?: VolumeUnit;
	categoryMap?: Record<string, ExpenseCategory>;
}
