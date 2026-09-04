/**
 * Fuelio multi-section import adapter (data-migration spec, "Migrate from other tracker").
 *
 * Fuelio's backup export is NOT a flat CSV — it is a single file of quoted sections, each a
 * marker line (`"## Vehicle"`, `"## Log"`, `"## CostCategories"`, `"## Costs"`) followed by its
 * own header row + data rows, sections separated by blank lines. The generic `applyMapping`
 * pre-pass (single-header `csv-parse`) cannot read it, so this adapter splits the sections and
 * emits VROOM's OWN native CSV directly. That native CSV is then handed to `buildImportPlan`
 * unchanged, so every downstream guarantee — per-row validation, cross-tenant-safe vehicle
 * resolution, `deriveImportClientId` idempotent re-import, atomic commit — is inherited for free.
 *
 * Pure (no DB, no Hono): Fuelio text + the resolved target vehicle/units in, native CSV text out.
 *
 * Fuelio specifics handled (per the format research):
 *  - Units are embedded in the LOG header names (`Odo (mi)`/`Odo (km)`, `Fuel (us gallons)`/
 *    `Fuel (litres)`) and are per-vehicle — read from the header, convert into the target
 *    vehicle's units (never assume metric).
 *  - Columns keyed by header NAME (regex), not fixed index, so version drift / trailing
 *    `(optional)` suffixes / extra columns don't break parsing.
 *  - `Missed=1` → VROOM `missedFillup` (a prior fill-up was skipped). Fuelio's separate `Full`
 *    (partial-tank) flag has no VROOM equivalent and is intentionally not mapped.
 *  - The `## Costs` section (non-fuel expenses) is migrated too, its Fuelio cost category mapped
 *    to a VROOM category; an unrecognized one falls to `misc` and is surfaced (never a silent guess).
 *  - Fuelio has NO currency column — amounts import as-is in the user's configured currency.
 */

import { parse } from 'csv-parse/sync';
import type { ExpenseCategory } from '../../db/types';
import { DistanceUnit, VolumeUnit } from '../../types';
import {
  type ImportDateFormat,
  mapMileage,
  mapVolume,
  type NativeField,
  normalizeDecimal,
  normalizeForeignDate,
  stringifyNative,
  type TargetUnits,
} from './import-mapping';

/** Raised for whole-file problems (no recognizable Fuelio sections). Per-row issues stay for buildImportPlan. */
export class FuelioParseError extends Error {}

export interface FuelioParseResult {
  /** Native-shape VROOM CSV, ready to hand to `buildImportPlan` verbatim. */
  csv: string;
  /** The vehicle name from the `## Vehicle` section (suggestion only; not used as the import target). */
  fileVehicleName: string | null;
  /** Units detected from the `## Log` header (what the file is in). */
  fileDistanceUnit: DistanceUnit | null;
  fileVolumeUnit: VolumeUnit | null;
  /** Count of fuel-log rows emitted. */
  logCount: number;
  /** Count of cost rows emitted (0 when includeCosts is false or no `## Costs` section). */
  costCount: number;
  /** Distinct Fuelio cost-category names that had no VROOM mapping and fell to `misc`. */
  unmappedCategories: string[];
}

export interface FuelioParseOptions {
  /** The OWNED vehicle name stamped on every row (buildImportPlan resolves it to an id). */
  targetVehicle: string;
  /** The target vehicle's units — file values are converted into these. */
  targetUnits: TargetUnits;
  /** Migrate the `## Costs` section too (non-fuel expenses). Default true. */
  includeCosts?: boolean;
}

/** Fuelio cost-category name (lower-cased) → VROOM category. Unmatched → `misc` + a surfaced note. */
const FUELIO_COST_CATEGORY_MAP: Record<string, ExpenseCategory> = {
  service: 'maintenance',
  maintenance: 'maintenance',
  repair: 'maintenance',
  repairs: 'maintenance',
  tires: 'maintenance',
  'oil change': 'maintenance',
  insurance: 'financial',
  loan: 'financial',
  finance: 'financial',
  registration: 'regulatory',
  inspection: 'regulatory',
  tax: 'regulatory',
  fine: 'regulatory',
  fines: 'regulatory',
  accessories: 'enhancement',
  accessory: 'enhancement',
  tuning: 'enhancement',
  detailing: 'enhancement',
  parking: 'misc',
  toll: 'misc',
  tolls: 'misc',
  wash: 'misc',
  'car wash': 'misc',
};

/** The native columns buildImportPlan reads (order is irrelevant — it parses by header name). */
type NativeRow = Record<NativeField, string>;

