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

import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { CONFIG } from '../../config';
import { EXPENSE_CATEGORIES, isElectricFuelType } from '../../db/types';
import { denormalizeCsvCell } from '../../utils/csv-safety';
import { buildLocalDate } from './local-date';

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
  /**
   * Deterministic idempotency key (offline-sync style). Re-importing the same file is a
   * no-op via createIdempotent's (userId, clientId) unique index. Derived from the row's
   * content + its Nth-occurrence so two genuinely identical rows both import, while a
   * re-import of the same file dedups perfectly regardless of row order. The `csv:` prefix
   * keeps it from ever colliding with an offline cuid clientId or a manual NULL.
   */
  clientId: string;
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

type CellGetter = (key: string) => string;

/** A cell reader that denormalizes formula-injection neutralization as it reads. */
function makeCellGetter(record: Record<string, string>): CellGetter {
  // denormalizeCsvCell undoes the leading-' that the EXPORT adds to neutralize
  // formula-injection cells (CWE-1236), so a VROOM CSV round-trips faithfully: an
  // expense described `=SUM(...)` exports as `'=SUM(...)` and re-imports as
  // `=SUM(...)`, not `'=SUM(...)`. It only strips `'`+trigger, so a genuinely
  // apostrophe-led value (`'24 road trip`) is untouched. Applied to EVERY cell as
  // it's read — the symmetric inverse of how the export neutralizes every cell.
  return (k: string) => denormalizeCsvCell((record[k] ?? '').trim());
}

/** Required positive money amount within the configured max. */
function parseAmount(raw: string): { value: number } | { error: string } {
  const amount = Number(raw);
  if (!raw || !Number.isFinite(amount) || amount <= 0) {
    return { error: `Invalid amount "${raw}"` };
  }
  if (amount > EXP.maxAmount) return { error: `Amount exceeds the ${EXP.maxAmount} maximum` };
  return { value: amount };
}

/** Optional non-negative integer mileage (blank → null). */
function parseMileage(raw: string): { value: number | null } | { error: string } {
  if (!raw) return { value: null };
  const m = Number(raw);
  if (!Number.isInteger(m) || m < 0) return { error: `Invalid mileage "${raw}"` };
  return { value: m };
}

/** Optional positive volume (blank → null). */
function parseVolume(raw: string): { value: number | null } | { error: string } {
  if (!raw) return { value: null };
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0) return { error: `Invalid volume "${raw}"` };
  return { value: v };
}

/** Required, known expense category (case-insensitive). */
function parseCategory(
  raw: string
): { value: (typeof EXPENSE_CATEGORIES)[number] } | { error: string } {
  const category = raw.toLowerCase();
  if (!EXPENSE_CATEGORIES.includes(category as (typeof EXPENSE_CATEGORIES)[number])) {
    return { error: `Unknown category "${raw}"` };
  }
  return { value: category as (typeof EXPENSE_CATEGORIES)[number] };
}

/** Required Date-parseable timestamp (ISO from our export, but any parseable string is fine). */
function parseDate(raw: string): { value: Date } | { error: string } {
  if (!raw) return { error: `Invalid date "${raw}"` };
  // A DATE-ONLY value (YYYY-MM-DD, no time component) must be built in LOCAL time
  // (cycle-6/11 discipline): `new Date('2024-03-15')` parses as UTC midnight, which rolls
  // the calendar day BACK for every user west of UTC. Our own export writes full ISO with a
  // time, so a VROOM round-trip is unaffected — this guards a hand-edited or foreign
  // date-only file imported on the native path. Anything else (full ISO with time/zone, or
  // any other parseable string) keeps its original absolute-instant semantics via `new Date`.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (dateOnly) {
    // buildLocalDate constructs in LOCAL time AND echo-checks the parts, so an out-of-range
    // cell like "2024-13-45" (which `new Date` silently ROLLS FORWARD to 2025-02-14) returns
    // null → a clean per-row "Invalid date" instead of a stored wrong date (bug #23 / #59).
    // Shared with the mapping path's normalizeForeignDate so the two importers can't drift.
    const date = buildLocalDate(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]));
    if (!date) return { error: `Invalid date "${raw}"` };
    return { value: date };
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return { error: `Invalid date "${raw}"` };
  return { value: date };
}

