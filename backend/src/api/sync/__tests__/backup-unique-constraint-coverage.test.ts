// Every UNIQUE index on a backed-up table must be checked by validateUniqueConstraints, or a
// duplicate would empty the account during restore. Indexes are enumerated from the schema. The
// userId prefix is dropped because each backup is single-user. Pure introspection, no DB.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTableName } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { TABLE_SCHEMA_MAP } from '../../../config';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKUP_SRC = readFileSync(join(HERE, '..', 'backup.ts'), 'utf-8');

/** snake_case DB column → camelCase backup-row field. */
function toCamel(col: string): string {
  return col.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
}

function uniqueCheckBody(): string {
  const start = BACKUP_SRC.indexOf('private validateUniqueConstraints(');
  expect(start, 'validateUniqueConstraints should exist in backup.ts').toBeGreaterThan(-1);
  const after = BACKUP_SRC.indexOf('validateFileSize(', start);
  return BACKUP_SRC.slice(start, after > start ? after : undefined);
}

/** Every unique index drizzle reports for a table, as {name, nonUserCols[]} (userId prefix dropped). */
function uniqueIndexesFor(table: Parameters<typeof getTableConfig>[0]) {
  const cfg = getTableConfig(table);
  return (cfg.indexes ?? [])
    .filter((ix) => ix.config?.unique)
    .map((ix) => ({
      name: ix.config?.name,
      nonUserCols: (ix.config?.columns ?? [])
        .map((col) =>
          typeof col === 'object' && col && 'name' in col ? String(col.name) : String(col)
        )
        .filter((c) => c !== 'user_id')
        .map(toCamel),
    }));
}

/** The field-name arrays from every `dupCheck(backup.<key>, [ ... ], …)` call in the method body. */
function dupCheckFieldSets(body: string, key: string): string[][] {
  const callRe = new RegExp(`dupCheck\\(\\s*backup\\.${key}\\b([\\s\\S]*?)\\)`, 'g');
  const sets: string[][] = [];
  for (const m of body.matchAll(callRe)) {
    const fieldsMatch = (m[1] ?? '').match(/\[([^\]]*)\]/); // the first [..] is the fields array
    if (fieldsMatch) sets.push([...fieldsMatch[1].matchAll(/'([^']+)'/g)].map((f) => f[1]));
  }
  return sets;
}

/** True if some dupCheck(backup.<key>, …) covers EVERY non-userId column of this index. */
function indexIsChecked(body: string, key: string, nonUserCols: string[]): boolean {
  return dupCheckFieldSets(body, key).some((fields) =>
    nonUserCols.every((c) => fields.includes(c))
  );
}

describe('backup unique-constraint coverage', () => {
  test('validateUniqueConstraints checks every UNIQUE index on every backed-up table', () => {
    const body = uniqueCheckBody();
    const missing: string[] = [];

    for (const [key, table] of Object.entries(TABLE_SCHEMA_MAP)) {
      for (const idx of uniqueIndexesFor(table)) {
        // A userId-only unique index cannot collide within a single-user backup.
        if (idx.nonUserCols.length === 0) continue;
        if (!indexIsChecked(body, key, idx.nonUserCols)) {
          missing.push(
            `${key}.${idx.name} → needs dupCheck(backup.${key}, [${idx.nonUserCols.map((c) => `'${c}'`).join(', ')}], …)`
          );
        }
      }
    }

    expect(
      missing,
      `UNIQUE index(es) on a backed-up table that validateUniqueConstraints does NOT check. A backup ` +
        `with a duplicate on one of these passes validation, then throws a raw UNIQUE error mid-restore ` +
        `AFTER the replace-mode wipe — leaving the account empty (the restore-atomicity data-loss class). ` +
        `Add a dupCheck(backup.<key>, [<non-userId cols>], '<label>') call in validateUniqueConstraints:\n${missing.join('\n')}`
    ).toEqual([]);
  });

  test('the introspection finds the known unique indexes', () => {
    // Pins the known set so a drizzle API change cannot make the coverage test pass vacuously.
    const all = Object.entries(TABLE_SCHEMA_MAP).flatMap(([, table]) =>
      uniqueIndexesFor(table).map((ix) => `${getTableName(table)}:${ix.name}`)
    );
    expect(all).toContain('expenses:expenses_user_client_idx');
    expect(all).toContain('vehicles:vehicles_user_license_plate_idx');
    expect(all).toContain('photo_refs:pr_photo_provider_idx');
    expect(all).toContain('reminder_notifications:rn_reminder_due_idx');
    expect(all).toContain('reminder_notifications:rn_reminder_odo_idx');
    expect(all.length).toBeGreaterThanOrEqual(5);
  });
});
