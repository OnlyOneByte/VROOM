import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTableName } from 'drizzle-orm';
import { TABLE_SCHEMA_MAP } from '../../../config';
import * as schema from '../../../db/schema';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESTORE_SRC = readFileSync(join(HERE, '..', 'restore.ts'), 'utf-8');

function exportNameFor(target: unknown): string | undefined {
  for (const [name, value] of Object.entries(schema)) {
    if (value === target) return name;
  }
  return undefined;
}

describe('restore table coverage', () => {
  test('insertBackupData inserts every table the backup registry serializes', () => {
    const missing: string[] = [];
    for (const [key, table] of Object.entries(TABLE_SCHEMA_MAP)) {
      const exportName = exportNameFor(table);
      if (!exportName) {
        missing.push(`${key} (table not found among schema exports)`);
        continue;
      }
      const insertPattern = new RegExp(
        `\\.insert\\(\\s*${exportName}\\s*\\)|insertRows\\(\\s*tx,\\s*${exportName}\\s*,`
      );
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

  test('every inserted table is conflict-probed OR a child of a probed parent (the symmetry)', () => {
    const probedTableNames = new Set(
      [...RESTORE_SRC.matchAll(/name:\s*'([a-z_]+)'/g)].map((m) => m[1])
    );

    const CHILD_OF_PROBED_PARENT: Record<string, string> = {
      insuranceTerms: 'insurance_policies (FK policyId → a probed parent)',
      insuranceTermVehicles: 'insurance_terms → insurance_policies (probed ancestor)',
      insuranceClaims: 'insurance_policies (FK policyId → probed parent)',
      odometerEntries: 'vehicles (FK vehicleId → probed parent)',
      reminderVehicles: 'reminders (FK reminderId → a probed parent)',
      reminderNotifications: 'reminders (FK reminderId → a probed parent)',
    };

    const insertedExportNames = [
      ...RESTORE_SRC.matchAll(/\.insert\(\s*(\w+)\s*\)/g),
      ...RESTORE_SRC.matchAll(/insertRows\(\s*tx,\s*(\w+)\s*,/g),
    ].map((m) => m[1]);

    const unguarded: string[] = [];
    for (const exportName of new Set(insertedExportNames)) {
      const table = (schema as Record<string, unknown>)[exportName];
      if (!table) continue;
      const dbName = getTableName(table as Parameters<typeof getTableName>[0]);
      if (probedTableNames.has(dbName)) continue;
      if (exportName in CHILD_OF_PROBED_PARENT) continue;
      unguarded.push(`${exportName} (table '${dbName}')`);
    }

    expect(
      unguarded,
      `Table(s) insertBackupData inserts that are neither conflict-probed nor a documented child of a ` +
        `probed parent. On a colliding merge these would throw a raw UNIQUE-PK error instead of a clean ` +
        `conflict (class). Either add a probe to detectConflicts, or add it to ` +
        `CHILD_OF_PROBED_PARENT with the parent FK that collides first:\n${unguarded.join('\n')}`
    ).toEqual([]);
  });

  test('ImportSummary has a count field for every registry key', async () => {
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
