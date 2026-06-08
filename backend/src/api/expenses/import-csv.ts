/**
 * CSV import for expenses — the round-trip target for VROOM's own export
 * (`GET /expenses/export`, EXPORT_COLUMNS). Parses a "VROOM CSV", validates every
 * row, and resolves each row's vehicle to one the importing user OWNS — never a
 * file-provided id (the cross-tenant-write class hardened in the restore path,
 * cycle 145). This module is pure (no DB, no Hono): it turns raw CSV text + the
 * caller's vehicle list into a per-row plan the route then either previews
 * (dryRun) or commits. Keeping it pure makes the parse/validate/match contract
 * unit-testable without standing up a server.
 */

import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { CONFIG } from '../../config';
import { EXPENSE_CATEGORIES, isElectricFuelType } from '../../db/types';
import { denormalizeCsvCell } from '../../utils/csv-safety';

/** A vehicle the importing user owns — the ONLY rows we'll attach expenses to. */
export interface ImportVehicle {
  id: string;
  make: string;
  model: string;
  year: number;
  nickname?: string | null;
}

/** A validated, ready-to-insert expense (the subset the create path needs). */
export interface ImportableExpense {
  vehicleId: string;
  category: (typeof EXPENSE_CATEGORIES)[number];
  expenseAmount: number;
  date: Date;
  mileage: number | null;
  volume: number | null;
  fuelType: string | null;
  description: string | null;
  tags: string[];
  missedFillup: boolean;
}

export type ImportRowStatus = 'ready' | 'error';

export interface ImportRowResult {
  /** 1-based row number as the USER sees it in a spreadsheet (header = row 1). */
  row: number;
  status: ImportRowStatus;
  /** Present when status === 'ready'. */
  expense?: ImportableExpense;
  /** Present when status === 'error'. */
  message?: string;
  /** Echoed back for the preview UI (vehicle name + amount + date as given). */
  raw?: { vehicle: string; category: string; amount: string; date: string };
}

export interface ImportPlan {
  rows: ImportRowResult[];
  readyCount: number;
  errorCount: number;
}

/** Raised for whole-file problems (not per-row): unparseable, empty, too big. */
export class CsvImportError extends Error {}

// Per-cell limits mirror the create schema so an import can't smuggle past the
// same bounds the POST route enforces.
const EXP = CONFIG.validation.expense;

/**
 * Coerce + validate ONE raw CSV record (string-valued cells) into an
 * ImportableExpense, or return a human-readable error message. `date`, `category`,
 * and `amount` are required; everything else is optional and tolerant of the
 * blank cells the exporter writes for non-fuel rows.
 */