/** Optional free-text bounded by maxLength (blank → null). */
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

/** Optional tag list (";" or "," separated), bounded by count + per-tag length. */
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

/**
 * Coerce + validate ONE raw CSV record (string-valued cells) into an
 * ImportableExpense, or return a human-readable error message. `date`, `category`,
 * and `amount` are required; everything else is optional and tolerant of the
 * blank cells the exporter writes for non-fuel rows. Per-field parsing is delegated
 * to the small helpers above to keep this orchestration flat.
 */
function parseRow(
  record: Record<string, string>,
  vehicleByName: Map<string, string>
): { expense: ImportableExpense } | { error: string } {
  const get = makeCellGetter(record);

  // --- vehicle: match by name within the user's OWN fleet (never a file id) ---
  const vehicleName = get('vehicle');
  if (!vehicleName) return { error: 'Missing vehicle' };
  const vehicleId = vehicleByName.get(vehicleName.toLowerCase());
  if (!vehicleId) return { error: `No vehicle named "${vehicleName}" in your garage` };

  // Each field is parsed by a small helper that returns {value} or {error}; bail on
  // the first error so the body stays a flat sequence.
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
  // Tags: the export joins with "; ". Accept that plus a plain comma.
  const tagsResult = parseTags(get('tags'));
  if ('error' in tagsResult) return tagsResult;

  const category = categoryResult.value;
  const mileage = mileageResult.value;
  const volume = volumeResult.value;
  const fuelType = fuelTypeResult.value;
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
      category,
      expenseAmount: amountResult.value,
      date: dateResult.value,
      mileage,
      volume,
      fuelType,
      description: descriptionResult.value,
      tags: tagsResult.value,
      missedFillup,
      // Filled in by buildImportPlan, which has the occurrence counter.
      clientId: '',
    },
  };
}

/**
 * Deterministic idempotency key for an imported row: a hash of its identifying content
 * plus the `occurrence` index (0 for the first identical row in the file, 1 for the next,
 * …). Two genuinely-identical rows therefore get distinct keys (both import), while the
 * same file re-imported produces the exact same keys in the same order → all dedup. The
 * `csv:` prefix namespaces it away from offline cuid clientIds and manual NULLs.
 */
function deriveImportClientId(expense: ImportableExpense, occurrence: number): string {
  const content = [
    expense.vehicleId,
    expense.category,
    expense.expenseAmount,
    expense.date.getTime(),
    expense.mileage ?? '',
    expense.volume ?? '',
    expense.fuelType ?? '',
    expense.description ?? '',
    expense.tags.join(''),
    expense.missedFillup ? '1' : '0',
    occurrence,
  ].join(' ');
  return `csv:${createHash('sha256').update(content).digest('hex').slice(0, 32)}`;
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
      bom: true, // strip a leading UTF-8 BOM (Excel/Sheets/Numbers re-saves add one) so the
      // FIRST header name isn't silently prefixed with ﻿ — otherwise that column's key
      // never matches and every row fails its first required field with a misleading message.
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

  // Counts how many times each content-key has been seen so far in THIS file, so
  // identical rows get distinct occurrence indices (and thus distinct clientIds).
  const occurrences = new Map<string, number>();

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
    // Stamp a deterministic idempotency key based on content + how many identical rows
    // we've already seen, so a re-import of the same file is a no-op.
    const baseKey = deriveImportClientId(result.expense, 0);
    const occurrence = occurrences.get(baseKey) ?? 0;
    occurrences.set(baseKey, occurrence + 1);
    result.expense.clientId = deriveImportClientId(result.expense, occurrence);
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
