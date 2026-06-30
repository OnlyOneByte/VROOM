/**
 * Import-from-other-trackers: the header+value translation PRE-PASS (spec
 * `import-trackers` T1). A foreign CSV (Fuelly / Fuelio / Drivvo / …) plus a
 * `ColumnMapping` is turned into a CSV in VROOM's OWN native shape, which the
 * EXISTING `buildImportPlan` then validates/previews/commits unchanged. So every
 * downstream guarantee — per-row validation, formula-injection denormalize,
 * cross-tenant-safe vehicle resolution, idempotent re-import, atomic commit — is
 * inherited for free (see `import-csv.ts`). This module is PURE (no DB, no Hono):
 * raw text + a mapping in, native CSV text out, so the whole translation contract
 * is unit-testable without a server.
 *
 * The native target columns are exactly the subset `parseRow` reads:
 *   date,vehicle,category,amount,mileage,volume,fuelType,description,tags,missedFillup
 */

import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { EXPENSE_CATEGORIES, type ExpenseCategory } from '../../db/types';
import { DistanceUnit, VolumeUnit } from '../../types';
import { convertDistance, convertVolume } from '../../utils/unit-conversions';
import { buildLocalDate } from './local-date';

/** A native VROOM column a foreign header can be mapped onto. */
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

/** How the foreign file encodes dates (D3). `epoch` accepts unix seconds or millis. */
export type ImportDateFormat = 'iso' | 'mdy' | 'dmy' | 'epoch';

/**
 * Instructions for translating ONE foreign file into VROOM's native shape. Built by
 * the client (auto-filled from a preset in T2, or hand-mapped). All transforms are
 * declarative — the route (T3) just hands this to `applyMapping`.
 */
export interface ColumnMapping {
  /** Preset id this came from ('fuelly' | 'fuelio' | 'drivvo'), or undefined for manual. */
  source?: string;
  /** VROOM field → the foreign header that supplies it. Unmapped fields stay blank. */
  columns: Partial<Record<NativeField, string>>;
  /** Vehicle name to stamp on every row when the file has no vehicle column (D4). */
  targetVehicle?: string;
  /** Date encoding in the file (D3). */
  dateFormat: ImportDateFormat;
  /** The FILE's distance unit (D1). Conversion needs both this and the target's unit. */
  distanceUnit?: DistanceUnit;
  /** The FILE's volume unit (D1). */
  volumeUnit?: VolumeUnit;
  /** Foreign category word (lower-cased) → VROOM enum (D2). Unmatched → `misc` + a note. */
  categoryMap?: Record<string, ExpenseCategory>;
  /**
   * Category to stamp on a row whose category cell is BLANK (no category column mapped, or an empty
   * cell). Fuel-tracker exports (Fuelly/Fuelio/Drivvo) have no category column — they're definitionally
   * all fuel — so their presets set this to `fuel`, turning an otherwise-0-ready detected log into ready
   * fuel rows. Only the EMPTY cell is filled; a NAMED-but-unrecognized word still falls back to `misc`
   * with a note (the D2/C47 remap path is unchanged).
   */
  defaultCategory?: ExpenseCategory;
}

// A foreign header name mapped onto a native field: bounded, non-empty when present.
const mappedHeader = z.string().min(1).max(200).optional();

/**
 * Zod validator for a `ColumnMapping` arriving on the import route (T3). Bounds every field so a
 * client can't smuggle oversized/garbage values past the translation pre-pass: column header names
 * are length-capped, the date format + units are enums, and category-map VALUES must be real
 * `ExpenseCategory`s (an unknown value would otherwise reach `applyMapping` and be emitted verbatim,
 * then rejected per-row — bounding here gives a clean 400 instead). Keys (foreign words) are free text.
 *
 * `columns` is spelled out field-by-field as OPTIONAL (not `z.record(z.enum(...))`, which Zod treats
 * as exhaustive and would reject a partial mapping) — matching `Partial<Record<NativeField,string>>`.
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

/**
 * The destination vehicle's units — mapped values are converted INTO these (D1), since
 * VROOM stores each expense in its vehicle's own unit (no canonical storage unit; see
 * `unit-conversions.ts`). Omit a unit (or pass nothing) to skip that conversion — values
 * then pass through unchanged. The route (T3) supplies the resolved target vehicle's units.
 */
export interface TargetUnits {
  distanceUnit?: DistanceUnit;
  volumeUnit?: VolumeUnit;
}

export interface ApplyMappingResult {
  /** Native-shape CSV text, ready to hand to `buildImportPlan` verbatim. */
  csv: string;
  /**
   * Distinct foreign category words that had no mapping and were bucketed to `misc`
   * (D2's "unmapped → misc + a VISIBLE note, never a silent guess"). The route surfaces
   * these so the user knows which values to remap.
   */
  unmappedCategories: string[];
}

/** Raised for whole-file problems (unparseable). Per-value issues are left for `buildImportPlan`. */
export class CsvMappingError extends Error {}

/** Native output column order (the subset `parseRow` consumes). */
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

