---
inclusion: fileMatch
fileMatchPattern: "backend/src/db/schema.ts"
---

# Database Migration SOP

A `backend/src/db/schema.ts` change is not done until a migration exists for it.

## Generating a migration

From `backend/`:

```
bun run db:generate
```

This writes `backend/drizzle/000N_*.sql`, `backend/drizzle/meta/000N_snapshot.json`, and an entry
in `backend/drizzle/meta/_journal.json`. Commit all three with the schema change.

Review the generated SQL before committing:

- drizzle-kit infers destructive statements (`DROP TABLE`, `DROP COLUMN`) from anything absent
  from the schema.
- It diffs against the **highest-numbered snapshot present in `meta/`**, so that snapshot must
  describe the current `schema.ts` — otherwise a generate re-emits DDL that already shipped. A
  hand-written DDL migration therefore needs a hand-written snapshot too (a data-only migration
  changes no schema and needs none). `migration-general.test.ts` guards the snapshot chain. With
  the chain intact, `db:generate` on an unchanged schema writes nothing and prints "No schema
  changes, nothing to migrate".

`runMigrations()` in `backend/src/db/connection.ts` applies pending migrations at every startup —
local `bun run dev`, prod, and `createTestApp()`. There is no manual apply step; `bun run db:init`
just invokes it standalone (plus `--seed` via `bun run db:seed`).

## Rules

- **Never `bun run db:push`.** It diffs the live DB and applies the diff with no row in
  `__drizzle_migrations`, so the database and the migration folder silently disagree; with
  `strict: true` in `drizzle.config.ts` it also prompts to drop whatever it believes you removed.
- Never hand-edit a *generated* migration. Fix the schema and regenerate.
- Migrations are append-only. Never delete or renumber a committed migration; reverse it with a
  new one.
- Drizzle decides what to apply by comparing each `_journal.json` `when` against the newest
  `created_at` in `__drizzle_migrations`, and applies everything greater. A hand-written migration
  (a data backfill like `0009_money_to_cents` that drizzle-kit cannot generate) therefore needs a
  journal entry whose `when` is higher than the previous entry's — a lower one is skipped forever
  on any DB that stops at the preceding migration.
- Do not modify `__drizzle_migrations` by hand except to recover a DB bootstrapped by `db:push`
  (see Production).

## Testing migrations

Tests live in `backend/src/db/__tests__/` and apply raw SQL to an in-memory SQLite DB — no disk,
no app startup. `migration-helpers.ts` provides `loadMigrations`, `applyMigration`,
`applyMigrationsUpTo`, `getTables`, `getColumnNames`, `getIndexNames`, `countRows`, `seedCoreData`.
`migration-general.test.ts` applies the full set in sequence, asserts the resulting table list
against the one derived from `schema.ts` itself (set equality both ways, so no hand-maintained
list to update) plus FK cascades, and checks the journal/snapshot bookkeeping.
`migration-000N.test.ts` covers one migration each, including the hand-written and data-only
ones; `migration-general.test.ts` fails by tag on any migration missing its file.

For a new migration, add `migration-000N.test.ts` asserting that it applies cleanly, that new
constraints/indexes exist, and that data seeded by `seedCoreData` after
`applyMigrationsUpTo(db, migrations, N - 1)` survives `applyMigration(db, migrations[N])`.

```bash
bun test src/db/__tests__/          # or the whole suite via `bun run validate`
```

## Backup / restore / sync impact

Every table and column is exported, validated, and restored through hand-maintained lists. Run
`bun test src/api/sync src/api/providers` after a schema change — drift guards
(`backup-table-coverage`, `restore-table-coverage`, `sheets-header-coverage`) fail by name on each
list you missed. What they point at:

| File | What to update |
|---|---|
| `backend/src/config.ts` | `TABLE_SCHEMA_MAP` + `TABLE_FILENAME_MAP`. A new table's CSV must also go in `OPTIONAL_BACKUP_FILES` — existing backups do not contain it, and a required-but-absent file fails the whole restore. |
| `backend/src/types.ts` | `BackupData` and `ParsedBackupData`. |
| `backend/src/api/sync/backup.ts` | Query the table in `createBackup()`; emit its CSV in `exportAsZip()`; check its FKs in `validateReferentialIntegrity()`. |
| `backend/src/api/sync/restore.ts` | `insertBackupData()` (FK order), `deleteUserData()`, and the per-table count in `ImportSummary`. |
| `backend/src/api/providers/services/google-sheets-service.ts` | `SHEET_HEADERS` (one entry per table, covering every column) and `SHEET_NAMES` (tab roster, consumed by both `createSpreadsheet` and `ensureRequiredSheets`). The `updateSpreadsheetWithUserData()` write fan-out and `readSpreadsheetData()` read ranges are both per-table; only the write side has a drift guard. |

`coerceRow()` in `backup.ts` derives CSV-string → JS-value coercion from Drizzle column metadata,
so most new columns need no mapping. Two cases to confirm with a round-trip test:

- `NOT NULL` boolean (e.g. `expenses.missedFillup`): empty CSV cells coerce to `false` via the
  generic `SQLiteBoolean` branch, and `createInsertSchema()` may reject `null` even when the column
  has a DB default.
- JSON column: `coerceRow` parses JSON strings, so the export must serialize the value as JSON,
  not `[object Object]`.

Round-trip tests live in `backend/src/api/sync/__tests__/`. See `.kiro/steering/BackupRestore.md`
for the coercion and validation pipeline in detail.

## Production

- Prod runs `runMigrations()` on startup, so migrations deploy with the next container build.
  `backend/Dockerfile` copies `backend/drizzle/` into the image — uncommitted migration files do
  not ship.
- Recovering a DB bootstrapped with `db:push` (no migration history): insert the already-applied
  migrations' rows before deploying new ones. The prod image ships no `sqlite3` binary, so run this
  against the mounted volume from the host.
  ```
  sqlite3 /app/data/vroom.db "INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('<sha256>', <when>);"
  ```
  `<sha256>` is `shasum -a 256 <migration_file>` and `<when>` is that migration's `when` from
  `_journal.json`. Only the highest `created_at` is consulted, so it gates every lower-numbered
  migration too.
