---
name: Add Database Table
description: End-to-end guide for adding a new table to the SQLite database — schema, migration, backup/restore, and tests.
---

# Add Database Table

Use this skill when adding a new table to the VROOM database. It touches schema, migrations,
backup/restore, config, types, and tests — a table that lands in only some of those silently loses
a user's data on backup or restore.

Detail lives in two steering docs, both of which auto-load on the files they describe:
`.kiro/steering/DatabaseMigrations.md` (generation, journal, migration tests) and
`.kiro/steering/BackupRestore.md` (coercion, validation pipeline, the backup lists).

## Steps

### 1. Define the table

`backend/src/db/schema.ts`. Follow the surrounding tables: `createId()` primary key,
`onDelete: 'cascade'` foreign keys, `$defaultFn(() => new Date())` timestamps, and exported
`$inferSelect` / `$inferInsert` types.

Column types:

| Declaration | Stores |
|---|---|
| `text('col')` | string |
| `integer('col')` | number |
| `real('col')` | float |
| `integer('col', { mode: 'boolean' })` | boolean as 0/1 |
| `integer('col', { mode: 'timestamp' })` | `Date` as unix epoch ms |
| `text('col', { mode: 'json' }).$type<T>()` | JSON as text |

**Money is `integer` CENTS**, never `real` — migration 0009 converted all of it. A new money column
must also be added to `MONEY_CENTS_FIELDS` in `backend/src/api/sync/backup.ts`, or restoring a
pre-2.0.0 backup stores it 100× low. `money-cents-fields-guard.test.ts` pins that set against a
hand-maintained mirror, so update `EXPECTED_MONEY_FIELDS` there in the same change. `real` is for
genuine non-money quantities (`apr` percent, `volume` gallons/kWh, `businessMileageRate`).

### 2. Generate the migration

```bash
bun run db:generate   # from backend/
```

Review the generated SQL before committing — drizzle-kit diffs against the highest-numbered
snapshot in `drizzle/meta/`, so it re-emits DDL for any hand-written DDL migration that has none.
See `DatabaseMigrations.md`; never `db:push`.

Commit all three artifacts together: `drizzle/000N_*.sql`, `drizzle/meta/000N_snapshot.json`, and
the `drizzle/meta/_journal.json` entry. The snapshot is the easiest of the three to leave behind
and the one that bites later — without it the next `db:generate` diffs against a pre-your-table
schema and re-emits your `CREATE TABLE`.

### 3. Migration test

`backend/src/db/__tests__/migration-000N.test.ts`, with `Database` from `bun:sqlite` and the
helpers from `./migration-helpers`:

```typescript
describe('Migration 000N: Add new_table', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
  });
  afterEach(() => db.close());

  test('creates new_table with the expected columns', () => {
    applyMigrationsUpTo(db, migrations, N);
    expect(getTables(db)).toContain('new_table');
    expect(getColumnNames(db, 'new_table')).toContain('vehicle_id');
  });

  test('seed data survives this migration', () => {
    applyMigrationsUpTo(db, migrations, N - 1);
    seedCoreData(db);
    applyMigration(db, migrations[N]);
    expect(countRows(db, 'vehicles')).toBe(1);
  });

  test('deleting the parent cascades to new_table rows', () => {
    /* insert referencing the seeded vehicle, delete the vehicle, assert the row is gone */
  });
});
```

`migration-general.test.ts` needs no edit — it derives the expected table list from `schema.ts`
itself. It does require the `migration-000N.test.ts` file above to exist.

### 4. Backup/restore

Every table round-trips through hand-maintained lists. Work the checklist in
`BackupRestore.md` → "Adding a Table to the Backup":

| File | Update |
|---|---|
| `backend/src/config.ts` | `TABLE_SCHEMA_MAP`, `TABLE_FILENAME_MAP`, and `OPTIONAL_BACKUP_FILES` — existing backups lack the new CSV, and a required-but-absent file fails the whole restore |
| `backend/src/types.ts` | `BackupData` **and** `ParsedBackupData` |
| `backend/src/api/sync/backup.ts` | query it in `createBackup()`; `validateReferentialIntegrity()` if it has FKs; `validateUniqueConstraints()` if it has a unique index |
| `backend/src/api/sync/restore.ts` | `insertBackupData()` (FK parents first), `deleteUserData()`, its `ImportSummary` count, and a `detectConflicts()` probe unless it is a child of an already-probed parent |
| `backend/src/api/providers/services/google-sheets-service.ts` | `SHEET_HEADERS` (every column) and `SHEET_NAMES` |

A table that should *not* be backed up goes on `EXCLUDED_BY_DESIGN` in
`backup-table-coverage.test.ts` with a reason. Run `bun test src/api/sync src/api/providers` — the
drift guards there name every list still missing it.

A new *column* on an existing table needs far less: CSV headers, Zod validation, and `coerceRow()`'s
string → JS coercion all derive from Drizzle metadata. It still needs a `SHEET_HEADERS` entry, which
is hand-maintained — a missing header silently drops the column from every Sheets backup. The
coercion rules and the two cases worth a round-trip test (`NOT NULL` boolean, JSON) are in
`BackupRestore.md`.

### 5. Validate

```bash
bun run validate   # from backend/
```

## Verification Checklist

- [ ] Table in `schema.ts` with types, defaults, FKs; `$inferSelect`/`$inferInsert` exported
- [ ] Money columns are `integer` cents and listed in `MONEY_CENTS_FIELDS`
- [ ] Migration generated and its SQL reviewed; `.sql`, `meta/000N_snapshot.json` and the
      `_journal.json` entry all committed
- [ ] `migration-000N.test.ts` added
- [ ] All five backup/restore files above updated (or `EXCLUDED_BY_DESIGN`, with a reason)
- [ ] `bun test src/api/sync src/api/providers` green — no drift guard naming the table
- [ ] `bun run validate` passes
