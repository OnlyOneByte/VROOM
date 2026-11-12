import { describe, expect, test } from 'bun:test';
import { getTableName, is, Table } from 'drizzle-orm';
import { OPTIONAL_BACKUP_FILES, TABLE_FILENAME_MAP, TABLE_SCHEMA_MAP } from '../../../config';
import * as schema from '../../../db/schema';
import { ratchet } from '../../../test-helpers/debt-ratchet';

// Never exported: account identity, encrypted credentials, live sessions and per-device push endpoints.
const EXCLUDED_BY_DESIGN = ['users', 'user_providers', 'sessions', 'push_subscriptions'] as const;

function allSchemaTableNames(): string[] {
  const names = new Set<string>();
  for (const value of Object.values(schema)) {
    if (is(value, Table)) names.add(getTableName(value));
  }
  return [...names].sort();
}

function registryTableNames(): Set<string> {
  const names = new Set<string>();
  for (const table of Object.values(TABLE_SCHEMA_MAP)) {
    names.add(getTableName(table));
  }
  return names;
}

ratchet({
  name: 'every schema table is either backed up or excluded by design',
  kind: 'exclusion',
  tolerated: EXCLUDED_BY_DESIGN,
  guidance:
    'Schema table(s) neither backed up nor excluded by design. Either add them to ' +
    'TABLE_SCHEMA_MAP + TABLE_FILENAME_MAP + createBackup() so user data survives a backup, or ' +
    'add them to EXCLUDED_BY_DESIGN with a documented reason:',
  scan: () => {
    const registry = registryTableNames();
    return allSchemaTableNames().filter((name) => !registry.has(name));
  },
  probe: () => {
    expect(
      allSchemaTableNames().length,
      'no schema tables found — the schema import broke'
    ).toBeGreaterThan(20);
    expect(registryTableNames().size, 'the backup registry resolved to nothing').toBeGreaterThan(
      10
    );
    const schemaNames = new Set(allSchemaTableNames());
    expect([...registryTableNames()].filter((name) => !schemaNames.has(name))).toEqual([]);
  },
});

describe('backup table coverage', () => {
  test('the registry and filename map cover exactly the same keys', () => {
    expect(Object.keys(TABLE_SCHEMA_MAP).sort()).toEqual(Object.keys(TABLE_FILENAME_MAP).sort());
  });

  test('every OPTIONAL_BACKUP_FILES entry is a real TABLE_FILENAME_MAP value', () => {
    const mapValues = new Set(Object.values(TABLE_FILENAME_MAP));
    const orphans = [...OPTIONAL_BACKUP_FILES].filter((f) => !mapValues.has(f));
    expect(
      orphans,
      `OPTIONAL_BACKUP_FILES entr(ies) not present in TABLE_FILENAME_MAP — a stale/typo'd optional ` +
        `filename makes a real backup file REQUIRED, failing restore of a valid older backup that omits ` +
        `it. Keep OPTIONAL_BACKUP_FILES a subset of the map's values:\n${orphans.join('\n')}`
    ).toEqual([]);
  });
});
