---
inclusion: fileMatch
fileMatchPattern: "backend/src/db/schema.ts"
---

# Database Migration SOP

When `backend/src/db/schema.ts` is modified, follow these steps to create a migration.

## Steps

1. Make changes to `backend/src/db/schema.ts`
2. Generate a migration from the `backend/` directory:
   ```
   bun run db:generate
   ```
   This creates a new SQL file in `backend/drizzle/` and updates `backend/drizzle/meta/_journal.json`.
3. Review the generated SQL file to confirm it matches your intent. Drizzle may infer destructive operations (e.g., `DROP TABLE`) if a table was removed from the schema — verify before committing.
4. The migration runs automatically on startup via `runMigrations()` in `backend/src/db/connection.ts`. No manual apply step is needed.
5. Commit the new migration SQL file, snapshot, and updated `_journal.json` alongside the schema change.

## Rules

- Never use `bun run db:push` for schema changes. Always use `bun run db:generate` so migrations are tracked and reproducible.
- Never manually edit generated migration SQL files. If the generated migration is wrong, fix the schema and regenerate.
- Never delete migration files once committed. Migrations are append-only. If you need to undo a change, create a new migration that reverses it.
- The `__drizzle_migrations` table in SQLite tracks which migrations have been applied. Do not manually modify it unless recovering from a `db:push` bootstrapped database.

## Testing Migrations

Migration tests live in `backend/src/db/__tests__/` and use in-memory SQLite — no disk, no app startup, fast.

### File structure

- `migration-helpers.ts` — shared utilities (`loadMigrations`, `applyMigration`, `applyMigrationsUpTo`, `getTables`, `getColumnNames`, `getIndexNames`, `countRows`, `seedCoreData`)
- `migration-general.test.ts` — tests that apply to the full migration set (sequential apply, FK cascades)
- `migration-0000.test.ts` — tests for migration 0000 (initial schema)
- `migration-0001.test.ts` — tests for migration 0001 (photos table)

### What the tests cover

- Each migration applies cleanly to a fresh database
- All migrations apply in sequence without conflicts
- Seed data inserted before a migration survives after it runs
- NOT NULL constraints and indexes are present on new tables
- Foreign key cascades work as expected

### When adding a new migration

Create a new file `migration-000N.test.ts` following this pattern:

```typescript
import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  applyMigration,
  applyMigrationsUpTo,
  countRows,
  getColumnNames,
  getTables,
  loadMigrations,
  seedCoreData,
} from './migration-helpers';

describe('Migration 000N: Description', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  test('creates new_table', () => {
    applyMigrationsUpTo(db, migrations, N);
    expect(getTables(db)).toContain('new_table');
  });

  test('seed data survives this migration', () => {
    applyMigrationsUpTo(db, migrations, N - 1);
    seedCoreData(db);
    expect(countRows(db, 'users')).toBe(1);

    applyMigration(db, migrations[N]);
    expect(countRows(db, 'users')).toBe(1);
  });
});
```

Also add the new table to the expected tables list in `migration-general.test.ts`.

### Running migration tests

```bash
bun test src/db/__tests__/migration-general.test.ts src/db/__tests__/migration-000N.test.ts
```

They also run as part of `bun run validate`.

## Backup / Restore / Sync Impact

Schema changes affect the backup, restore, and Google Sheets sync pipeline. When adding or modifying tables or columns, check and update these files:

| File | What to update |
|---|---|
| `backend/src/config.ts` | Add new tables to `TABLE_SCHEMA_MAP` and `TABLE_FILENAME_MAP`. If the table may be absent in older backups, add its filename to `OPTIONAL_BACKUP_FILES`. |
| `backend/src/types.ts` | Add the new data field to `BackupData` and `ParsedBackupData` interfaces. |
| `backend/src/api/sync/backup.ts` | Export the new table's data in `createBackup()`. Add CSV column output in `exportAsZip()`. Validate referential integrity in `validateReferentialIntegrity()`. |
| `backend/src/api/sync/restore.ts` | Insert the new table's data in `insertBackupData()`. Delete it in `deleteUserData()` if applicable. Update `ImportSummary` type. |
| `backend/src/api/sync/google-sheets.ts` | Add headers function, new sheet in `createSpreadsheet()`, export in `updateSpreadsheetWithUserData()`, read in `readSpreadsheetData()`. |

### Column type considerations

- `NOT NULL` boolean columns (e.g., `missedFillup`, `isFinancingPayment`): CSV empty values are coerced to `false` by `coerceRow()`. If you add a new `NOT NULL` boolean column, verify that `coerceRow` handles it — the generic `SQLiteBoolean` branch already does this, but confirm with a backup round-trip test.
- `NOT NULL` columns with defaults: Drizzle's `createInsertSchema()` may not accept `null` even if the DB column has a default. Ensure `coerceRow` produces a valid value, not `null`, for these columns.
- JSON columns: `coerceRow` parses JSON strings. If you add a new JSON column, ensure the backup CSV serializes it as a JSON string (not `[object Object]`).

### Testing

Backup round-trip tests live in `backend/src/api/sync/__tests__/backup.test.ts`. When adding new tables or columns, add tests that verify:
- `coerceRow` produces valid values for the new column types (especially NOT NULL booleans and JSON)
- `validateBackupData` accepts properly coerced rows
- `validateBackupData` rejects rows with invalid data for the new columns

## Production Considerations

- Both local and prod run `runMigrations()` on startup. New migrations deploy automatically with the next container build.
- The Dockerfile copies `backend/drizzle/` into the prod image, so migration files must be committed to git.
- If prod was bootstrapped with `db:push` (no migration history), you must manually insert the migration hash into `__drizzle_migrations` before deploying new migrations. Use: `sqlite3 /app/data/vroom.db "INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('<sha256>', <timestamp>);"` — get the hash with `shasum -a 256 <migration_file>` and the timestamp from `_journal.json`.
