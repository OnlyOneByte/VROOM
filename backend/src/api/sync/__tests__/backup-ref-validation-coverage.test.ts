/**
 * Referential-integrity-validation coverage drift guard — the FIFTH backup round-trip guard,
 * companion to backup-table-coverage (C208) + restore-table-coverage (C209).
 *
 * Those four guards pin the SHAPE of the round-trip: every schema table is serialized
 * (TABLE_SCHEMA_MAP), populated (createBackup keys), restored (insertBackupData), summarized
 * (ImportSummary), and conflict-probed (detectConflicts). What NONE of them pins is whether a
 * backed-up table's FOREIGN KEYS are validated before restore commits.
 *
 * Why that gap is data-loss-class (the #127/C428 family, FK variant): replace-mode restore WIPES
 * the account, then inserts. validateReferentialIntegrity runs on the parsed backup BEFORE the
 * wipe — it is the gate that rejects a corrupt/truncated download whose child rows point at
 * absent parents. bun-sqlite's async-transaction callback does NOT roll back a thrown insert (the
 * C151 footgun), so if a backed-up FK-bearing table has NO ref-validator, a backup with a dangling
 * FK passes validation → the wipe commits → the insert throws a raw FK error mid-transaction →
 * the account is left EMPTY (NORTH_STAR #1: the user cannot recover their own data). Under
 * autonomous development a new FK-bearing table can pass all four existing guards (it IS serialized,
 * restored, summarized, probed) yet silently lack a ref-validator. This guard forces the decision.
 *
 * Mechanism (non-vacuous, schema-derived — NOT a re-implementation, the C181/C229 trap):
 *   - The set of tables that NEED a validator is derived at RUNTIME from the real Drizzle schema
 *     (getTableConfig().foreignKeys), so a newly-added FK is picked up automatically.
 *   - FKs to a parent that is itself NOT backed up (users, user_providers, sessions — the
 *     EXCLUDED_BY_DESIGN set) are skipped: their parent rows are never in the backup, so they
 *     cannot be cross-validated against it (photoRefs.providerId is the live example — its
 *     user_providers FK is deliberately un-validated because encrypted creds are never exported;
 *     its photos FK still requires + has a validator).
 *   - "Has a validator" = validateReferentialIntegrity's source body references `backup.<key>`,
 *     the canonical join (the method dispatches each per-table validator on backup.<registryKey>).
 *
 * Pure source/shape introspection over the REAL config + schema + backup.ts source — no DB, no
 * createTestApp (so no DB-singleton import trap).
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

// Parent tables that are NOT in any backup (mirrors EXCLUDED_BY_DESIGN in backup-table-coverage):
// a child's FK to one of these cannot be cross-validated against backup data because the parent
// rows are never exported. users → restore stamps the requesting user; user_providers → encrypted
// credentials, never exported; sessions → ephemeral auth.
const NON_BACKED_UP_PARENTS = new Set(['users', 'user_providers', 'sessions']);

/** The validateReferentialIntegrity method body (where each per-table validator is dispatched on backup.<key>). */
function refIntegrityBody(): string {
  const start = BACKUP_SRC.indexOf('private validateReferentialIntegrity(');
  expect(start, 'validateReferentialIntegrity should exist in backup.ts').toBeGreaterThan(-1);
  // The next private method ends it (validateUniqueConstraints immediately follows in source).
  const end = BACKUP_SRC.indexOf('private validateUniqueConstraints(', start);
  expect(
    end,
    'validateUniqueConstraints should follow validateReferentialIntegrity'
  ).toBeGreaterThan(start);
  return BACKUP_SRC.slice(start, end);
}

describe('backup referential-integrity validation coverage (drift guard — cycle 290)', () => {
  test('every backed-up table with a FK to ANOTHER backed-up table is referenced by validateReferentialIntegrity', () => {
    const body = refIntegrityBody();
    const missing: string[] = [];

    for (const [key, table] of Object.entries(TABLE_SCHEMA_MAP)) {
      const cfg = getTableConfig(table);
      // The parent table names this table's FKs point at, excluding non-backed-up parents.
      const crossBackupFkParents = [
        ...new Set(
          cfg.foreignKeys
            .map((fk) => getTableName(fk.reference().foreignTable))
            .filter((parent) => !NON_BACKED_UP_PARENTS.has(parent))
        ),
      ];
      if (crossBackupFkParents.length === 0) continue; // no cross-backup FK → nothing to validate

      // The validator is dispatched on `backup.<key>` (the registry key === ParsedBackupData key).
      // Use a word-boundary match so `backup.insurance` does NOT satisfy `backup.insuranceTerms`.
      const referenced = new RegExp(`backup\\.${key}\\b`).test(body);
      if (!referenced) {
        missing.push(`${key} (FK → ${crossBackupFkParents.join(', ')})`);
      }
    }

    expect(
      missing,
      `Backed-up table(s) with a foreign key to another backed-up table that validateReferentialIntegrity ` +
        `never inspects. A corrupt backup with a dangling FK on one of these would PASS validation, then throw ` +
        `a raw FK error mid-restore AFTER the replace-mode wipe — leaving the account empty (the #127/C428 ` +
        `data-loss class, FK variant; NORTH_STAR #1). Add a validate<Table>Refs(...) call on backup.<key> in ` +
        `validateReferentialIntegrity:\n${missing.join('\n')}`
    ).toEqual([]);
  });

  test('the FK-introspection actually finds cross-backup FKs (anti-vacuity)', () => {
    // Guard against the guard silently passing because the introspection found NOTHING (e.g. a drizzle
    // API change making cfg.foreignKeys empty). At least the known FK-bearing children must be detected,
    // so an always-[] introspection can't make the coverage test pass trivially.
    const withCrossBackupFk = Object.entries(TABLE_SCHEMA_MAP)
      .filter(([, table]) =>
        getTableConfig(table)
          .foreignKeys.map((fk) => getTableName(fk.reference().foreignTable))
          .some((parent) => !NON_BACKED_UP_PARENTS.has(parent))
      )
      .map(([key]) => key);

    // expenses→vehicles, financing→vehicles, odometer→vehicles, trips→vehicles, the insurance/reminder
    // junctions, etc. are real cross-backup FKs — the set must be non-trivial.
    expect(withCrossBackupFk).toContain('expenses');
    expect(withCrossBackupFk).toContain('trips');
    expect(withCrossBackupFk).toContain('reminderVehicles');
    expect(withCrossBackupFk.length).toBeGreaterThanOrEqual(8);
  });

  test('userId-PK-only tables (userPreferences, syncState) are NOT required to have a ref-validator', () => {
    // These two are PK = userId with no other FK (their only .references is userId → users, a
    // non-backed-up parent). They correctly have no entry in validateReferentialIntegrity. This pins
    // that the guard does not falsely demand one (and documents the earlier false-positive: a naive
    // regex over schema.ts that ran past the table body into the adjacent relations() block reported a
    // phantom vehicles FK on both — runtime getTableConfig is the truth).
    for (const key of ['userPreferences', 'syncState']) {
      const cfg = getTableConfig(TABLE_SCHEMA_MAP[key]);
      const crossBackupFks = cfg.foreignKeys
        .map((fk) => getTableName(fk.reference().foreignTable))
        .filter((parent) => !NON_BACKED_UP_PARENTS.has(parent));
      expect(crossBackupFks, `${key} should have no cross-backup FK`).toEqual([]);
    }
  });
});
