import type { NativeImportField } from '$lib/types';
import type { ImportMappingPreset } from '$lib/types/import-mapping';
import { guessManualColumns, isNativeImportHeaders } from '$lib/utils/import-mapping-helpers';

export interface DetectionOutcome {
	/** Empty when the user must pick the vehicle themselves. */
	targetVehicleId: string;
	/** Non-null only when the file needs manual column mapping, pre-filled with guesses. */
	manualColumns: Partial<Record<NativeImportField, string>> | null;
}

/**
 * Decides how a file's headers should be imported. Preset files and native VROOM exports need no
 * manual mapping; anything else starts a manual mapping seeded with column guesses. A single
 * vehicle is auto-selected, since there is no other choice to make.
 */
export function detectionOutcome(
	headers: string[],
	preset: ImportMappingPreset | null,
	vehicleIds: string[]
): DetectionOutcome {
	if (preset) {
		return { targetVehicleId: soleId(vehicleIds), manualColumns: null };
	}
	if (isNativeImportHeaders(headers)) {
		return { targetVehicleId: '', manualColumns: null };
	}
	return { targetVehicleId: soleId(vehicleIds), manualColumns: guessManualColumns(headers) };
}

function soleId(vehicleIds: string[]): string {
	return vehicleIds.length === 1 && vehicleIds[0] ? vehicleIds[0] : '';
}
