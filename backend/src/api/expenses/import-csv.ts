/**
 * Parses a VROOM CSV export and builds a per-row import plan. Vehicles are matched only against
 * the importing user's own garage. Pure: no DB access.
 */

import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { CONFIG } from '../../config';
import { EXPENSE_CATEGORIES, isElectricFuelType } from '../../db/types';
import { denormalizeCsvCell } from '../../utils/csv-safety';
import { dollarsToCents } from '../../utils/money';
import { buildLocalDate } from './local-date';

export interface ImportVehicle {
  id: string;
  make: string;
  model: string;
  year: number;
  nickname?: string | null;
}

export interface ImportableExpense {
  vehicleId: string;
  category: (typeof EXPENSE_CATEGORIES)[number];
  expenseAmount: number;
  date: Date;
  mileage: number | null;
  volume: number | null;
  fuelType: string | null;
  description: string | null;
  location: string | null;
  tags: string[];
  missedFillup: boolean;
  /** Deterministic key so re-importing the same file dedups via the (userId, clientId) unique index. */
  clientId: string;
}

export type ImportRowStatus = 'ready' | 'error';

export interface ImportRowResult {
  /** 1-based, counting the header as row 1. */
  row: number;
  status: ImportRowStatus;
  expense?: ImportableExpense;
  message?: string;
  raw?: { vehicle: string; category: string; amount: string; date: string };
}

export interface ImportPlan {
  rows: ImportRowResult[];
  readyCount: number;
  errorCount: number;
}

export class CsvImportError extends Error {}

const EXP = CONFIG.validation.expense;

type CellGetter = (key: string) => string;

function makeCellGetter(record: Record<string, string>): CellGetter {
  // Undoes the leading apostrophe the export adds to formula-like cells, so a VROOM CSV round-trips.
  // Only `'` followed by a trigger character is stripped, so a genuine leading apostrophe survives.
  return (k: string) => denormalizeCsvCell((record[k] ?? '').trim());
}

/** Returns integer cents. The import path bypasses the Zod money schemas, so it must convert here too. */
function parseAmount(raw: string): { value: number } | { error: string } {
  const amount = Number(raw);
  if (!raw || !Number.isFinite(amount) || amount <= 0) {
    return { error: `Invalid amount "${raw}"` };
  }
  if (amount > EXP.maxAmount) return { error: `Amount exceeds the ${EXP.maxAmount} maximum` };
  return { value: dollarsToCents(amount) };
}

function parseMileage(raw: string): { value: number | null } | { error: string } {
  if (!raw) return { value: null };
  const m = Number(raw);
  if (!Number.isInteger(m) || m < 0) return { error: `Invalid mileage "${raw}"` };
  return { value: m };
}

function parseVolume(raw: string): { value: number | null } | { error: string } {
  if (!raw) return { value: null };
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0) return { error: `Invalid volume "${raw}"` };
  return { value: v };
}

function parseCategory(
  raw: string
): { value: (typeof EXPENSE_CATEGORIES)[number] } | { error: string } {
  const category = raw.toLowerCase();
  if (!EXPENSE_CATEGORIES.includes(category as (typeof EXPENSE_CATEGORIES)[number])) {
    return { error: `Unknown category "${raw}"` };
  }
  return { value: category as (typeof EXPENSE_CATEGORIES)[number] };
}

function parseDate(raw: string): { value: Date } | { error: string } {
  if (!raw) return { error: `Invalid date "${raw}"` };
  // Date-only values are built in local time; `new Date('YYYY-MM-DD')` would shift the day west of UTC.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (dateOnly) {
    const date = buildLocalDate(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]));
    if (!date) return { error: `Invalid date "${raw}"` };
    return { value: date };
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return { error: `Invalid date "${raw}"` };
  return { value: date };
}

function parseBoundedString(
  raw: string,
  maxLength: number,
  label: string
): { value: string | null } | { error: string } {
  const value = raw || null;
  if (value && value.length > maxLength) {
    return { error: `${label} exceeds ${maxLength} characters` };
  }
  return { value };
}

function parseTags(raw: string): { value: string[] } | { error: string } {
  const tags = raw
    ? raw
        .split(/[;,]/)
        .map((t) => t.trim())
        .filter(Boolean)
    : [];
  if (tags.length > EXP.maxTags) return { error: `More than ${EXP.maxTags} tags` };
  for (const t of tags) {
    if (t.length > EXP.tagMaxLength)
      return { error: `Tag "${t}" exceeds ${EXP.tagMaxLength} chars` };
  }
  return { value: tags };
}

// `null` in the map marks a name shared by several vehicles, which must never resolve silently.
function resolveImportVehicleId(
  vehicleName: string,
  vehicleByName: Map<string, string | null>
): { vehicleId: string } | { error: string } {
  if (!vehicleName) return { error: 'Missing vehicle' };
  const match = vehicleByName.get(vehicleName.toLowerCase());
  if (match === null) {
    return {
      error: `"${vehicleName}" matches more than one vehicle in your garage; give them distinct nicknames and use those`,
    };
  }
  if (!match) return { error: `No vehicle named "${vehicleName}" in your garage` };
  return { vehicleId: match };
}

