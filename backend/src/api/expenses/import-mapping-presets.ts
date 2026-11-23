import { parse } from 'csv-parse/sync';
import type { ExpenseCategory } from '../../db/types';
import { DistanceUnit, VolumeUnit } from '../../types';
import { fuelioFormat } from './fuelio-import';
import {
  applyMapping,
  type ColumnMapping,
  CSV_ACCEPT,
  type ImportDateFormat,
  type NativeField,
  type TargetUnitsResolver,
} from './import-mapping';

export const IMPORT_DETECT_SAMPLE_LENGTH = 8192;

export interface ImportFormatOptions {
  mapping: ColumnMapping;
  targetUnitsFor: TargetUnitsResolver;
  timeZone?: string;
}

export interface NativeCsvResult {
  csv: string;
  unmappedCategories: string[];
  rowErrors: Map<number, string>;
}

export interface ImportFormat {
  id: string;
  label: string;
  accept: string[];
  detect(sample: string): boolean;
  toNativeCsv(text: string, opts: ImportFormatOptions): NativeCsvResult;
}

interface MappingPreset {
  id: string;
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

export function sampleHeaders(sample: string): string[] {
  const line = sample.split(/\r?\n/).find((l) => l.trim() !== '');
  if (!line) return [];
  try {
    const rows = parse(line, { bom: true, relax_quotes: true, trim: true }) as string[][];
    return rows[0] ?? [];
  } catch {
    return [];
  }
}

function presetFormat(preset: MappingPreset): ImportFormat {
  return {
    id: preset.id,
    label: preset.label,
    accept: CSV_ACCEPT,
    detect: (sample) => detectSource(sampleHeaders(sample))?.id === preset.id,
    toNativeCsv: (text, { mapping, targetUnitsFor, timeZone }) =>
      applyMapping(
        text,
        {
          ...presetToMapping(preset, mapping.targetVehicle),
          categoryMap: { ...preset.categoryMap, ...mapping.categoryMap },
        },
        targetUnitsFor,
        timeZone
      ),
  };
}

export const IMPORT_FORMATS: ImportFormat[] = [fuelioFormat, ...MAPPING_PRESETS.map(presetFormat)];

export function detectImportFormat(sample: string): ImportFormat | null {
  return IMPORT_FORMATS.find((format) => format.detect(sample)) ?? null;
}

export function importFormatList(): { formats: { id: string; label: string }[]; accept: string[] } {
  return {
    formats: IMPORT_FORMATS.map(({ id, label }) => ({ id, label })),
    accept: [...new Set([...CSV_ACCEPT, ...IMPORT_FORMATS.flatMap((format) => format.accept)])],
  };
}

export function findImportFormat(id: string | undefined): ImportFormat | null {
  return IMPORT_FORMATS.find((format) => format.id === id) ?? null;
}
