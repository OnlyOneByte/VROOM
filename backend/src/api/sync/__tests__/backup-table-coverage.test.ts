/**
 * Drift guards for the backup table set — a data-loss-class regression prevention.
 *
 * The backup pipeline has TWO independent lists that must stay in sync:
 *   1. TABLE_SCHEMA_MAP / TABLE_FILENAME_MAP (config) — drive CSV serialize, parse, validate.
 *   2. BackupService.createBackup() — hand-written per-table queries that POPULATE the export.
 * Nothing mechanically ties them together, and neither is derived from the schema. So under
 * autonomous development a new table can be added to the schema (and to one list but not the
 * other), and the export silently omits it — a user's backup quietly loses that data, and
 * because new files are treated as OPTIONAL on restore, the round-trip won't complain either.
 *
 * Two guards close that:
 *   A. Every schema table is either backed up (in the registry) OR on an explicit
 *      EXCLUDED_BY_DESIGN allowlist. Adding a new table forces a deliberate decision here.
 *   B. createBackup()'s output data-keys EXACTLY equal the registry keys — the populate step
 *      can't drift from the serialize step.
 *
 * createTestApp() rewrites env + dynamic-imports DB-bound modules, so keep static imports to
 * the harness + bun:test + the pure config; import backup dynamically AFTER createTestApp.
 */

import { describe, expect, test } from 'bun:test';
import { getTableName, is, Table } from 'drizzle-orm';
import { OPTIONAL_BACKUP_FILES, TABLE_FILENAME_MAP, TABLE_SCHEMA_MAP } from '../../../config';
import * as schema from '../../../db/schema';

// Tables intentionally NOT in a backup. Each must have a real reason — if you add a table
// here you are asserting "a user's backup should not contain this", so document why.
//   users         — the account identity itself; restore stamps rows onto the requesting user.
//   userProviders — encrypted storage credentials; never exported (see backup.ts validatePhotoRefEntries note).
//   sessions      — ephemeral auth sessions; restoring them would be meaningless/unsafe.
// (vehicle_shares WAS temporarily parked here at T1; T9 [C54] wired its owner-side backup round-trip —
//  createBackup exports the owner's ACCEPTED grants [D7], restore re-stamps ownerId + skips absent
//  invitees [#127-safe] — so it is now a backed-up table in the registry, no longer excluded.)
const EXCLUDED_BY_DESIGN = new Set<string>(['users', 'user_providers', 'sessions']);

/** Every physical table NAME defined in the Drizzle schema. */
function allSchemaTableNames(): string[] {
  const names = new Set<string>();
  for (const value of Object.values(schema)) {
    if (is(value, Table)) names.add(getTableName(value));
  }
  return [...names].sort();
}

/** The table names the backup registry serializes (resolved from the Drizzle tables it maps). */
function registryTableNames(): Set<string> {
  const names = new Set<string>();
  for (const table of Object.values(TABLE_SCHEMA_MAP)) {
    names.add(getTableName(table));
  }
  return names;
}

describe('backup table coverage (drift guards — cycle 208)', () => {
  test('every schema table is either backed up or explicitly excluded by design', () => {
    const registry = registryTableNames();
    const uncovered = allSchemaTableNames().filter(
      (name) => !registry.has(name) && !EXCLUDED_BY_DESIGN.has(name)
    );
    expect(
      uncovered,
      `Schema table(s) neither backed up nor excluded-by-design. Either add them to ` +
        `TABLE_SCHEMA_MAP + TABLE_FILENAME_MAP + createBackup() (so user data survives a backup), ` +
        `or add them to EXCLUDED_BY_DESIGN with a documented reason:\n${uncovered.join('\n')}`
    ).toEqual([]);
  });

  test('the registry and filename map cover exactly the same keys', () => {
    // A table mapped to a schema but missing a filename (or vice-versa) would be skipped by
    // exportAsZip's `if (table && filename)` guard — a silent omission.
    expect(Object.keys(TABLE_SCHEMA_MAP).sort()).toEqual(Object.keys(TABLE_FILENAME_MAP).sort());
  });

  test('every OPTIONAL_BACKUP_FILES entry is a real TABLE_FILENAME_MAP value (no orphan → no false-required file)', () => {
    // getRequiredBackupFiles() = TABLE_FILENAME_MAP values MINUS OPTIONAL_BACKUP_FILES. The two lists are
    // coupled ONLY by the literal filename strings matching. If an OPTIONAL entry drifts from the map
    // (a typo, or a map rename like reminder_vehicles.csv → reminders_vehicles.csv without updating the
    // OPTIONAL set), the stale OPTIONAL string filters out NOTHING → that genuinely-optional file becomes
    // REQUIRED → parseZipBackup rejects a valid older backup missing it ("Missing required files"), so the
    // user can't recover their own data (NORTH_STAR #1). Pin OPTIONAL ⊆ map-values so the two can't drift.
    const mapValues = new Set(Object.values(TABLE_FILENAME_MAP));
    const orphans = [...OPTIONAL_BACKUP_FILES].filter((f) => !mapValues.has(f));
    expect(
      orphans,
      `OPTIONAL_BACKUP_FILES entr(ies) not present in TABLE_FILENAME_MAP — a stale/typo'd optional ` +
        `filename makes a real backup file REQUIRED, failing restore of a valid older backup that omits ` +
        `it (NORTH_STAR #1). Keep OPTIONAL_BACKUP_FILES a subset of the map's values:\n${orphans.join('\n')}`
    ).toEqual([]);
  });

  // The fourth guard — createBackup()'s emitted keys vs the registry — runs the real service
  // against a seeded DB, so it lives in its own file (backup-createbackup-keys.test.ts) under
  // the createTestApp harness, to avoid mixing DB-bound and pure tests in one process.
});
