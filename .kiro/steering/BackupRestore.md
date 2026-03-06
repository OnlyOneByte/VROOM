---
inclusion: fileMatch
fileMatchPattern: "backend/src/api/sync/backup.ts,backend/src/api/sync/restore.ts"
---

# Backup & Restore

## CSV Type Coercion

Backup files are ZIP archives containing CSV files. CSV parsing returns all values as strings. The `coerceCSVRow` method in `BackupService` converts string values to proper types (Date, boolean, number) using Drizzle column metadata before Zod validation runs.

When adding new columns to the schema:
- `SQLiteTimestamp` columns are coerced from ISO date strings to `Date` objects
- `SQLiteBoolean` columns are coerced from `"true"`/`"1"`/`"TRUE"` to `boolean`
- `SQLiteInteger` columns are coerced from string to `number` via `parseInt`
- `SQLiteReal` columns are coerced from string to `number` via `parseFloat`
- Empty strings, `"null"`, `"NULL"`, `"undefined"` are coerced to `null`

These column type names (`SQLiteTimestamp`, `SQLiteBoolean`, `SQLiteInteger`, `SQLiteReal`) come from Drizzle's runtime `columnType` property on `getTableColumns()`. They do not match the TypeScript-level `mode` config (e.g., `integer('col', { mode: 'timestamp' })` produces `columnType: 'SQLiteTimestamp'`, not `SQLiteInteger`).

## Validation Pipeline

1. `parseZipBackup` extracts CSV files and runs `coerceCSVRow` on each row using the corresponding Drizzle table schema
2. `validateBackupData` runs `createInsertSchema(table)` from `drizzle-zod` against the coerced data
3. `restoreFromBackup` in `restore.ts` has its own `convertRow`/`convertValue` for the actual DB insert — this is a separate layer from validation coercion

Do not attempt to use `createInsertSchema` overrides for CSV coercion — `drizzle-zod` v0.8+ with Zod v4 does not reliably apply field-level overrides. Coerce at parse time instead.

## Adding New Tables to Backup

1. Add the table to `TABLE_SCHEMA_MAP` and `TABLE_FILENAME_MAP` in `backend/src/config.ts`
2. Add the corresponding type to `ParsedBackupData` in `backend/src/types.ts`
3. Update `createBackup` to query the new table
4. Update `restoreFromBackup` in `restore.ts` to insert and delete the new table's data
5. Update `validateReferentialIntegrity` if the new table has foreign keys
6. `coerceCSVRow` and validation handle new columns automatically via Drizzle column metadata — no manual field mapping needed
