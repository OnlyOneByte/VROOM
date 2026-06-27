/**
 * UNIQUE-constraint coverage drift guard — the symmetric sibling of backup-ref-validation-coverage
 * (C290), closing the OTHER half of the #127/C428 pre-wipe-validation net.
 *
 * #127 (C428) + C291: replace-mode restore WIPES the account, then inserts. A backup row that
 * violates a DB-level UNIQUE index slips past per-row + referential validation, the wipe commits,
 * then the colliding INSERT throws — and bun-sqlite's async-tx callback does NOT roll back the wipe
 * (the C151 footgun), leaving the account EMPTY (NORTH_STAR #1). validateUniqueConstraints is the
 * gate that rejects such a backup BEFORE the wipe. C291 extended it from 2 to all 5 unique indexes
 * currently on backed-up tables. What NOTHING pins is that it STAYS complete: a future migration can
 * add a 6th unique index to a backed-up table and pass every existing test while validateUniqueConstraints
 * silently fails to cover it — re-opening the exact empty-account gap C291 closed.
 *
 * This guard makes that coverage drift-proof: it RUNTIME-enumerates each backed-up table's unique
 * indexes from the real Drizzle schema (getTableConfig().indexes, filtered to unique) and asserts
 * validateUniqueConstraints checks each one. The single-column `userId` prefix on the partial indexes
 * is dropped: every backup is single-user (metadata.userId is constant across its rows), so a
 * `(user_id, X)` unique index reduces to validating X — which is exactly what the check does
 * (dupCheck(backup.expenses, ['clientId'], …), NOT ['userId','clientId']). So the guard asserts the
 * NON-userId constrained columns (camelCased) each appear in a dupCheck field-array dispatched on the
 * matching backup.<key>.
 *
 * Pure source/schema introspection — no DB, no createTestApp (so no DB-singleton import trap).
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTableName } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { TABLE_SCHEMA_MAP } from '../../../config';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKUP_SRC = readFileSync(join(HERE, '..', 'backup.ts'), 'utf-8');

/** snake_case DB column → camelCase backup-row field (the parsed rows use the schema's JS key). */
function toCamel(col: string): string {
  return col.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
}

/** The validateUniqueConstraints method body, where dupCheck(backup.<key>, [fields], label) is dispatched. */
function uniqueCheckBody(): string {
  const start = BACKUP_SRC.indexOf('private validateUniqueConstraints(');
  expect(start, 'validateUniqueConstraints should exist in backup.ts').toBeGreaterThan(-1);
  // It is the last private method before validateFileSize / the next member; slice generously to
  // the method that follows it in source (validateFileSize) or, failing that, to end of file.
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

describe('backup unique-constraint coverage (drift guard — cycle 295)', () => {
  test('validateUniqueConstraints checks every UNIQUE index on every backed-up table', () => {
    const body = uniqueCheckBody();
    const missing: string[] = [];

    for (const [key, table] of Object.entries(TABLE_SCHEMA_MAP)) {
      for (const idx of uniqueIndexesFor(table)) {
        // A pure userId-only unique index can't cross-collide in a single-user backup → skip.
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
        `AFTER the replace-mode wipe — leaving the account empty (the #127/C428 / C291 data-loss class). ` +
        `Add a dupCheck(backup.<key>, [<non-userId cols>], '<label>') call in validateUniqueConstraints:\n${missing.join('\n')}`
    ).toEqual([]);
  });

  test('the introspection actually finds the known unique indexes (anti-vacuity)', () => {
    // If getTableConfig().indexes ever stops reporting unique indexes (a drizzle API change), the
    // coverage test above would pass vacuously (nothing to check). Pin the known set so it cannot.
    const all = Object.entries(TABLE_SCHEMA_MAP).flatMap(([, table]) =>
      uniqueIndexesFor(table).map((ix) => `${getTableName(table)}:${ix.name}`)
    );
    // The 5 unique indexes C291 enumerated on backed-up tables.
    expect(all).toContain('expenses:expenses_user_client_idx');
    expect(all).toContain('vehicles:vehicles_user_license_plate_idx');
    expect(all).toContain('photo_refs:pr_photo_provider_idx');
    expect(all).toContain('reminder_notifications:rn_reminder_due_idx');
    expect(all).toContain('reminder_notifications:rn_reminder_odo_idx');
    expect(all.length).toBeGreaterThanOrEqual(5);
  });
});
