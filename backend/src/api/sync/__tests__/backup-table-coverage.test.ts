// Every schema table must be either backed up or explicitly excluded. The registry and
// createBackup() are hand-written lists, so a table missing from either is silently dropped from
// exports.

import { describe, expect, test } from 'bun:test';
import { getTableName, is, Table } from 'drizzle-orm';
import { OPTIONAL_BACKUP_FILES, TABLE_FILENAME_MAP, TABLE_SCHEMA_MAP } from '../../../config';
import * as schema from '../../../db/schema';
import { ratchet } from '../../../test-helpers/debt-ratchet';

/**
 * Tables intentionally absent from a backup. Adding one here asserts "a user's backup should not
 * contain this", so each needs a reason that survives the next reader:
 *
 *  - `users` — the account identity itself. Restore stamps rows onto the REQUESTING user, so
 *    carrying foreign user rows would at best be dead weight and at worst let a crafted backup
 *    mint an account.
 *  - `user_providers` — encrypted storage/LLM credentials. Exporting them would put a user's
 *    third-party secrets in a file they email around.
 *  - `sessions` — ephemeral auth sessions; a restored one is either expired or a live credential
 *    in the wrong place.
 *  - `push_subscriptions` — per-DEVICE Web Push endpoints plus the p256dh/auth client keys. The
 *    browser re-derives these on re-subscribe, and a restored stale subscription pushes at a dead
 *    endpoint. Same rationale as sessions: ephemeral, and meaningless in a new environment.
 */
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

/**
 * Every schema table the registry does not serialize must be listed here. Stale entries also fail,
 * so an exclusion cannot silently exempt a future table that reuses its name.
 */
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
    // Fixtures rather than real excluded tables, so this does not break when one becomes backed up.
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
    // A table missing its filename (or vice versa) would be silently skipped on export.
    expect(Object.keys(TABLE_SCHEMA_MAP).sort()).toEqual(Object.keys(TABLE_FILENAME_MAP).sort());
  });

  test('every OPTIONAL_BACKUP_FILES entry is a real TABLE_FILENAME_MAP value', () => {
    // A stale optional filename would make that file required, so an older backup missing it would be rejected.
    const mapValues = new Set(Object.values(TABLE_FILENAME_MAP));
    const orphans = [...OPTIONAL_BACKUP_FILES].filter((f) => !mapValues.has(f));
    expect(
      orphans,
      `OPTIONAL_BACKUP_FILES entr(ies) not present in TABLE_FILENAME_MAP — a stale/typo'd optional ` +
        `filename makes a real backup file REQUIRED, failing restore of a valid older backup that omits ` +
        `it. Keep OPTIONAL_BACKUP_FILES a subset of the map's values:\n${orphans.join('\n')}`
    ).toEqual([]);
  });

  // createBackup() keys are checked in backup-createbackup-keys.test.ts, which needs the DB harness.
});
