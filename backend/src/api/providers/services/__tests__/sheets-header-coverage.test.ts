import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTableColumns } from 'drizzle-orm';
import { TABLE_SCHEMA_MAP } from '../../../../config';
import { SHEET_HEADERS, SHEET_NAMES } from '../google-sheets-service';

describe('Google Sheets header coverage (column drift guard)', () => {
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

describe('Google Sheets tab roster (SHEET_NAMES drift guard)', () => {
  test('SHEET_NAMES has exactly one tab per SHEET_HEADERS table (no missing/extra tab)', () => {
    const tabCount: number = SHEET_NAMES.length;
    expect(tabCount).toBe(Object.keys(SHEET_HEADERS).length);
  });

  test('SHEET_NAMES entries are all distinct + non-empty (no dup/blank tab title)', () => {
    const tabCount: number = SHEET_NAMES.length;
    expect(new Set(SHEET_NAMES).size).toBe(tabCount);
    expect(SHEET_NAMES.every((n) => n.trim().length > 0)).toBe(true);
  });
});

describe('Google Sheets populate-array coverage (updateSpreadsheetWithUserData ≡ SHEET_NAMES)', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const SERVICE_SRC = readFileSync(join(HERE, '..', 'google-sheets-service.ts'), 'utf-8');

  function populateTitles(): string[] {
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
        `dropped on a Sheets backup. Add the missing { title: '<tab>', rows: …, headers: … }:`
    ).toEqual([...SHEET_NAMES]);
  });

  test('the scan is non-vacuous (it actually found the populate titles)', () => {
    expect(populateTitles().length).toBe(SHEET_NAMES.length);
    expect(populateTitles().length).toBeGreaterThanOrEqual(15);
  });
});
