import type { ExpenseCategory } from './expense.js';
import type { DistanceUnit, VolumeUnit } from './settings.js';

/**
 * Frontend types for the import-from-other-trackers mapping step (import-trackers T4/T5).
 * These MIRROR the backend contract (backend `import-mapping.ts` / `import-mapping-presets.ts`):
 * the eyes-on mapping dialog builds an `ImportColumnMapping` from the file's headers (optionally
 * pre-filled by a detected `ImportMappingPreset`) and hands it to `expenseApi.importExpensesCsv`.
 * Kept as a standalone domain file so the barrel (`$lib/types`) re-exports them like every other domain.
 */

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

/** How dates are encoded in the foreign file (backend D3). */
export type ImportDateFormat = 'iso' | 'mdy' | 'dmy' | 'epoch';

/** Built-in tracker presets the backend can detect from a file's headers. */
export type ImportPresetId = 'fuelly' | 'fuelio' | 'drivvo';

/**
 * The field→header mapping the dialog sends to `POST /expenses/import` as `mapping`. Mirrors the
 * backend `ColumnMapping` / `columnMappingSchema` exactly — unmapped fields stay absent from
 * `columns`; `targetVehicle` stamps every row when the file has no vehicle column (D4); the file's
 * own units (D1) drive conversion into the target vehicle's units server-side.
 */
export interface ImportColumnMapping {
	/** Preset id this came from, or undefined for a hand-built mapping. */
	source?: string;
	/** VROOM field → the foreign header that supplies it. Unmapped fields are omitted. */
	columns: Partial<Record<NativeImportField, string>>;
	/** Vehicle name to stamp on every row when the file has no vehicle column (D4). */
	targetVehicle?: string;
	dateFormat: ImportDateFormat;
	/** The FILE's distance unit (D1) — conversion needs both this and the target vehicle's unit. */
	distanceUnit?: DistanceUnit;
	/** The FILE's volume unit (D1). */
	volumeUnit?: VolumeUnit;
	/** Foreign category word (lower-cased) → VROOM category (D2). Unmatched → `misc` + a note. */
	categoryMap?: Record<string, ExpenseCategory>;
}

/**
 * A detected tracker preset (the `POST /expenses/import/detect` result, or null → manual mapping).
 * Mirrors the backend `MappingPreset`; the dialog seeds its fields as the editable starting point.
 */
export interface ImportMappingPreset {
	id: ImportPresetId;
	/** Human label for the detected-source banner. */
	label: string;
	/** Normalized header tokens that must ALL be present for a file to match. */
	signature: string[];
	columns: Partial<Record<NativeImportField, string>>;
	dateFormat: ImportDateFormat;
	distanceUnit?: DistanceUnit;
	volumeUnit?: VolumeUnit;
	categoryMap?: Record<string, ExpenseCategory>;
}
