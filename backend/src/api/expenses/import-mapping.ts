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
  defaultCategory?: ExpenseCategory;
}

const mappedHeader = z.string().min(1).max(200).optional();

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

export interface TargetUnits {
  distanceUnit?: DistanceUnit;
  volumeUnit?: VolumeUnit;
}

export interface ApplyMappingResult {
  csv: string;
  unmappedCategories: string[];
  rowErrors: Map<number, string>;
}

export type TargetUnitsResolver = (vehicle: string) => TargetUnits;

export class CsvMappingError extends Error {}

const NATIVE_HEADER: NativeField[] = [
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

export type DecimalSeparator = '.' | ',';

type NumberShape =
  | { kind: 'plain' }
  | { kind: 'decimal'; sep: DecimalSeparator }
  | { kind: 'grouped'; sep: DecimalSeparator }
  | { kind: 'ambiguous'; sep: DecimalSeparator }
  | { kind: 'invalid' };

const SPACE_GROUPED = /^-?\d{1,3}(?:[ \u00a0\u202f']\d{3})+(?:[.,]\d+)?$/;
const MIXED = /^-?\d{1,3}([.,])\d{3}(?:\1\d{3})*([.,])\d+$/;
const MULTI_GROUPED = /^-?\d{1,3}([.,])\d{3}(?:\1\d{3})+$/;
const SINGLE_THOUSANDS = /^-?[1-9]\d{0,2}([.,])\d{3}$/;
const SINGLE_DECIMAL = /^-?\d*([.,])\d+$/;

const otherSeparator = (sep: DecimalSeparator): DecimalSeparator => (sep === '.' ? ',' : '.');

function stripSpaceGrouping(raw: string): string {
  const s = raw.trim();
  return SPACE_GROUPED.test(s) ? s.replace(/[ \u00a0\u202f']/g, '') : s;
}

function shapeOf(s: string): NumberShape {
  if (/^-?\d+$/.test(s)) return { kind: 'plain' };
  const multi = MULTI_GROUPED.exec(s);
  if (multi) return { kind: 'grouped', sep: multi[1] as DecimalSeparator };
  const mixed = MIXED.exec(s);
  if (mixed) {
    return mixed[1] === mixed[2]
      ? { kind: 'invalid' }
      : { kind: 'decimal', sep: mixed[2] as DecimalSeparator };
  }
  const thousands = SINGLE_THOUSANDS.exec(s);
  if (thousands) return { kind: 'ambiguous', sep: thousands[1] as DecimalSeparator };
  const decimal = SINGLE_DECIMAL.exec(s);
  if (decimal) return { kind: 'decimal', sep: decimal[1] as DecimalSeparator };
  return { kind: 'invalid' };
}

function decimalEvidence(raw: string): DecimalSeparator | undefined {
  const shape = shapeOf(stripSpaceGrouping(raw));
  if (shape.kind === 'decimal') return shape.sep;
  if (shape.kind === 'grouped') return otherSeparator(shape.sep);
  return undefined;
}

export function inferDecimalSeparator(values: string[]): DecimalSeparator | undefined {
  const seen = new Set<DecimalSeparator>();
  for (const v of values) {
    const sep = decimalEvidence(v);
    if (sep) seen.add(sep);
  }
  return seen.size === 1 ? [...seen][0] : undefined;
}

export function isAmbiguousNumber(raw: string): boolean {
  return shapeOf(stripSpaceGrouping(raw)).kind === 'ambiguous';
}

export function normalizeDecimal(raw: string, decimal: DecimalSeparator = '.'): string {
  const s = stripSpaceGrouping(raw);
  const shape = shapeOf(s);
  if (shape.kind === 'plain' || shape.kind === 'invalid') return s;
  const decimalSep =
    shape.kind === 'decimal'
      ? shape.sep
      : shape.kind === 'grouped'
        ? otherSeparator(shape.sep)
        : decimal;
  return s.split(otherSeparator(decimalSep)).join('').replace(decimalSep, '.');
}

function epochToIso(n: number): string | null {
  if (!Number.isFinite(n)) return null;
  const ms = Math.abs(n) >= 1e12 ? n : n * 1000;
  const dt = new Date(ms);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

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

  // new Date("YYYY-MM-DD") would shift the day; buildLocalDate keeps the calendar day.
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

export function mapVolume(
  raw: string,
  from: VolumeUnit | null | undefined,
  to: VolumeUnit | undefined,
  decimal: DecimalSeparator = '.'
): string {
  const s = normalizeDecimal(raw, decimal);
  if (!s) return '';
  const n = Number(s);
  if (!Number.isFinite(n)) return raw;
  if (!from || !to) return String(n);
  return String(Number(convertVolume(n, from, to).toFixed(3)));
}

export function mapMileage(
  raw: string,
  from: DistanceUnit | null | undefined,
  to: DistanceUnit | undefined,
  decimal: DecimalSeparator = '.'
): string {
  const s = normalizeDecimal(raw, decimal);
  if (!s) return '';
  const n = Number(s);
  if (!Number.isFinite(n)) return raw;
  const dist = from && to ? convertDistance(n, from, to) : n;
  return String(Math.round(dist));
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function stringifyNative(rows: Record<NativeField, string>[]): string {
  const lines = [NATIVE_HEADER.join(',')];
  for (const row of rows) {
    lines.push(NATIVE_HEADER.map((h) => csvCell(row[h] ?? '')).join(','));
  }
  return lines.join('\n');
}

const NUMERIC_FIELDS = [
  { field: 'amount', label: 'Amount' },
  { field: 'mileage', label: 'Odometer' },
  { field: 'volume', label: 'Volume' },
] as const satisfies { field: NativeField; label: string }[];

type NumericField = (typeof NUMERIC_FIELDS)[number]['field'];

function columnDecimals(
  records: Record<string, string>[],
  read: (rec: Record<string, string>, field: NativeField) => string
): Record<NumericField, DecimalSeparator | undefined> {
  const values = (field: NumericField) => records.map((rec) => read(rec, field));
  const fileDecimal = inferDecimalSeparator(NUMERIC_FIELDS.flatMap(({ field }) => values(field)));
  const decimals = {} as Record<NumericField, DecimalSeparator | undefined>;
  for (const { field } of NUMERIC_FIELDS) {
    const hasOwnEvidence = values(field).some((v) => decimalEvidence(v));
    decimals[field] = hasOwnEvidence ? inferDecimalSeparator(values(field)) : fileDecimal;
  }
  return decimals;
}

function ambiguityMessage(label: string, raw: string): string {
  const s = stripSpaceGrouping(raw);
  const readings = (['.', ','] as const).map((sep) => Number(normalizeDecimal(s, sep)));
  return `${label} "${s}" could mean ${readings.join(' or ')}. Write it without the thousands separator, or with decimals, so it reads one way.`;
}

export function applyMapping(
  foreignCsv: string,
  mapping: ColumnMapping,
  targetUnitsFor: TargetUnitsResolver = () => ({})
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

  const decimals = columnDecimals(records, read);
  const unmapped = new Set<string>();
  const rowErrors = new Map<number, string>();
  const outRows = records.map((rec, i) => {
    const category = mapCategory(
      read(rec, 'category'),
      mapping.categoryMap,
      mapping.defaultCategory
    );
    if (category.unmapped) unmapped.add(category.unmapped);
    const ambiguous = NUMERIC_FIELDS.find(
      ({ field }) => !decimals[field] && isAmbiguousNumber(read(rec, field))
    );
    if (ambiguous) rowErrors.set(i, ambiguityMessage(ambiguous.label, read(rec, ambiguous.field)));
    const vehicle = cols.vehicle ? read(rec, 'vehicle') : (mapping.targetVehicle ?? '');
    const target = targetUnitsFor(vehicle);
    return {
      date: normalizeForeignDate(read(rec, 'date'), mapping.dateFormat),
      vehicle,
      category: category.value,
      amount: normalizeDecimal(read(rec, 'amount'), decimals.amount),
      mileage: mapMileage(
        read(rec, 'mileage'),
        mapping.distanceUnit,
        target.distanceUnit,
        decimals.mileage
      ),
      volume: mapVolume(
        read(rec, 'volume'),
        mapping.volumeUnit,
        target.volumeUnit,
        decimals.volume
      ),
      fuelType: read(rec, 'fuelType'),
      description: read(rec, 'description'),
      tags: read(rec, 'tags'),
      missedFillup: read(rec, 'missedFillup'),
    } satisfies Record<NativeField, string>;
  });

  return { csv: stringifyNative(outRows), unmappedCategories: [...unmapped].sort(), rowErrors };
}
