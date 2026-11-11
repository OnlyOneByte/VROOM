/**
 * Translates a foreign tracker CSV (Fuelly, Fuelio, Drivvo, ...) into VROOM's native CSV shape
 * so the regular import plan can validate and commit it. Pure: no DB access.
 */

import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { EXPENSE_CATEGORIES, type ExpenseCategory } from '../../db/types';
import { DistanceUnit, VolumeUnit } from '../../types';
import { convertDistance, convertVolume } from '../../utils/unit-conversions';
import { buildLocalDate } from './local-date';

export type NativeField =
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

export interface ColumnMapping {
  source?: string;
  columns: Partial<Record<NativeField, string>>;
  targetVehicle?: string;
  dateFormat: ImportDateFormat;
  distanceUnit?: DistanceUnit;
  volumeUnit?: VolumeUnit;
  categoryMap?: Record<string, ExpenseCategory>;
  /** Applied only to a blank category cell; a named but unrecognized word still maps to misc. */
  defaultCategory?: ExpenseCategory;
}

const mappedHeader = z.string().min(1).max(200).optional();

/**
 * Validates a client-supplied ColumnMapping. `columns` is listed field by field as optional
 * because `z.record(z.enum(...))` would require every key and reject partial mappings.
 */
export const columnMappingSchema = z.object({
  source: z.string().max(64).optional(),
  columns: z.object({
    date: mappedHeader,
    vehicle: mappedHeader,
    category: mappedHeader,
    amount: mappedHeader,
    mileage: mappedHeader,
    volume: mappedHeader,
    fuelType: mappedHeader,
    description: mappedHeader,
    tags: mappedHeader,
    missedFillup: mappedHeader,
  }),
  targetVehicle: z.string().max(200).optional(),
  dateFormat: z.enum(['iso', 'mdy', 'dmy', 'epoch']),
  distanceUnit: z.enum(DistanceUnit).optional(),
  volumeUnit: z.enum(VolumeUnit).optional(),
  categoryMap: z.record(z.string().max(200), z.enum(EXPENSE_CATEGORIES)).optional(),
  defaultCategory: z.enum(EXPENSE_CATEGORIES).optional(),
});

// VROOM stores each expense in its vehicle's own units, so values are converted into these.
// An omitted unit skips conversion.
export interface TargetUnits {
  distanceUnit?: DistanceUnit;
  volumeUnit?: VolumeUnit;
}

export interface ApplyMappingResult {
  csv: string;
  unmappedCategories: string[];
}

export class CsvMappingError extends Error {}

export const NATIVE_HEADER: NativeField[] = [
  'date',
  'vehicle',
  'category',
  'amount',
  'mileage',
  'volume',
  'fuelType',
  'description',
  'tags',
  'missedFillup',
];

// When both separators appear, the last one is the decimal point (handles 1.234,56 and 1,234.56).
// A lone comma is read as the decimal point.
export function normalizeDecimal(raw: string): string {
  const s = raw.trim();
  if (!s) return s;
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  if (hasDot && hasComma) {
    const commaIsDecimal = s.lastIndexOf(',') > s.lastIndexOf('.');
    return commaIsDecimal ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  }
  if (hasComma) return s.replace(',', '.');
  return s;
}