function parseRow(
  record: Record<string, string>,
  vehicleByName: Map<string, string>
): { expense: ImportableExpense } | { error: string } {
  // denormalizeCsvCell undoes the leading-' that the EXPORT adds to neutralize
  // formula-injection cells (CWE-1236), so a VROOM CSV round-trips faithfully: an
  // expense described `=SUM(...)` exports as `'=SUM(...)` and re-imports as
  // `=SUM(...)`, not `'=SUM(...)`. It only strips `'`+trigger, so a genuinely
  // apostrophe-led value (`'24 road trip`) is untouched. Applied to EVERY cell as
  // it's read — the symmetric inverse of how the export neutralizes every cell.
  const get = (k: string) => denormalizeCsvCell((record[k] ?? '').trim());

  // --- vehicle: match by name within the user's OWN fleet (never a file id) ---
  const vehicleName = get('vehicle');
  if (!vehicleName) return { error: 'Missing vehicle' };
  const vehicleId = vehicleByName.get(vehicleName.toLowerCase());
  if (!vehicleId) {
    return { error: `No vehicle named "${vehicleName}" in your garage` };
  }

  // --- category ---
  const category = get('category').toLowerCase();
  if (!EXPENSE_CATEGORIES.includes(category as (typeof EXPENSE_CATEGORIES)[number])) {
    return { error: `Unknown category "${get('category')}"` };
  }

  // --- amount ---
  const amountRaw = get('amount');
  const amount = Number(amountRaw);
  if (!amountRaw || !Number.isFinite(amount) || amount <= 0) {
    return { error: `Invalid amount "${amountRaw}"` };
  }
  if (amount > EXP.maxAmount) {
    return { error: `Amount exceeds the ${EXP.maxAmount} maximum` };
  }

  // --- date (ISO from our export, but accept any Date-parseable string) ---
  const dateRaw = get('date');
  const date = new Date(dateRaw);
  if (!dateRaw || Number.isNaN(date.getTime())) {
    return { error: `Invalid date "${dateRaw}"` };
  }

  // --- optional numerics ---
  let mileage: number | null = null;
  const mileageRaw = get('mileage');
  if (mileageRaw) {
    const m = Number(mileageRaw);
    if (!Number.isInteger(m) || m < 0) return { error: `Invalid mileage "${mileageRaw}"` };
    mileage = m;
  }

  let volume: number | null = null;
  const volumeRaw = get('volume');
  if (volumeRaw) {
    const v = Number(volumeRaw);
    if (!Number.isFinite(v) || v <= 0) return { error: `Invalid volume "${volumeRaw}"` };
    volume = v;
  }

  const fuelType = get('fuelType') || null;
  if (fuelType && fuelType.length > EXP.fuelTypeMaxLength) {
    return { error: `Fuel type exceeds ${EXP.fuelTypeMaxLength} characters` };
  }

  const description = get('description') || null;
  if (description && description.length > EXP.descriptionMaxLength) {
    return { error: `Description exceeds ${EXP.descriptionMaxLength} characters` };
  }

  // Tags: the export joins with "; ". Accept that plus a plain comma.
  const tagsRaw = get('tags');
  const tags = tagsRaw
    ? tagsRaw
        .split(/[;,]/)
        .map((t) => t.trim())
        .filter(Boolean)
    : [];
  if (tags.length > EXP.maxTags) return { error: `More than ${EXP.maxTags} tags` };
  for (const t of tags) {
    if (t.length > EXP.tagMaxLength) return { error: `Tag "${t}" exceeds ${EXP.tagMaxLength} chars` };
  }

  const missedFillup = /^(true|1|yes)$/i.test(get('missedFillup'));

  // Fuel rows need volume + mileage (the create route enforces the same; mirror it
  // here so a fuel row missing them fails at preview, not mid-commit).
  if (category === 'fuel' && (!volume || mileage === null)) {
    return {
      error: isElectricFuelType(fuelType)
        ? 'Charging rows require charge amount (kWh) and mileage'
        : 'Fuel rows require fuel amount and mileage',
    };
  }

  return {
    expense: {
      vehicleId,
      category: category as (typeof EXPENSE_CATEGORIES)[number],
      expenseAmount: amount,
      date,
      mileage,
      volume,
      fuelType,
      description,
      tags,
      missedFillup,
    },
  };
}

/** Body schema for the import route. */
export const importCsvSchema = z.object({
  csv: z.string().min(1, 'CSV content is required').max(5_000_000, 'CSV file is too large'),
  // When true, validate + report only — write nothing. The UI previews with
  // dryRun:true, then commits with dryRun:false after the user confirms.
  dryRun: z.boolean().optional().default(false),
});

/**
 * Parse the whole CSV and build a per-row import plan. Throws CsvImportError for
 * file-level problems; per-row problems become `status:'error'` entries so the
 * user sees every issue at once (not just the first).
 */
export function buildImportPlan(csv: string, vehicles: ImportVehicle[]): ImportPlan {
  let records: Record<string, string>[];
  try {
    records = parse(csv, {
      columns: true, // first row is the header
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true, // tolerate trailing/short rows rather than hard-fail the file
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

  // Resolve names case-insensitively. Build BOTH the nickname and the
  // "year make model" forms the exporter emits, so either column value matches.
  const vehicleByName = new Map<string, string>();
  for (const v of vehicles) {
    if (v.nickname) vehicleByName.set(v.nickname.toLowerCase(), v.id);
    vehicleByName.set(`${v.year} ${v.make} ${v.model}`.toLowerCase(), v.id);
  }

  const rows: ImportRowResult[] = records.map((record, i) => {
    // Denormalize the echoed raw cells too, so the preview UI shows the real values
    // (matches what parseRow sees via its own denormalizing `get`).
    const raw = {
      vehicle: denormalizeCsvCell((record.vehicle ?? '').trim()),
      category: denormalizeCsvCell((record.category ?? '').trim()),
      amount: denormalizeCsvCell((record.amount ?? '').trim()),
      date: denormalizeCsvCell((record.date ?? '').trim()),
    };
    const result = parseRow(record, vehicleByName);
    // +2: header is row 1, first data row is row 2 (matches a spreadsheet).
    const rowNum = i + 2;
    if ('error' in result) {
      return { row: rowNum, status: 'error' as const, message: result.error, raw };
    }
    return { row: rowNum, status: 'ready' as const, expense: result.expense, raw };
  });

  const readyCount = rows.filter((r) => r.status === 'ready').length;
  return { rows, readyCount, errorCount: rows.length - readyCount };
}

/**
 * Shape an ImportPlan into the JSON the route returns. Strips the internal
 * `expense` payload (the client doesn't need the resolved insert object) and keeps
 * the user-facing per-row status/message/raw + the totals. Pure, so the route's
 * response contract is testable without a server.
 */
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
