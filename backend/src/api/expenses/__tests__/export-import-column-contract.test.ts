/**
 * Regression GUARD (committed, travels with the merge) for the CSV export↔import column-name contract
 * — the crown-jewel round-trip invariant (NORTH_STAR #1: "export → re-import round-trips losslessly").
 *
 * The export writes its header row from `EXPORT_COLUMNS` (expenses/routes.ts). The native importer reads
 * each cell BY NAME via `makeCellGetter`'s `get('<col>')` (import-csv.ts) — `get('vehicle')`,
 * `get('amount')`, `get('fuelType')`, etc. The two are coupled ONLY by the string column names matching.
 * Rename or drop an EXPORT_COLUMN (e.g. `fuelType` → `fuel_type`) without updating the importer's
 * `get('fuelType')` and a VROOM-exported file silently STOPS round-tripping that field — the column reads
 * as blank, the value is lost on re-import (NORTH_STAR #1). NEITHER existing suite catches this: export-csv
 * .test.ts asserts the export only, and import-csv.test.ts hand-writes its OWN literal header row (it never
 * imports the real EXPORT_COLUMNS const), so a drift between the two leaves both green.
 *
 * This pins the contract: every key the importer READS must be present in EXPORT_COLUMNS (so the exporter
 * emits it). The reverse is NOT required — EXPORT_COLUMNS carries 2 export-only metadata columns
 * (`currency`, `createdAt`) the importer deliberately ignores (currency is display context; createdAt is
 * regenerated). Source-scans the importer for its `get('<key>')` reads + imports the real EXPORT_COLUMNS.
 * The one-edit→source-scan pattern (C25/C45/C59/C73) on the export/import round-trip contract.
 *
 * Pure source scan + a const import — no DB, no network. Runs in the fast suite.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPORT_COLUMNS } from '../routes';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMPORTER = join(HERE, '..', 'import-csv.ts');

// Every `get('<key>')` / get("<key>") the importer reads. makeCellGetter is the ONLY cell accessor, so
// these are exactly the column names the importer expects in the header row.
const GET_CALL = /\bget\(\s*['"]([a-zA-Z]+)['"]\s*\)/g;

describe('CSV export↔import column-name contract (round-trip, NORTH_STAR #1)', () => {
  test('EXPORT_COLUMNS is the real exported const (guard is live, not a no-op)', () => {
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
    // Non-vacuity: the importer reads a known set of columns; if the scan found none the assertion below
    // would vacuously pass.
    expect(
      readKeys.size,
      'expected the importer to read ≥8 columns via get()'
    ).toBeGreaterThanOrEqual(8);

    const exportSet = new Set<string>(EXPORT_COLUMNS as readonly string[]);
    const missing = [...readKeys].filter((k) => !exportSet.has(k));
    expect(
      missing,
      `The importer reads column(s) the export no longer writes: [${missing.join(', ')}]. A VROOM ` +
        `export → re-import would silently LOSE these fields (NORTH_STAR #1). Keep EXPORT_COLUMNS in ` +
        `sync with the importer's get('<col>') reads — rename/drop on BOTH sides together.`
    ).toEqual([]);
  });

  test('the export-only metadata columns (currency, createdAt) are intentionally NOT read by the importer', () => {
    // Pins the asymmetry as DELIBERATE: these two are export display/metadata, regenerated or ignored on
    // import. If a future change starts reading one, that's fine — but document it by updating this test.
    const src = readFileSync(IMPORTER, 'utf8');
    const readKeys = new Set<string>();
    for (const m of src.matchAll(GET_CALL)) {
      if (m[1]) readKeys.add(m[1]);
    }
    expect(readKeys.has('currency')).toBe(false);
    expect(readKeys.has('createdAt')).toBe(false);
  });
});
