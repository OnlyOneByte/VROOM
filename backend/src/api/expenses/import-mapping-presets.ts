/**
 * Built-in import presets for the common fuel trackers (spec `import-trackers` T2; D5
 * ratified the set: Fuelly + Fuelio + Drivvo). Each preset is a ready-made `ColumnMapping`
 * (the T1 contract) plus a header SIGNATURE used by `detectSource()` to auto-pick it from an
 * uploaded file's header row. The client merges a detected preset's mapping into the import
 * dialog so the user starts from sensible column/unit/category defaults instead of a blank
 * mapper; they can still override anything (units, date format, category remaps) before commit.
 *
 * Pure (no I/O): header strings in, a preset (or null) out — unit-testable without a server.
 *
 * SIGNATURE MATCHING is token-NORMALIZED (lower-case, strip non-alphanumerics) AND substring-
 * based, so real-world drift — `Odometer (km)` vs `Odo (km)`, `Fuel (litres)` vs `Fuel`,
 * BOM/whitespace/punctuation — doesn't defeat detection. A preset matches when EVERY signature
 * token is a substring of SOME normalized file header, so an export with extra/decorated columns
 * still detects. Signature tokens are the few DISTINCTIVE columns that identify the tracker
 * (e.g. Fuelly's `fillamount`, Fuelio's `litres`, Drivvo's `totalprice`/`typeoffuel`) — generic
 * tokens like `date`/`price` are deliberately omitted so the matches don't collide.
 *
 * ⚠️ The exact column names below are BEST-EFFORT from each tracker's documented CSV export and
 * are intentionally matched loosely. Spec acceptance defers validation against a REAL Fuelly/
 * Fuelio export to T6 (the e2e); if a real file mis-detects, fix the signature/columns here —
 * `detectSource` returning null is the safe failure (the user just falls back to manual mapping,
 * never a wrong auto-map). Detection is a convenience, not a correctness dependency.
 */

import type { ExpenseCategory } from '../../db/types';
import { DistanceUnit, VolumeUnit } from '../../types';
import type { ColumnMapping, ImportDateFormat, NativeField } from './import-mapping';

export type PresetId = 'fuelly' | 'fuelio' | 'drivvo';

export interface MappingPreset {
  id: PresetId;
  /** Human label for the detected-source banner. */
  label: string;
  /**
   * Normalized header tokens that must ALL be present for a file to match this preset.
   * Keep these to the few columns that uniquely identify the tracker (not every column).
   */
  signature: string[];
  /** The default field→header mapping this preset seeds (user-overridable). */
  columns: Partial<Record<NativeField, string>>;
  dateFormat: ImportDateFormat;
  distanceUnit?: DistanceUnit;
  volumeUnit?: VolumeUnit;
  categoryMap?: Record<string, ExpenseCategory>;
  /** Category for a blank category cell (D2). Fuel trackers have no category column → `fuel`. */
  defaultCategory?: ExpenseCategory;
}

/** Lower-case + strip every non-alphanumeric char, so `Odometer (mi)` → `odometermi`. */
export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Built-in presets. Column names mirror each tracker's documented CSV export header row;
 * `signature` is the minimal uniquely-identifying subset. `dateFormat`/units are the
 * tracker's typical defaults — the user confirms them in the mapper (units are never guessed
 * from data, per D1). categoryMap covers each tracker's common fuel/service words; anything
 * unmapped becomes `misc` with a visible note (D2), so the map need not be exhaustive.
 */
