import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTableName } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { TABLE_SCHEMA_MAP } from '../../../config';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKUP_SRC = readFileSync(join(HERE, '..', 'backup.ts'), 'utf-8');

const NON_BACKED_UP_PARENTS = new Set(['users', 'user_providers', 'sessions']);

function refIntegrityBody(): string {
  const start = BACKUP_SRC.indexOf('private validateReferentialIntegrity(');
  expect(start, 'validateReferentialIntegrity should exist in backup.ts').toBeGreaterThan(-1);
  const end = BACKUP_SRC.indexOf('private validateUniqueConstraints(', start);
  expect(
    end,
    'validateUniqueConstraints should follow validateReferentialIntegrity'
  ).toBeGreaterThan(start);
  return BACKUP_SRC.slice(start, end);
}

describe('backup referential-integrity validation coverage', () => {
  test('every backed-up table with a FK to ANOTHER backed-up table is referenced by validateReferentialIntegrity', () => {
    const body = refIntegrityBody();
    const missing: string[] = [];

    for (const [key, table] of Object.entries(TABLE_SCHEMA_MAP)) {
      const cfg = getTableConfig(table);
      const crossBackupFkParents = [
        ...new Set(
          cfg.foreignKeys
            .map((fk) => getTableName(fk.reference().foreignTable))
            .filter((parent) => !NON_BACKED_UP_PARENTS.has(parent))
        ),
      ];
      if (crossBackupFkParents.length === 0) continue;

      const referenced = new RegExp(`backup\\.${key}\\b`).test(body);
      if (!referenced) {
        missing.push(`${key} (FK → ${crossBackupFkParents.join(', ')})`);
      }
    }

    expect(
      missing,
      `Backed-up table(s) with a foreign key to another backed-up table that validateReferentialIntegrity ` +
        `never inspects. A corrupt backup with a dangling FK on one of these would PASS validation, then throw ` +
        `a raw FK error mid-restore AFTER the replace-mode wipe — leaving the account empty (the ` +
        `data-loss class, FK variant). Add a validate<Table>Refs(...) call on backup.<key> in ` +
        `validateReferentialIntegrity:\n${missing.join('\n')}`
    ).toEqual([]);
  });

  test('the FK introspection finds cross-backup FKs', () => {
    const withCrossBackupFk = Object.entries(TABLE_SCHEMA_MAP)
      .filter(([, table]) =>
        getTableConfig(table)
          .foreignKeys.map((fk) => getTableName(fk.reference().foreignTable))
          .some((parent) => !NON_BACKED_UP_PARENTS.has(parent))
      )
      .map(([key]) => key);

    expect(withCrossBackupFk).toContain('expenses');
    expect(withCrossBackupFk).toContain('trips');
    expect(withCrossBackupFk).toContain('reminderVehicles');
    expect(withCrossBackupFk.length).toBeGreaterThanOrEqual(8);
  });

  test('userId-PK-only tables (userPreferences, syncState) are NOT required to have a ref-validator', () => {
    for (const key of ['userPreferences', 'syncState']) {
      const cfg = getTableConfig(TABLE_SCHEMA_MAP[key]);
      const crossBackupFks = cfg.foreignKeys
        .map((fk) => getTableName(fk.reference().foreignTable))
        .filter((parent) => !NON_BACKED_UP_PARENTS.has(parent));
      expect(crossBackupFks, `${key} should have no cross-backup FK`).toEqual([]);
    }
  });
});
