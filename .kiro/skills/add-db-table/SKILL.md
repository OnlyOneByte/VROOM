---
name: Add Database Table
description: End-to-end guide for adding a new table to the SQLite database — schema, migration, backup/restore, and tests.
---

# Add Database Table

Use this skill when adding a new table to the VROOM database. This touches schema, migrations, backup/restore, config, types, and tests.

## Steps

### 1. Define the Table in Schema

File: `backend/src/db/schema.ts`

```typescript
export const newTable = sqliteTable('new_table', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  // Foreign key to parent
  vehicleId: text('vehicle_id')
    .notNull()
    .references(() => vehicles.id, { onDelete: 'cascade' }),
  // Fields
  name: text('name').notNull(),
  amount: real('amount'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  date: integer('date', { mode: 'timestamp' }).notNull(),
  // JSON column
  metadata: text('metadata', { mode: 'json' }).$type<MetadataType>(),
  // Timestamps
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// Export types
export type NewEntity = typeof newTable.$inferSelect;
export type NewNewEntity = typeof newTable.$inferInsert;
```

Column type reference:
- `text('col')` — string
- `integer('col')` — number
- `real('col')` — float
- `integer('col', { mode: 'boolean' })` — boolean stored as 0/1
- `integer('col', { mode: 'timestamp' })` — Date stored as unix epoch ms
- `text('col', { mode: 'json' }).$type<T>()` — JSON stored as text

### 2. Generate the Migration

From `backend/` directory:
```bash
bun run db:generate
```

This creates:
- `backend/drizzle/000N_<name>.sql` — the migration SQL
- `backend/drizzle/meta/000N_snapshot.json` — schema snapshot
- Updates `backend/drizzle/meta/_journal.json`

Review the generated SQL. Verify:
- CREATE TABLE matches your intent
- No unintended DROP TABLE operations
- Foreign keys and indexes are correct

### 3. Create Migration Test

File: `backend/src/db/__tests__/migration-000N.test.ts`

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

describe('Migration 000N: Add new_table', () => {
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

  test('new_table has expected columns', () => {
    applyMigrationsUpTo(db, migrations, N);
    const columns = getColumnNames(db, 'new_table');
    expect(columns).toContain('id');
    expect(columns).toContain('vehicle_id');
    // ... check all columns
  });

  test('seed data survives this migration', () => {
    applyMigrationsUpTo(db, migrations, N - 1);
    seedCoreData(db);
    expect(countRows(db, 'users')).toBe(1);
    expect(countRows(db, 'vehicles')).toBe(1);

    applyMigration(db, migrations[N]);
    expect(countRows(db, 'users')).toBe(1);
    expect(countRows(db, 'vehicles')).toBe(1);
  });

  test('foreign key cascade deletes new_table rows', () => {
    applyMigrationsUpTo(db, migrations, N);
    seedCoreData(db);
    // Insert a row in new_table referencing the seeded vehicle
    // Delete the vehicle
    // Verify new_table row is gone
  });
});
```

### 4. Update migration-general.test.ts

Add the new table to the expected tables list in the "all tables exist" test.

### 5. Update Config for Backup/Restore

File: `backend/src/config.ts`

```typescript
import { newTable } from './db/schema';

// Add to TABLE_SCHEMA_MAP
export const TABLE_SCHEMA_MAP = {
  // ... existing entries
  newEntity: newTable,
};

// Add to TABLE_FILENAME_MAP
export const TABLE_FILENAME_MAP = {
  // ... existing entries
  newEntity: 'new_table.csv',
};
```

### 6. Update Types

File: `backend/src/types.ts`

Add the new table's data to `ParsedBackupData`:
```typescript
export interface ParsedBackupData {
  // ... existing fields
  newEntity: NewEntity[];
}
```

### 7. Update Backup Service

File: `backend/src/api/sync/backup.ts`

Add a query for the new table in `createBackup()`.

### 8. Update Restore Service

File: `backend/src/api/sync/restore.ts`

- Add delete + insert logic for the new table in `restoreFromBackup()`
- Respect foreign key ordering: delete child tables first, insert parent tables first
- Update `validateReferentialIntegrity()` if the table has foreign keys

### 9. Run Validation

```bash
# From backend/
bun run all:fix
bun run validate
```

## Column Type ↔ CSV Coercion Reference

When backup CSV files are parsed, `coerceCSVRow` in `backup.ts` handles type conversion automatically based on Drizzle column metadata:

| Drizzle Column | `columnType` | CSV String → |
|---|---|---|
| `integer('col', { mode: 'timestamp' })` | `SQLiteTimestamp` | `Date` via `new Date(value)` |
| `integer('col', { mode: 'boolean' })` | `SQLiteBoolean` | `boolean` via `"true"/"1" → true` |
| `integer('col')` | `SQLiteInteger` | `number` via `parseInt` |
| `real('col')` | `SQLiteReal` | `number` via `parseFloat` |
| `text('col')` | `SQLiteText` | stays `string` |
| `text('col', { mode: 'json' })` | `SQLiteTextJson` | `JSON.parse()` |

No manual coercion code needed for standard column types.

## Verification Checklist

- [ ] Table defined in `schema.ts` with proper types, defaults, and foreign keys
- [ ] Types exported (`$inferSelect` and `$inferInsert`)
- [ ] Migration generated with `bun run db:generate`
- [ ] Generated SQL reviewed for correctness
- [ ] Migration test created (`migration-000N.test.ts`)
- [ ] `migration-general.test.ts` updated with new table
- [ ] `TABLE_SCHEMA_MAP` updated in `config.ts`
- [ ] `TABLE_FILENAME_MAP` updated in `config.ts`
- [ ] `ParsedBackupData` type updated in `types.ts`
- [ ] `createBackup()` queries the new table
- [ ] `restoreFromBackup()` handles delete + insert
- [ ] `validateReferentialIntegrity()` updated if FK exists
- [ ] `bun run validate` passes
