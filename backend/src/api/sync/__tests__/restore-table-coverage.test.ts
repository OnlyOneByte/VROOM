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
        `\\binsert\\(\\s*${exportName}\\s*,|insertRows\\(\\s*tx,\\s*${exportName}\\s*,`
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

  test('every restore write goes through insertRows, so a merge skips rows already here', () => {
    const directInserts = [...RESTORE_SRC.matchAll(/\btx\s*\.insert\(/g)].length;
    expect(directInserts, 'only insertRows calls tx.insert, once per mode').toBe(2);
    expect(RESTORE_SRC).toContain('.onConflictDoNothing()');
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