/**
 * Normalize a numeric string with thousands/decimal separators to a dot-decimal. When BOTH `.` and `,`
 * appear, the LAST-occurring one is the decimal separator and the other is thousands — this is
 * unambiguous and handles BOTH conventions: `1.234,56` (EU: comma last → decimal) → `1234.56` AND
 * `1,234.56` (US: dot last → decimal) → `1234.56` (#124, C417 — the old code hard-assumed comma-decimal,
 * so a US-format value with both separators stripped its dots → `1.23456`, a ~1000x money under-count
 * reachable via the US Fuelly preset). A lone `,` is treated as the decimal separator (the decimal-comma
 * decision; lone-comma-as-THOUSANDS is the ambiguous #24 locale/product call, NOT decided here). A value
 * with neither, or only dots, is returned unchanged.
 */
function normalizeDecimal(raw: string): string {
  const s = raw.trim();
  if (!s) return s;
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  if (hasDot && hasComma) {
    // The decimal separator is whichever appears LAST; strip the other (thousands) entirely.
    const commaIsDecimal = s.lastIndexOf(',') > s.lastIndexOf('.');
    return commaIsDecimal ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  }
  if (hasComma) return s.replace(',', '.');
  return s;
}

/** A unix epoch (seconds, or millis when |n| ≥ 1e12) → ISO, or null if not finite/valid. */
function epochToIso(n: number): string | null {
  if (!Number.isFinite(n)) return null;
  const ms = Math.abs(n) >= 1e12 ? n : n * 1000;
  const dt = new Date(ms);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

/**
 * Normalize a foreign date string to an ISO instant per `format`, built in LOCAL time.
 * Returns the raw string unchanged when it can't be parsed, so `buildImportPlan`'s own
 * `parseDate` reports a normal per-row "Invalid date" rather than this throwing.
 *
 * The local-time construction is mandatory (cycle-6/11 discipline): handing a date-only
 * string to `new Date('YYYY-MM-DD')` parses it as UTC midnight, which rolls the calendar
 * day BACK for every user west of UTC. Building the Date from numeric parts keeps the
 * user's intended day. An ISO value that already carries an explicit timezone (Z or
 * ±hh:mm) is an absolute instant and is honored as-is.
 */
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
  else [year, month, day] = nums; // iso (no timezone)
  if (year < 100) year += 2000;

  const [hh = 0, mm = 0, ss = 0] = timePart.split(':').map((t) => Number.parseInt(t, 10) || 0);

  const dt = buildLocalDate(year, month, day, hh, mm, ss);
  return dt ? dt.toISOString() : s;
}

/** Map a foreign category word to a VROOM enum (D2). Returns the fallback word when it misses. */
function mapCategory(
  raw: string,
  categoryMap: Record<string, ExpenseCategory> | undefined,
  defaultCategory: ExpenseCategory | undefined
): { value: string; unmapped?: string } {
  const word = raw.trim();
  // A blank category cell: use the mapping's defaultCategory when set (fuel-tracker presets set
  // `fuel` — those exports have no category column but are definitionally all fuel), else stay
  // blank → buildImportPlan reports "Unknown category". We still never invent a category for a
  // NAMED-but-unrecognized word (those fall back to misc below), only fill a truly empty cell.
  if (!word) return { value: defaultCategory ?? '' };
  const lc = word.toLowerCase();
  if ((EXPENSE_CATEGORIES as readonly string[]).includes(lc)) return { value: lc };
  const mapped = categoryMap?.[lc] ?? categoryMap?.[word];
  if (mapped) return { value: mapped };
  return { value: 'misc', unmapped: word };
}

/** Decimal-normalize then convert a volume into the target's unit (when both units are known). */
function mapVolume(raw: string, from: VolumeUnit | undefined, to: VolumeUnit | undefined): string {
  const s = normalizeDecimal(raw);
  if (!s) return '';
  const n = Number(s);
  if (!Number.isFinite(n)) return raw; // let buildImportPlan error it
  if (!from || !to) return String(n);
  return String(Number(convertVolume(n, from, to).toFixed(3)));
}

/**
 * Decimal-normalize then convert a mileage into the target's unit, rounded to an integer
 * (native `parseMileage` requires a whole number; the rounding is the documented A1 loss).
 */
function mapMileage(
  raw: string,
  from: DistanceUnit | undefined,
  to: DistanceUnit | undefined
): string {
  const s = normalizeDecimal(raw);
  if (!s) return '';
  const n = Number(s);
  if (!Number.isFinite(n)) return raw; // let buildImportPlan error it
  const dist = from && to ? convertDistance(n, from, to) : n;
  return String(Math.round(dist));
}

/** RFC-4180 cell escaping: quote + double internal quotes when a cell holds `,` `"` or a newline. */
function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function stringifyNative(rows: Record<NativeField, string>[]): string {
  const lines = [NATIVE_HEADER.join(',')];
  for (const row of rows) {
    lines.push(NATIVE_HEADER.map((h) => csvCell(row[h] ?? '')).join(','));
  }
  return lines.join('\n');
}

/**
 * Translate a foreign CSV into VROOM's native CSV using `mapping`, converting units into
 * `target` (the destination vehicle's units). Pure: returns the native CSV text plus the
 * set of category words that fell back to `misc`. Throws `CsvMappingError` only when the
 * file itself is unparseable; every per-value problem is deferred to `buildImportPlan`.
 */
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
      // Inject the chosen target vehicle when the file has no vehicle column (D4).
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