function epochToIso(n: number): string | null {
  if (!Number.isFinite(n)) return null;
  const ms = Math.abs(n) >= 1e12 ? n : n * 1000;
  const dt = new Date(ms);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

// Built from numeric parts in local time: `new Date('YYYY-MM-DD')` parses as UTC and would shift
// the day back for users west of UTC. Unparseable input is returned unchanged so the import plan
// reports it per row.

export function normalizeForeignDate(raw: string, format: ImportDateFormat): string {
  const s = raw.trim();
  if (!s) return '';

  if (format === 'epoch') return epochToIso(Number(s)) ?? s;

  if (format === 'iso' && /\d{4}-\d{2}-\d{2}t.*([z]|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const dt = new Date(s);
    return Number.isNaN(dt.getTime()) ? s : dt.toISOString();
  }

  const [datePart, timePart = ''] = s.split(/[ t]/i);
  const nums = datePart.split(/[/.-]/).map(Number);
  if (nums.length < 3 || nums.some((n) => !Number.isInteger(n))) return s;

  let year: number;
  let month: number;
  let day: number;
  if (format === 'mdy') [month, day, year] = nums;
  else if (format === 'dmy') [day, month, year] = nums;
  else [year, month, day] = nums;
  if (year < 100) year += 2000;

  const [hh = 0, mm = 0, ss = 0] = timePart.split(':').map((t) => Number.parseInt(t, 10) || 0);

  const dt = buildLocalDate(year, month, day, hh, mm, ss);
  return dt ? dt.toISOString() : s;
}

function mapCategory(
  raw: string,
  categoryMap: Record<string, ExpenseCategory> | undefined,
  defaultCategory: ExpenseCategory | undefined
): { value: string; unmapped?: string } {
  const word = raw.trim();
  if (!word) return { value: defaultCategory ?? '' };
  const lc = word.toLowerCase();
  if ((EXPENSE_CATEGORIES as readonly string[]).includes(lc)) return { value: lc };
  const mapped = categoryMap?.[lc] ?? categoryMap?.[word];
  if (mapped) return { value: mapped };
  return { value: 'misc', unmapped: word };
}

// Non-numeric input is passed through verbatim so buildImportPlan reports the offending text.
export function mapVolume(
  raw: string,
  from: VolumeUnit | null | undefined,
  to: VolumeUnit | undefined
): string {
  const s = normalizeDecimal(raw);
  if (!s) return '';
  const n = Number(s);
  if (!Number.isFinite(n)) return raw; // let buildImportPlan error it
  if (!from || !to) return String(n);
  return String(Number(convertVolume(n, from, to).toFixed(3)));
}

// Rounded to a whole number because the native mileage parser requires one.
export function mapMileage(
  raw: string,
  from: DistanceUnit | null | undefined,
  to: DistanceUnit | undefined
): string {
  const s = normalizeDecimal(raw);
  if (!s) return '';
  const n = Number(s);
  if (!Number.isFinite(n)) return raw; // let buildImportPlan error it
  const dist = from && to ? convertDistance(n, from, to) : n;
  return String(Math.round(dist));
}

export function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function stringifyNative(rows: Record<NativeField, string>[]): string {
  const lines = [NATIVE_HEADER.join(',')];
  for (const row of rows) {
    lines.push(NATIVE_HEADER.map((h) => csvCell(row[h] ?? '')).join(','));
  }
  return lines.join('\n');
}

// Throws CsvMappingError only for an unparseable file.
export function applyMapping(
  foreignCsv: string,
  mapping: ColumnMapping,
  target: TargetUnits = {}
): ApplyMappingResult {
  let records: Record<string, string>[];
  try {
    records = parse(foreignCsv, {
      bom: true,
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });
  } catch (err) {
    throw new CsvMappingError(
      `Could not parse the file: ${err instanceof Error ? err.message : 'unknown error'}`
    );
  }

  const cols = mapping.columns;
  const read = (rec: Record<string, string>, field: NativeField): string => {
    const header = cols[field];
    return header ? (rec[header] ?? '') : '';
  };

  const unmapped = new Set<string>();
  const outRows = records.map((rec) => {
    const category = mapCategory(
      read(rec, 'category'),
      mapping.categoryMap,
      mapping.defaultCategory
    );
    if (category.unmapped) unmapped.add(category.unmapped);
    return {
      date: normalizeForeignDate(read(rec, 'date'), mapping.dateFormat),
      vehicle: cols.vehicle ? read(rec, 'vehicle') : (mapping.targetVehicle ?? ''),
      category: category.value,
      amount: normalizeDecimal(read(rec, 'amount')),
      mileage: mapMileage(read(rec, 'mileage'), mapping.distanceUnit, target.distanceUnit),
      volume: mapVolume(read(rec, 'volume'), mapping.volumeUnit, target.volumeUnit),
      fuelType: read(rec, 'fuelType'),
      description: read(rec, 'description'),
      tags: read(rec, 'tags'),
      missedFillup: read(rec, 'missedFillup'),
    } satisfies Record<NativeField, string>;
  });

  return { csv: stringifyNative(outRows), unmappedCategories: [...unmapped].sort() };
}
