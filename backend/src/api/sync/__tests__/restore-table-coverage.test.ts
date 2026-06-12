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

  test('every inserted table is conflict-probed OR a child of a probed parent (the #93 symmetry, C302)', () => {
    // #93 (C300): merge-mode insert(userPreferences) against the importer's always-present prefs row
    // threw a raw UNIQUE-PK error because detectConflicts didn't PROBE userPreferences — it only
    // probed 6 tables while insertBackupData inserts 15. The fix added userPreferences + syncState to
    // the probes. This guard makes that symmetry DRIFT-PROOF: every table insertBackupData inserts must
    // be either (a) conflict-probed in detectConflicts, or (b) a CHILD whose insert can't be reached on
    // a colliding merge because the merge ABORTS on the parent's conflict first (detectConflicts returns
    // before the transaction runs). A new PARENT-LESS table added to inserts without a probe would
    // silently reintroduce the #93 raw-throw class — this fails loudly instead.
    //
    // detectConflicts probes are written as `name: '<db_table_name>'`; collect them.
    const probedTableNames = new Set(
      [...RESTORE_SRC.matchAll(/name:\s*'([a-z_]+)'/g)].map((m) => m[1])
    );

    // Tables whose insert is UNREACHABLE on a colliding merge because a probed ANCESTOR collides first
    // (so detectConflicts reports a conflict and the restore returns before insertBackupData runs).
    // Each child here FK-references a probed parent; a same-backup re-import that collides on the child
    // necessarily also collides on that parent (the child can't exist without it). Documented, not blanket.
    const CHILD_OF_PROBED_PARENT: Record<string, string> = {
      insuranceTerms: 'insurance_policies (FK policyId → a probed parent)',
      insuranceTermVehicles: 'insurance_terms → insurance_policies (probed ancestor)',
      insuranceClaims: 'insurance_policies (FK policyId → probed parent)',
      odometerEntries: 'vehicles (FK vehicleId → probed parent)',
      reminders: 'vehicles (FK vehicleId via reminder_vehicles → probed parent)',
      reminderVehicles: 'reminders → vehicles (probed ancestor)',
      reminderNotifications: 'reminders → vehicles (probed ancestor)',
    };

    const insertedExportNames = [...RESTORE_SRC.matchAll(/\.insert\(\s*(\w+)\s*\)/g)].map(
      (m) => m[1]
    );

    const unguarded: string[] = [];
    for (const exportName of new Set(insertedExportNames)) {
      const table = (schema as Record<string, unknown>)[exportName];
      if (!table) continue; // not a schema table export (shouldn't happen for an .insert target)
      const dbName = getTableName(table as Parameters<typeof getTableName>[0]);
      if (probedTableNames.has(dbName)) continue; // (a) directly conflict-probed
      if (exportName in CHILD_OF_PROBED_PARENT) continue; // (b) parent collides first — unreachable
      unguarded.push(`${exportName} (table '${dbName}')`);
    }

    expect(
      unguarded,
      `Table(s) insertBackupData inserts that are neither conflict-probed nor a documented child of a ` +
        `probed parent. On a colliding merge these would throw a raw UNIQUE-PK error instead of a clean ` +
        `conflict (the #93 class). Either add a probe to detectConflicts, or add it to ` +
        `CHILD_OF_PROBED_PARENT with the parent FK that collides first:\n${unguarded.join('\n')}`
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