/** True when the text looks like a Fuelio backup export (has the `## Vehicle` + `## Log` markers). */
export function isFuelioExport(text: string): boolean {
  return /^\s*"?##\s*Vehicle"?/im.test(text) && /^\s*"?##\s*Log"?/im.test(text);
}

/**
 * Split a Fuelio file into its sections. Returns each section's CSV block text (its own header +
 * data rows), keyed by the lower-cased marker word (`vehicle`, `log`, `costcategories`, `costs`).
 * Blank lines between sections are dropped; a section with no marker is ignored.
 */
function splitSections(text: string): Record<string, string> {
  const blocks: Record<string, string[]> = {};
  let current: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const marker = /^\s*"?##\s*([A-Za-z]+)"?,*\s*$/.exec(line);
    if (marker?.[1]) {
      current = marker[1].toLowerCase();
      blocks[current] = [];
      continue;
    }
    if (current && line.trim() !== '') blocks[current]?.push(line);
  }
  return Object.fromEntries(Object.entries(blocks).map(([k, v]) => [k, v.join('\n')]));
}

/** Parse one section block (header + rows) into records keyed by its header names. */
function parseBlock(block: string | undefined): Record<string, string>[] {
  if (!block?.trim()) return [];
  return parse(block, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, string>[];
}

/** Find the record key whose name matches `re` (headers carry unit suffixes / `(optional)`). */
function findKey(record: Record<string, string> | undefined, re: RegExp): string | undefined {
  return record ? Object.keys(record).find((k) => re.test(k)) : undefined;
}

/** Read a cell by a resolved header key; an unresolved (absent) column reads as empty. */
function cell(rec: Record<string, string>, key: string | undefined): string {
  return key ? (rec[key] ?? '') : '';
}

/** Detect the file's distance unit from the LOG odometer header (`Odo (mi)` / `Odo (km)`). */
function detectDistanceUnit(odoKey: string | undefined): DistanceUnit | null {
  if (!odoKey) return null;
  if (/\bmi\b|mile/i.test(odoKey)) return DistanceUnit.MILES;
  if (/\bkm\b|kilomet/i.test(odoKey)) return DistanceUnit.KILOMETERS;
  return null;
}

/** Detect the file's volume unit from the LOG fuel header (`Fuel (us gallons)` / `Fuel (litres)`). */
function detectVolumeUnit(fuelKey: string | undefined): VolumeUnit | null {
  if (!fuelKey) return null;
  if (/us\s*gallon/i.test(fuelKey)) return VolumeUnit.GALLONS_US;
  if (/uk\s*gallon|imp/i.test(fuelKey)) return VolumeUnit.GALLONS_UK;
  if (/gallon/i.test(fuelKey)) return VolumeUnit.GALLONS_US;
  if (/litre|liter/i.test(fuelKey)) return VolumeUnit.LITERS;
  return null;
}

/** Map the `## Vehicle` ImportCSVDateFormat to our foreign-date format enum (default iso). */
function resolveDateFormat(fmt: string | undefined): ImportDateFormat {
  const f = (fmt ?? '').toLowerCase().trim();
  if (f.startsWith('y')) return 'iso'; // yyyy-MM-dd (Fuelio's default) and any year-first form
  const di = f.indexOf('d');
  const mi = f.indexOf('m');
  if (di !== -1 && mi !== -1) return di < mi ? 'dmy' : 'mdy';
  return 'iso'; // unrecognized → iso (parseDate still validates the actual value)
}

/**
 * Emit one native fuel row per `## Log` record. Also returns the units detected from the log
 * header, since the caller reports them and they drive the conversion here.
 */
function buildLogRows(
  logRecords: Record<string, string>[],
  opts: FuelioParseOptions,
  dateFormat: ImportDateFormat
): { rows: NativeRow[]; fileDistanceUnit: DistanceUnit | null; fileVolumeUnit: VolumeUnit | null } {
  const first = logRecords[0];
  const odoKey = findKey(first, /odo/i);
  const fuelKey = findKey(first, /^fuel\b/i);
  const dateKey = findKey(first, /^data$|^date$/i);
  const priceKey = findKey(first, /^price/i); // "Price (optional)" = TOTAL price
  const notesKey = findKey(first, /note/i);
  const missedKey = findKey(first, /missed/i);
  const fileDistanceUnit = detectDistanceUnit(odoKey);
  const fileVolumeUnit = detectVolumeUnit(fuelKey);

  const rows = logRecords.map((rec) => ({
    date: normalizeForeignDate(cell(rec, dateKey), dateFormat),
    vehicle: opts.targetVehicle,
    category: 'fuel',
    amount: normalizeDecimal(cell(rec, priceKey)),
    mileage: mapMileage(cell(rec, odoKey), fileDistanceUnit, opts.targetUnits.distanceUnit),
    volume: mapVolume(cell(rec, fuelKey), fileVolumeUnit, opts.targetUnits.volumeUnit),
    fuelType: '', // Fuelio's numeric FuelType code has no reliable VROOM string mapping (v1: blank).
    description: cell(rec, notesKey),
    tags: '',
    missedFillup: cell(rec, missedKey).trim() === '1' ? 'true' : '',
  }));
  return { rows, fileDistanceUnit, fileVolumeUnit };
}

/**
 * Emit one native row per `## Costs` record, resolving CostTypeID → the `## CostCategories` name →
 * a VROOM category. Names with no mapping fall to `misc` and are surfaced in `unmapped`.
 */
function buildCostRows(
  sections: Record<string, string>,
  opts: FuelioParseOptions,
  dateFormat: ImportDateFormat
): { rows: NativeRow[]; unmapped: Set<string> } {
  const catById = new Map<string, string>();
  for (const cat of parseBlock(sections.costcategories)) {
    const idKey = findKey(cat, /costtypeid|^id$/i);
    const nmKey = findKey(cat, /^name$/i);
    if (idKey && nmKey && cat[idKey]) catById.set(cat[idKey].trim(), (cat[nmKey] ?? '').trim());
  }

  const costRecords = parseBlock(sections.costs);
  const cFirst = costRecords[0];
  const cDateKey = findKey(cFirst, /^date$/i);
  const cTitleKey = findKey(cFirst, /^costtitle$|^title$/i);
  const cTypeKey = findKey(cFirst, /costtypeid/i);
  const cCostKey = findKey(cFirst, /^cost$|^amount$/i);
  const cNotesKey = findKey(cFirst, /note/i);

  const unmapped = new Set<string>();
  const rows = costRecords.map((rec) => {
    const catName = catById.get(cell(rec, cTypeKey).trim()) ?? '';
    const mapped = FUELIO_COST_CATEGORY_MAP[catName.toLowerCase()];
    if (!mapped && catName) unmapped.add(catName);
    const title = cell(rec, cTitleKey).trim();
    const note = cell(rec, cNotesKey).trim();
    return {
      date: normalizeForeignDate(cell(rec, cDateKey), dateFormat),
      vehicle: opts.targetVehicle,
      category: mapped ?? 'misc',
      amount: normalizeDecimal(cell(rec, cCostKey)),
      mileage: '', // non-fuel: cleared by the native import anyway
      volume: '',
      fuelType: '',
      description: [title, note].filter(Boolean).join(' — ') || catName,
      tags: '',
      missedFillup: '',
    };
  });
  return { rows, unmapped };
}

/**
 * Translate a Fuelio backup export into VROOM's native CSV. Throws `FuelioParseError` only when the
 * file has no recognizable Fuelio sections; per-row problems are deferred to `buildImportPlan`.
 */
export function parseFuelioExport(text: string, opts: FuelioParseOptions): FuelioParseResult {
  if (!isFuelioExport(text)) {
    throw new FuelioParseError(
      'This does not look like a Fuelio export (no "## Vehicle"/"## Log" sections).'
    );
  }
  const includeCosts = opts.includeCosts ?? true;
  const sections = splitSections(text);

  const vehicleRec = parseBlock(sections.vehicle)[0];
  const nameKey = findKey(vehicleRec, /^name$/i);
  const fileVehicleName = (nameKey && vehicleRec?.[nameKey]?.trim()) || null;
  const dateFmtKey = findKey(vehicleRec, /importcsvdateformat|dateformat/i);
  const dateFormat = resolveDateFormat(dateFmtKey ? vehicleRec?.[dateFmtKey] : undefined);

  const log = buildLogRows(parseBlock(sections.log), opts, dateFormat);
  const costs = includeCosts
    ? buildCostRows(sections, opts, dateFormat)
    : { rows: [] as NativeRow[], unmapped: new Set<string>() };
  const rows = [...log.rows, ...costs.rows];
  const logCount = log.rows.length;
  const costCount = costs.rows.length;
  const unmapped = costs.unmapped;
  const fileDistanceUnit = log.fileDistanceUnit;
  const fileVolumeUnit = log.fileVolumeUnit;

  const csv = stringifyNative(rows);

  return {
    csv,
    fileVehicleName,
    fileDistanceUnit,
    fileVolumeUnit,
    logCount,
    costCount,
    unmappedCategories: [...unmapped].sort(),
  };
}
