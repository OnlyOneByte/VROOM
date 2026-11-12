import type { ExpenseCategory } from './expense.js';
import type { DistanceUnit, VolumeUnit } from './settings.js';

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

export interface ImportColumnMapping {
	source?: string;
	columns: Partial<Record<NativeImportField, string>>;
	targetVehicle?: string;
	dateFormat: ImportDateFormat;
	distanceUnit?: DistanceUnit;
	volumeUnit?: VolumeUnit;
	categoryMap?: Record<string, ExpenseCategory>;
	defaultCategory?: ExpenseCategory;
}

export interface ImportMappingPreset {
	id: ImportPresetId;
	label: string;
	signature: string[];
	columns: Partial<Record<NativeImportField, string>>;
	dateFormat: ImportDateFormat;
	distanceUnit?: DistanceUnit;
	volumeUnit?: VolumeUnit;
	categoryMap?: Record<string, ExpenseCategory>;
	defaultCategory?: ExpenseCategory;
}
