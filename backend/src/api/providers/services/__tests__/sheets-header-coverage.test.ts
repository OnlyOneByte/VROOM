/**
 * Drift guard for the Google Sheets backup/restore COLUMN set — a data-loss-class
 * regression prevention (cycle 211; sibling of the cycle-208/209 table-coverage guards).
 *
 * Unlike the CSV backup path (whose columns are SCHEMA-DERIVED via getColumnNames →
 * getTableColumns), the Sheets path writes each table through a HAND-MAINTAINED column
 * list (`SHEET_HEADERS` in google-sheets-service.ts). The export emits row 0 = headers and
 * each data row = `headers.map((h) => row[h])`; a schema column missing from the header
 * array is therefore SILENTLY DROPPED on backup and comes back null on restore. This is
 * exactly the bug this guard was born from: `expenses.clientId` (the offline-sync
 * idempotency key) was absent from the expenses headers, so it never survived a Sheets
 * round-trip — while every CSV round-trip preserved it, and the one existing Sheets test
 * (round-trips written data through the SAME headers) was structurally blind to it.
 *
 * Two guards close the class:
 *   A. SHEET_HEADERS keys map 1:1 onto TABLE_SCHEMA_MAP keys (no table un-headered / no
 *      header set for a table that no longer exists).
 *   B. For every table, the header array covers EVERY schema column (superset). Adding a
 *      column to db/schema.ts now forces a matching SHEET_HEADERS entry or this fails.
 *
 * Pure config + schema only — no DB, no network. Runs in the fast suite.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTableColumns } from 'drizzle-orm';
import { TABLE_SCHEMA_MAP } from '../../../../config';
import { SHEET_HEADERS, SHEET_NAMES } from '../google-sheets-service';

describe('Google Sheets header coverage (column drift guard — cycle 211)', () => {
  test('SHEET_HEADERS covers exactly the same table keys as TABLE_SCHEMA_MAP', () => {
    expect(Object.keys(SHEET_HEADERS).sort()).toEqual(Object.keys(TABLE_SCHEMA_MAP).sort());
  });

  test('every schema column is present in its table sheet headers (no silent drop)', () => {
    const drift: string[] = [];

    for (const [key, table] of Object.entries(TABLE_SCHEMA_MAP)) {
      const schemaCols = Object.keys(getTableColumns(table));
      const headers = new Set<string>(SHEET_HEADERS[key as keyof typeof SHEET_HEADERS] ?? []);
      const missing = schemaCols.filter((col) => !headers.has(col));
      if (missing.length > 0) {
        drift.push(`${key}: ${missing.join(', ')}`);
      }
    }

    expect(
      drift,
      `Sheets header array(s) are MISSING schema column(s) — those columns are silently ` +
        `dropped on a Google Sheets backup and restored as null. Add them to SHEET_HEADERS ` +
        `in google-sheets-service.ts (keep order in sync with db/schema.ts):\n${drift.join('\n')}`
    ).toEqual([]);
  });

  test('every sheet header names a real schema column (no stale headers)', () => {
    const stale: string[] = [];

    for (const [key, table] of Object.entries(TABLE_SCHEMA_MAP)) {
      const schemaCols = new Set<string>(Object.keys(getTableColumns(table)));
      const extra = (SHEET_HEADERS[key as keyof typeof SHEET_HEADERS] ?? []).filter(
        (h) => !schemaCols.has(h)
      );
      if (extra.length > 0) {
        stale.push(`${key}: ${extra.join(', ')}`);
      }
    }

    expect(
      stale,
      `Sheets header(s) name a column that no longer exists in the schema — on restore the ` +
        `value lands nowhere. Remove them from SHEET_HEADERS or fix the rename:\n${stale.join('\n')}`
    ).toEqual([]);
  });
});

// C30: SHEET_NAMES (the canonical tab roster, extracted from the hand-copied createSpreadsheet +
// ensureRequiredSheets lists) must stay 1:1 with the table set. Without this, adding a 16th table to
// SHEET_HEADERS/schema would create+ensure 15 tabs while the read/write surfaces expect 16 (a tab whose
// data never persists) — the exact drift the extraction guards against.
describe('Google Sheets tab roster (SHEET_NAMES drift guard — C30)', () => {
  test('SHEET_NAMES has exactly one tab per SHEET_HEADERS table (no missing/extra tab)', () => {
    // `as const` makes SHEET_NAMES.length a literal tuple type; widen to number for the comparison.
    const tabCount: number = SHEET_NAMES.length;
    expect(tabCount).toBe(Object.keys(SHEET_HEADERS).length);
  });

  test('SHEET_NAMES entries are all distinct + non-empty (no dup/blank tab title)', () => {
    const tabCount: number = SHEET_NAMES.length;
    expect(new Set(SHEET_NAMES).size).toBe(tabCount);
    expect(SHEET_NAMES.every((n) => n.trim().length > 0)).toBe(true);
  });
});

// C208 (deep-review): the POPULATE step is a THIRD hand-maintained list the prior guards don't cover.
// `updateSpreadsheetWithUserData` builds a local `tables` array (one `{ title, rows, headers }` per table)
// that drives the atomic swap — and it's the Sheets analog of the ZIP-side createBackup() populate step
// (pinned by backup-createbackup-keys.test.ts). A table present in SHEET_NAMES + SHEET_HEADERS (which guards
// A + C30 enforce) but OMITTED from this array is NOT caught by the round-trip / tab-order tests: createSpreadsheet
// still makes its (empty) canonical tab from SHEET_NAMES, and the Phase-2 delete+rename loop iterates `tables`
// so the omitted table's stale/empty canonical tab SURVIVES — `titles === SHEET_NAMES` still passes while that
// table's real data is silently never written (NORTH_STAR #1 data-loss). A C208 deep-review certified the array
// is correct + in-order today (incl. the C204 Trips append); this pins it. Source-scan the `tables` array's
// `title:` literals, in order, and assert they equal SHEET_NAMES — the C172 cross-file-list idiom.
describe('Google Sheets populate-array coverage (updateSpreadsheetWithUserData ≡ SHEET_NAMES — C208)', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const SERVICE_SRC = readFileSync(join(HERE, '..', 'google-sheets-service.ts'), 'utf-8');

  /** The ordered `title: '...'` literals of the `tables` array inside updateSpreadsheetWithUserData. */
  function populateTitles(): string[] {
    // Scope to the method body so we don't pick up `title:` from elsewhere (e.g. createSpreadsheet uses
    // SHEET_NAMES.map, not title literals; the SpreadsheetInfo type has no title-literal). Start at the
    // method name, end at writeAllSheetsAtomically(...) which immediately follows the array.
    const start = SERVICE_SRC.indexOf('updateSpreadsheetWithUserData');
    const end = SERVICE_SRC.indexOf('writeAllSheetsAtomically(spreadsheetId, tables)', start);
    const body = SERVICE_SRC.slice(start, end > start ? end : undefined);
    return [...body.matchAll(/title:\s*'([^']+)'/g)].map((m) => m[1]);
  }

  test('the populate `tables` array names every SHEET_NAMES tab, in the same order', () => {
    const titles = populateTitles();
    expect(
      titles,
      `The hand-built tables array in updateSpreadsheetWithUserData must list one { title, rows, headers } ` +
        `entry per SHEET_NAMES tab, in order — an omitted table creates an empty tab whose data is silently ` +
        `dropped on a Sheets backup (NORTH_STAR #1). Add the missing { title: '<tab>', rows: …, headers: … }:`
    ).toEqual([...SHEET_NAMES]);
  });

  test('the scan is non-vacuous (it actually found the populate titles)', () => {
    // Floor: if the method were renamed / the array reshaped past the regex, the equality test could pass
    // only by both sides being short — assert we found a realistic number of titles.
    expect(populateTitles().length).toBe(SHEET_NAMES.length);
    expect(populateTitles().length).toBeGreaterThanOrEqual(15);
  });
});