function parseRow(
  record: Record<string, string>,
  vehicleByName: Map<string, string | null>
): { expense: ImportableExpense } | { error: string } {
  const get = makeCellGetter(record);

  const vehicleResult = resolveImportVehicleId(get('vehicle'), vehicleByName);
  if ('error' in vehicleResult) return vehicleResult;
  const { vehicleId } = vehicleResult;

  const categoryResult = parseCategory(get('category'));
  if ('error' in categoryResult) return categoryResult;
  const amountResult = parseAmount(get('amount'));
  if ('error' in amountResult) return amountResult;
  const dateResult = parseDate(get('date'));
  if ('error' in dateResult) return dateResult;
  const mileageResult = parseMileage(get('mileage'));
  if ('error' in mileageResult) return mileageResult;
  const volumeResult = parseVolume(get('volume'));
  if ('error' in volumeResult) return volumeResult;
  const fuelTypeResult = parseBoundedString(get('fuelType'), EXP.fuelTypeMaxLength, 'Fuel type');
  if ('error' in fuelTypeResult) return fuelTypeResult;
  const descriptionResult = parseBoundedString(
    get('description'),
    EXP.descriptionMaxLength,
    'Description'
  );
  if ('error' in descriptionResult) return descriptionResult;
  const locationResult = parseBoundedString(get('location'), EXP.locationMaxLength, 'Location');
  if ('error' in locationResult) return locationResult;
  const tagsResult = parseTags(get('tags'));
  if ('error' in tagsResult) return tagsResult;

  const category = categoryResult.value;
  const mileage = mileageResult.value;
  const volume = volumeResult.value;
  const fuelType = fuelTypeResult.value;
  const missedFillup = /^(true|1|yes)$/i.test(get('missedFillup'));

  // Mirrors the create route so a bad row fails at preview rather than mid-commit.
  if (category === 'fuel' && (!volume || mileage === null)) {
    return {
      error: isElectricFuelType(fuelType)
        ? 'Charging rows require charge amount (kWh) and mileage'
        : 'Fuel rows require fuel amount and mileage',
    };
  }

  return {
    expense: clearImportedFuelFields({
      vehicleId,
      category,
      expenseAmount: amountResult.value,
      date: dateResult.value,
      mileage,
      volume,
      fuelType,
      description: descriptionResult.value,
      location: locationResult.value,
      tags: tagsResult.value,
      missedFillup,
      clientId: '',
    }),
  };
}

// Non-fuel rows must not keep an odometer reading, which would skew the current-odometer calculation.
function clearImportedFuelFields(expense: ImportableExpense): ImportableExpense {
  if (expense.category === 'fuel') return expense;
  return { ...expense, mileage: null, volume: null, fuelType: null, missedFillup: false };
}

// The occurrence index lets identical rows in one file both import, while re-importing the same file
// yields the same keys in the same order. The `csv:` prefix keeps them apart from offline client ids.
export function deriveImportClientId(expense: ImportableExpense, occurrence: number): string {
  const content = [
    expense.vehicleId,
    expense.category,
    expense.expenseAmount,
    expense.date.getTime(),
    expense.mileage ?? '',
    expense.volume ?? '',
    expense.fuelType ?? '',
    expense.description ?? '',
    expense.location ?? '',
    expense.tags.join(''),
    expense.missedFillup ? '1' : '0',
    occurrence,
  ].join(' ');
  return `csv:${createHash('sha256').update(content).digest('hex').slice(0, 32)}`;
}

export const importCsvSchema = z.object({
  csv: z.string().min(1, 'CSV content is required').max(5_000_000, 'CSV file is too large'),
  dryRun: z.boolean().optional().default(false),
});

export function buildImportPlan(csv: string, vehicles: ImportVehicle[]): ImportPlan {
  let records: Record<string, string>[];
  try {
    records = parse(csv, {
      bom: true,
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });
  } catch (err) {
    throw new CsvImportError(
      `Could not parse CSV: ${err instanceof Error ? err.message : 'unknown error'}`
    );
  }

  if (records.length === 0) {
    throw new CsvImportError('The CSV has a header but no data rows');
  }
  if (records.length > EXP.maxImportRows) {
    throw new CsvImportError(
      `Too many rows (${records.length}); the maximum is ${EXP.maxImportRows} per import`
    );
  }

  const vehicleByName = new Map<string, string | null>();
  const register = (key: string, id: string) => {
    vehicleByName.set(key, vehicleByName.has(key) ? null : id);
  };
  for (const v of vehicles) {
    if (v.nickname) register(v.nickname.toLowerCase(), v.id);
    register(`${v.year} ${v.make} ${v.model}`.toLowerCase(), v.id);
  }

  const occurrences = new Map<string, number>();

  const rows: ImportRowResult[] = records.map((record, i) => {
    const raw = {
      vehicle: denormalizeCsvCell((record.vehicle ?? '').trim()),
      category: denormalizeCsvCell((record.category ?? '').trim()),
      amount: denormalizeCsvCell((record.amount ?? '').trim()),
      date: denormalizeCsvCell((record.date ?? '').trim()),
    };
    const result = parseRow(record, vehicleByName);
    const rowNum = i + 2;
    if ('error' in result) {
      return { row: rowNum, status: 'error' as const, message: result.error, raw };
    }
    const baseKey = deriveImportClientId(result.expense, 0);
    const occurrence = occurrences.get(baseKey) ?? 0;
    occurrences.set(baseKey, occurrence + 1);
    result.expense.clientId = deriveImportClientId(result.expense, occurrence);
    return { row: rowNum, status: 'ready' as const, expense: result.expense, raw };
  });

  const readyCount = rows.filter((r) => r.status === 'ready').length;
  return { rows, readyCount, errorCount: rows.length - readyCount };
}

export function summarizeImportPlan(plan: ImportPlan) {
  return {
    readyCount: plan.readyCount,
    errorCount: plan.errorCount,
    totalRows: plan.rows.length,
    rows: plan.rows.map((r) => ({
      row: r.row,
      status: r.status,
      ...(r.message ? { message: r.message } : {}),
      ...(r.raw ? { raw: r.raw } : {}),
    })),
  };
}