export const MAPPING_PRESETS: MappingPreset[] = [
  {
    id: 'fuelly',
    label: 'Fuelly',
    // Fuelly fuel-log export columns (documented): Date, Odometer, Fill Amount, Price,
    // Fuel Type, Notes, ... — `fillamount` is the distinctive one (no other preset has it).
    signature: ['odometer', 'fillamount'],
    columns: {
      date: 'Date',
      mileage: 'Odometer',
      volume: 'Fill Amount',
      amount: 'Price',
      fuelType: 'Fuel Type',
      description: 'Notes',
    },
    dateFormat: 'mdy',
    distanceUnit: DistanceUnit.MILES,
    volumeUnit: VolumeUnit.GALLONS_US,
    categoryMap: { gas: 'fuel', fuel: 'fuel', service: 'maintenance' },
    // A Fuelly refuel export has no category column → every row's category cell is blank; default
    // those to fuel so a detected log produces ready fuel rows instead of 0-ready "Unknown category".
    defaultCategory: 'fuel',
  },
  {
    id: 'fuelio',
    label: 'Fuelio',
    // Fuelio CSV export columns (documented): Data, Odo (km), Fuel (litres), Full, Price, ...
    // `odo` + `litres` distinguish it (substring of `Odo (km)` / `Fuel (litres)`); metric default.
    signature: ['odo', 'litres'],
    columns: {
      date: 'Data',
      mileage: 'Odo (km)',
      volume: 'Fuel (litres)',
      amount: 'Price',
      description: 'Notes',
    },
    dateFormat: 'dmy',
    distanceUnit: DistanceUnit.KILOMETERS,
    volumeUnit: VolumeUnit.LITERS,
    categoryMap: { gas: 'fuel', fuel: 'fuel', petrol: 'fuel', service: 'maintenance' },
    // Fuelio refuel export has no category column → default blank cells to fuel (see Fuelly above).
    defaultCategory: 'fuel',
  },
  {
    id: 'drivvo',
    label: 'Drivvo',
    // Drivvo refuelling export columns (documented): Date, Odometer, Total price, Price per
    // unit, Volume, Type of fuel, ... — `totalprice` + `typeoffuel` distinguish it.
    signature: ['totalprice', 'typeoffuel'],
    columns: {
      date: 'Date',
      mileage: 'Odometer',
      volume: 'Volume',
      amount: 'Total price',
      fuelType: 'Type of fuel',
      description: 'Observation',
    },
    dateFormat: 'dmy',
    distanceUnit: DistanceUnit.KILOMETERS,
    volumeUnit: VolumeUnit.LITERS,
    categoryMap: {
      gas: 'fuel',
      fuel: 'fuel',
      'full tank': 'fuel',
      service: 'maintenance',
      maintenance: 'maintenance',
    },
    // Drivvo refuelling export has no category column → default blank cells to fuel (see Fuelly above).
    defaultCategory: 'fuel',
  },
];

/**
 * Pick the preset whose every signature token is a SUBSTRING of some normalized file header,
 * or null when none matches (→ the user maps manually). Substring (not exact) matching absorbs
 * the decoration real exports add (`odo` matches `Odo (km)`, `litres` matches `Fuel (litres)`).
 * When more than one matches, the MOST SPECIFIC wins (longest signature). Returns a preset
 * reference straight from the table.
 */
export function detectSource(headers: string[]): MappingPreset | null {
  const normalized = headers.map(normalizeHeader);
  const matches = MAPPING_PRESETS.filter((preset) =>
    preset.signature.every((token) => normalized.some((h) => h.includes(token)))
  );
  if (matches.length === 0) return null;
  // Most-specific (longest signature) wins ties.
  return matches.reduce((best, p) => (p.signature.length > best.signature.length ? p : best));
}

/** Build a ready-to-use ColumnMapping from a preset (the dialog merges targetVehicle in). */
export function presetToMapping(preset: MappingPreset, targetVehicle?: string): ColumnMapping {
  return {
    source: preset.id,
    columns: preset.columns,
    targetVehicle,
    dateFormat: preset.dateFormat,
    distanceUnit: preset.distanceUnit,
    volumeUnit: preset.volumeUnit,
    categoryMap: preset.categoryMap,
    defaultCategory: preset.defaultCategory,
  };
}
