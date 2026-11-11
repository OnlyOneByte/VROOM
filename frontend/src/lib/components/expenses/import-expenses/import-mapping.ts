import type {
	DistanceUnit,
	ExpenseCategory,
	ImportColumnMapping,
	ImportDateFormat,
	NativeImportField,
	Vehicle,
	VolumeUnit
} from '$lib/types';
import type { ImportMappingPreset } from '$lib/types/import-mapping';
import { presetImportMapping } from '$lib/utils/import-mapping-helpers';
import { getVehicleDisplayName } from '$lib/utils/vehicle-helpers';

export type ManualColumns = Partial<Record<NativeImportField, string>>;

export interface ManualMappingInput {
	enabled: boolean;
	columns: ManualColumns;
	dateFormat: ImportDateFormat;
	distanceUnit: DistanceUnit;
	volumeUnit: VolumeUnit;
}

/** Only the fields the mapping's display name reads. */
export type TargetVehicle = Pick<Vehicle, 'year' | 'make' | 'model' | 'nickname'>;

export interface MappingInput {
	preset: ImportMappingPreset | null;
	targetVehicle: TargetVehicle | undefined;
	manual: ManualMappingInput;
	categoryRemap: Record<string, ExpenseCategory | undefined>;
}

/** Drops unset entries so an unmapped field never reaches the server as an empty header name. */
export function definedColumns(columns: ManualColumns): ManualColumns {
	return Object.fromEntries(Object.entries(columns).filter(([, v]) => v)) as ManualColumns;
}

/** Drops cleared category selections; a remap entry only exists once a category is chosen. */
export function assignedCategoryMap(
	categoryRemap: Record<string, ExpenseCategory | undefined>
): Record<string, ExpenseCategory> {
	return Object.fromEntries(Object.entries(categoryRemap).filter(([, v]) => v)) as Record<
		string,
		ExpenseCategory
	>;
}

/**
 * The column mapping the server needs to import the file, or null while the user still has to
 * supply something (a target vehicle, or the required Date and Amount columns).
 */
export function buildImportMapping(input: MappingInput): ImportColumnMapping | null {
	const { preset, targetVehicle, manual, categoryRemap } = input;
	const remap = assignedCategoryMap(categoryRemap);
	const hasRemap = Object.keys(remap).length > 0;

	if (preset && targetVehicle) {
		return presetImportMapping(preset, getVehicleDisplayName(targetVehicle), remap);
	}

	const hasVehicle = !!manual.columns.vehicle || !!targetVehicle;
	if (manual.enabled && manual.columns.date && manual.columns.amount && hasVehicle) {
		const columns = definedColumns(manual.columns);
		return {
			columns,
			dateFormat: manual.dateFormat,
			...(columns.mileage ? { distanceUnit: manual.distanceUnit } : {}),
			...(columns.volume ? { volumeUnit: manual.volumeUnit } : {}),
			// Sent only once a remap exists; otherwise a manual file's category column passes through verbatim.
			...(hasRemap ? { categoryMap: remap } : {}),
			...(columns.vehicle || !targetVehicle
				? {}
				: { targetVehicle: getVehicleDisplayName(targetVehicle) })
		};
	}

	return null;
}
