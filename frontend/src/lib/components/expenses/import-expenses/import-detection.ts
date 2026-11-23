import type { NativeImportField } from '#lib/types/index.ts';
import type { DetectedImportFormat } from '#lib/types/import-mapping.ts';
import { guessManualColumns, isNativeImportHeaders } from '#lib/utils/import-mapping-helpers.ts';

interface DetectionOutcome {
	targetVehicleId: string;
	manualColumns: Partial<Record<NativeImportField, string>> | null;
}

export function detectionOutcome(
	headers: string[],
	preset: DetectedImportFormat | null,
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
