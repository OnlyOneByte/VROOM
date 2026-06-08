/**
 * Restore-side drift guard — the symmetric partner to backup-table-coverage.test.ts (c208).
 *
 * c208 proved the BACKUP half can't silently drop a table (createBackup keys === registry).
 * This guards the RESTORE half: if a table is backed up but restore never inserts it, the
 * data round-trips into the archive and back out to NOTHING — silent data loss on restore.
 * The restore path has THREE hand-maintained lists that must agree with the registry:
 *   1. TABLE_SCHEMA_MAP (config) — the source of truth.
 *   2. RestoreService.insertBackupData() — hand-written FK-ordered `tx.insert(<table>)` calls.
 *   3. The ImportSummary interface — one count field per table, populated by hand in BOTH
 *      restoreFromBackup and restoreFromSheets (a missing field = silent undercount in the
 *      user's "imported N rows" confirmation).
 *
 * Verdict at review time (c209): restore coverage is SOUND — all 15 backed-up tables are
 * inserted and summarized. These guards keep it that way under autonomous development.
 *
 * Pure source/shape introspection — no DB, no createTestApp (so no DB-singleton import trap).
 * insertBackupData is private, so its table coverage is asserted by scanning the source for a
 * `.insert(<schemaExport>)` call per registry table — the same drizzle table object the
 * registry maps, resolved to its exported variable name.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTableName } from 'drizzle-orm';
import { TABLE_SCHEMA_MAP } from '../../../config';
import * as schema from '../../../db/schema';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESTORE_SRC = readFileSync(join(HERE, '..', 'restore.ts'), 'utf-8');

/** Map a Drizzle table object back to the schema export NAME it's exported under (e.g. `vehicleFinancing`). */
function exportNameFor(target: unknown): string | undefined {
  for (const [name, value] of Object.entries(schema)) {
    if (value === target) return name;
  }
  return undefined;
}

describe('restore table coverage (drift guard — cycle 209)', () => {
  test('insertBackupData inserts every table the backup registry serializes', () => {
    const missing: string[] = [];
    for (const [key, table] of Object.entries(TABLE_SCHEMA_MAP)) {
      const exportName = exportNameFor(table);
      if (!exportName) {
        missing.push(`${key} (table not found among schema exports)`);
        continue;
      }
      // restore.ts inserts via `tx.insert(<exportName>)`. A registry table with no such
      // insert call means the backup writes it but restore drops it — silent data loss.
      const insertPattern = new RegExp(`\\.insert\\(\\s*${exportName}\\s*\\)`);
      if (!insertPattern.test(RESTORE_SRC)) {
        missing.push(`${key} → ${exportName} (getTableName: ${getTableName(table)})`);
      }
    }
    expect(
      missing,
      `Backed-up table(s) the restore never inserts — data would round-trip to nothing. ` +
        `Add a FK-ordered tx.insert(...) in RestoreService.insertBackupData():\n${missing.join('\n')}`
    ).toEqual([]);
  });

  test('ImportSummary has a count field for every registry key', async () => {
    // The summary is the user-facing "imported N rows" confirmation. A registry key with no
    // ImportSummary field can't be counted → silent undercount even when the data restores.
    // Parse the interface body from source (the type is erased at runtime).
    const ifaceMatch = RESTORE_SRC.match(/export interface ImportSummary\s*\{([^}]*)\}/);
    expect(ifaceMatch, 'ImportSummary interface should be parseable from restore.ts').toBeTruthy();
    const body = ifaceMatch?.[1] ?? '';
    const summaryFields = new Set(
      body
        .split('\n')
        .map((l) => l.trim().match(/^(\w+)\s*:/)?.[1])
        .filter((f): f is string => Boolean(f))
    );

    const missing = Object.keys(TABLE_SCHEMA_MAP).filter((key) => !summaryFields.has(key));
    expect(
      missing,
      `Registry key(s) with no ImportSummary count field (restore would silently undercount ` +
        `them). Add the field + populate it in BOTH restoreFromBackup and restoreFromSheets:\n${missing.join('\n')}`
    ).toEqual([]);
  });
});
