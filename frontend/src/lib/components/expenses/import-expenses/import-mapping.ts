import type {
	DistanceUnit,
	ExpenseCategory,
	ImportColumnMapping,
	ImportDateFormat,
	NativeImportField,
	Vehicle,
	VolumeUnit
} from '#lib/types/index.ts';
import type { ImportMappingPreset } from '#lib/types/import-mapping.ts';
import { presetImportMapping } from '#lib/utils/import-mapping-helpers.ts';
import { getVehicleDisplayName } from '#lib/utils/vehicle-helpers.ts';

export type ManualColumns = Partial<Record<NativeImportField, string>>;

export interface ManualMappingInput {
	enabled: boolean;
	columns: ManualColumns;
	dateFormat: ImportDateFormat;
	distanceUnit: DistanceUnit;
	volumeUnit: VolumeUnit;
}

export type TargetVehicle = Pick<Vehicle, 'year' | 'make' | 'model' | 'nickname'>;

export interface MappingInput {
	preset: ImportMappingPreset | null;
	targetVehicle: TargetVehicle | undefined;
	manual: ManualMappingInput;
	categoryRemap: Record<string, ExpenseCategory | undefined>;
}

export function definedColumns(columns: ManualColumns): ManualColumns {
	return Object.fromEntries(Object.entries(columns).filter(([, v]) => v)) as ManualColumns;
}

export function assignedCategoryMap(
	categoryRemap: Record<string, ExpenseCategory | undefined>
): Record<string, ExpenseCategory> {
	return Object.fromEntries(Object.entries(categoryRemap).filter(([, v]) => v)) as Record<
		string,
		ExpenseCategory
	>;
}

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
			...(hasRemap ? { categoryMap: remap } : {}),
			...(columns.vehicle || !targetVehicle
				? {}
				: { targetVehicle: getVehicleDisplayName(targetVehicle) })
		};
	}

	return null;
}
