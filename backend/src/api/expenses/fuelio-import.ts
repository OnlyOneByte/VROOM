/**
 * Converts a Fuelio multi-section backup export into VROOM's native CSV, which then goes through
 * the normal import plan. Pure: no DB access.
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

export class FuelioParseError extends Error {}

export interface FuelioParseResult {
  csv: string;
  /** Suggestion only; the import target is chosen by the user. */
  fileVehicleName: string | null;
  fileDistanceUnit: DistanceUnit | null;
  fileVolumeUnit: VolumeUnit | null;
  logCount: number;
  costCount: number;
  unmappedCategories: string[];
}

export interface FuelioParseOptions {
  targetVehicle: string;
  targetUnits: TargetUnits;
  includeCosts?: boolean;
}

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

type NativeRow = Record<NativeField, string>;

export function isFuelioExport(text: string): boolean {
  return /^\s*"?##\s*Vehicle"?/im.test(text) && /^\s*"?##\s*Log"?/im.test(text);
}

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

// Headers carry unit suffixes and "(optional)" markers, so columns are matched by pattern.
function findKey(record: Record<string, string> | undefined, re: RegExp): string | undefined {
  return record ? Object.keys(record).find((k) => re.test(k)) : undefined;
}

function cell(rec: Record<string, string>, key: string | undefined): string {
  return key ? (rec[key] ?? '') : '';
}

function detectDistanceUnit(odoKey: string | undefined): DistanceUnit | null {
  if (!odoKey) return null;
  if (/\bmi\b|mile/i.test(odoKey)) return DistanceUnit.MILES;
  if (/\bkm\b|kilomet/i.test(odoKey)) return DistanceUnit.KILOMETERS;
  return null;
}

function detectVolumeUnit(fuelKey: string | undefined): VolumeUnit | null {
  if (!fuelKey) return null;
  if (/us\s*gallon/i.test(fuelKey)) return VolumeUnit.GALLONS_US;
  if (/uk\s*gallon|imp/i.test(fuelKey)) return VolumeUnit.GALLONS_UK;
  if (/gallon/i.test(fuelKey)) return VolumeUnit.GALLONS_US;
  if (/litre|liter/i.test(fuelKey)) return VolumeUnit.LITERS;
  return null;
}

function resolveDateFormat(fmt: string | undefined): ImportDateFormat {
  const f = (fmt ?? '').toLowerCase().trim();
  if (f.startsWith('y')) return 'iso';
  const di = f.indexOf('d');
  const mi = f.indexOf('m');
  if (di !== -1 && mi !== -1) return di < mi ? 'dmy' : 'mdy';
  return 'iso';
}

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
    // Fuelio's numeric FuelType code has no reliable VROOM string mapping.
    fuelType: '',
    description: cell(rec, notesKey),
    tags: '',
    missedFillup: cell(rec, missedKey).trim() === '1' ? 'true' : '',
  }));
  return { rows, fileDistanceUnit, fileVolumeUnit };
}

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
    const typeId = cell(rec, cTypeKey).trim();
    const catName = catById.get(typeId) ?? '';
    const mapped = FUELIO_COST_CATEGORY_MAP[catName.toLowerCase()];
    // Unresolvable type ids are surfaced rather than silently mapped to misc.
    const label = catName || (typeId ? `Unknown category ${typeId}` : '');
    if (!mapped && label) unmapped.add(label);
    const title = cell(rec, cTitleKey).trim();
    const note = cell(rec, cNotesKey).trim();
    return {
      date: normalizeForeignDate(cell(rec, cDateKey), dateFormat),
      vehicle: opts.targetVehicle,
      category: mapped ?? 'misc',
      amount: normalizeDecimal(cell(rec, cCostKey)),
      mileage: '',
      volume: '',
      fuelType: '',
      description: [title, note].filter(Boolean).join(' — ') || label,
      tags: '',
      missedFillup: '',
    };
  });
  return { rows, unmapped };
}

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
