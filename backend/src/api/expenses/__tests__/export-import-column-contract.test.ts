import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPORT_COLUMNS } from '../routes';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMPORTER = join(HERE, '..', 'import-csv.ts');

const GET_CALL = /\bget\(\s*['"]([a-zA-Z]+)['"]\s*\)/g;

describe('CSV export and import column-name contract', () => {
  test('EXPORT_COLUMNS is a real exported constant', () => {
    expect(Array.isArray(EXPORT_COLUMNS)).toBe(true);
    expect(EXPORT_COLUMNS.length).toBeGreaterThanOrEqual(10);
  });

  test('the scan resolves the importer module', () => {
    expect(readFileSync(IMPORTER, 'utf8').length, `unreadable/empty: ${IMPORTER}`).toBeGreaterThan(
      100
    );
  });

  test('every column the importer reads via get() is present in EXPORT_COLUMNS', () => {
    const src = readFileSync(IMPORTER, 'utf8');
    const readKeys = new Set<string>();
    for (const m of src.matchAll(GET_CALL)) {
      if (m[1]) readKeys.add(m[1]);
    }
    expect(
      readKeys.size,
      'expected the importer to read ≥8 columns via get()'
    ).toBeGreaterThanOrEqual(8);

    const exportSet = new Set<string>(EXPORT_COLUMNS as readonly string[]);
    const missing = [...readKeys].filter((k) => !exportSet.has(k));
    expect(
      missing,
      `The importer reads column(s) the export no longer writes: [${missing.join(', ')}]. A VROOM ` +
        `export → re-import would silently LOSE these fields. Keep EXPORT_COLUMNS in ` +
        `sync with the importer's get('<col>') reads — rename/drop on BOTH sides together.`
    ).toEqual([]);
  });

  test('the export-only metadata columns (currency, createdAt) are intentionally NOT read by the importer', () => {
    const src = readFileSync(IMPORTER, 'utf8');
    const readKeys = new Set<string>();
    for (const m of src.matchAll(GET_CALL)) {
      if (m[1]) readKeys.add(m[1]);
    }
    expect(readKeys.has('currency')).toBe(false);
    expect(readKeys.has('createdAt')).toBe(false);
  });
});
