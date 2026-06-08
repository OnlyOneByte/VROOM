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
import { getTableColumns } from 'drizzle-orm';
import { TABLE_SCHEMA_MAP } from '../../../../config';
import { SHEET_HEADERS } from '../google-sheets-service';

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
