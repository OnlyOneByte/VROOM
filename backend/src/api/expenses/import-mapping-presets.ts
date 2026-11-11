/**
 * Built-in column presets for common fuel trackers, used to auto-detect the source from a
 * file's header row. Column names are best-effort from each tracker's CSV export and matched
 * loosely; a null detection is the safe failure (the user maps manually). These exports are
 * fill-up logs with no category column, so each preset defaults blank categories to fuel.
 */

import type { ExpenseCategory } from '../../db/types';
import { DistanceUnit, VolumeUnit } from '../../types';
import type { ColumnMapping, ImportDateFormat, NativeField } from './import-mapping';

export type PresetId = 'fuelly' | 'fuelio' | 'drivvo';

export interface MappingPreset {
  id: PresetId;
  label: string;
  signature: string[];
  columns: Partial<Record<NativeField, string>>;
  dateFormat: ImportDateFormat;
  distanceUnit?: DistanceUnit;
  volumeUnit?: VolumeUnit;
  categoryMap?: Record<string, ExpenseCategory>;
  defaultCategory?: ExpenseCategory;
}

export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export const MAPPING_PRESETS: MappingPreset[] = [
  {
    id: 'fuelly',
    label: 'Fuelly',
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
    defaultCategory: 'fuel',
  },
  {
    id: 'fuelio',
    label: 'Fuelio',
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
    defaultCategory: 'fuel',
  },
  {
    id: 'drivvo',
    label: 'Drivvo',
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
    defaultCategory: 'fuel',
  },
];

export function detectSource(headers: string[]): MappingPreset | null {
  const normalized = headers.map(normalizeHeader);
  const matches = MAPPING_PRESETS.filter((preset) =>
    preset.signature.every((token) => normalized.some((h) => h.includes(token)))
  );
  if (matches.length === 0) return null;
  return matches.reduce((best, p) => (p.signature.length > best.signature.length ? p : best));
}

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
