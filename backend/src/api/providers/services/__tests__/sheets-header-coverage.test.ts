import { beforeEach, describe, expect, test } from 'bun:test';
import { getTableColumns } from 'drizzle-orm';
import { TABLE_SCHEMA_MAP } from '../../../../config';
import {
  FakeGoogleStore,
  makeFakeSheetsClients,
} from '../../../../test-helpers/fake-google-clients';
import { createTestApp, type TestApp } from '../../../../test-helpers/http-client';
import {
  GoogleSheetsService,
  SHEET_HEADERS,
  SHEET_NAMES,
  SHEET_TABS,
} from '../google-sheets-service';

type SheetTableKey = keyof typeof SHEET_TABS;

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

describe('Google Sheets backup writes every tab (populate coverage)', () => {
  let ctx: TestApp;

  beforeEach(async () => {
    ctx = await createTestApp();
  });

  test('a backup writes a header row to every table tab', async () => {
    const store = new FakeGoogleStore();
    const svc = new GoogleSheetsService('fake-refresh-token', makeFakeSheetsClients(store));
    const info = await svc.createOrUpdateVroomSpreadsheet(ctx.user.id, 'VROOM', 'Demo User');
    const grids = store.spreadsheets.get(info.id)?.values;

    const tableKeys = Object.keys(SHEET_TABS) as SheetTableKey[];
    const unwritten = tableKeys.filter((key) => !grids?.has(SHEET_TABS[key]));
    expect(unwritten, 'tables whose tab was never written (their data would be dropped)').toEqual(
      []
    );

    for (const key of tableKeys) {
      expect(grids?.get(SHEET_TABS[key])?.[0], `${key} header row`).toEqual([
        ...SHEET_HEADERS[key],
      ]);
    }
  });
});
