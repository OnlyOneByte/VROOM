# Backup & Restore

## Row Type Coercion

A backup is a ZIP holding `metadata.json` plus one CSV per table, and CSV parsing returns every value
as a string. The exported `coerceRow` in `backup.ts` converts those strings to real JS types using
Drizzle column metadata. Both restore paths share it — the ZIP path via `parseZipBackup`, the Sheets
path via `restoreFromSheets` — and there is no second conversion layer.

Branches key on Drizzle's runtime `columnType`, each set listing both SQLite and Pg names:

- timestamp → `new Date(value)`; an invalid date becomes `null`
- boolean → `true` only for `"true"`, `"1"`, `"TRUE"`
- JSON text → `JSON.parse`; a parse failure becomes `null`
- integer and real → comma-stripped `Number()`, non-numeric → `null`; integer also `Math.round`s.
  Never `parseInt`/`parseFloat` here — both stop at the first separator, so a Sheets-formatted
  `"12,345"` odometer truncates to `12` without ever being `NaN`.
- `""`, `"null"`, `"NULL"`, `"undefined"` → `null`, with two exceptions: boolean → `false`, and a
  NOT NULL column carrying a static `default` resolves to that default. Writing `null` there fails
  the insert and aborts the entire restore, so the user cannot recover any data.

`columnType` is the runtime property, not the TypeScript-level `mode` config:
`integer('col', { mode: 'timestamp' })` yields `SQLiteTimestamp`, not `SQLiteInteger`.

## Backup Versions

`metadata.version` records the format a backup was written in (`CONFIG.backup.currentVersion`,
`2.0.0` today), and restore keeps it as written. `backupVersionError` in `backup.ts` accepts any
older version, and the current major with a minor at or below the current one. It refuses a newer
version with a message telling the user to update VROOM.

An older backup reaches the current shape through `BACKUP_UPGRADE_STEPS`, an ordered list of
`{ to, upgrade(tables) }`. `upgradeBackupTables` runs every step whose `to` is newer than the
backup, on the raw rows, before `coerceRow`. Both restore paths call it: `parseZipBackup`, and
`restoreFromSheets` with the mirror's version.

The one step today is the move to cents: money columns are integer cents, and a pre-2.0.0
backup stored dollar floats, so the `2.0.0` step multiplies the `MONEY_CENTS_FIELDS` columns by
100. `coerceRow` then rounds them, since float products such as 12.34 × 100 land just below the
integer.

A Sheets mirror records its version in a `Metadata` tab, written last on every sync. A mirror
without the tab was last synced by an older build: it counts as 1.x dollars only when its
Expenses header row is present and lacks `createdBy` (added in the same release as cents), and as
cents otherwise. Never infer the unit from cell values: one hand-edited `45.50` would rescale
every amount.

### Changing the format

1. Bump `currentVersion`: the minor for an addition an older backup can do without, the major
   for anything that needs an upgrade step to read old data.
2. Add a `BACKUP_UPGRADE_STEPS` entry when old rows need changing to fit. A column an older
   backup lacks needs none: `coerceRow` falls back to the schema default.
3. Add a frozen fixture for the new version next to
   `backend/src/api/sync/__tests__/fixtures/backup-2.0.0/`, and never edit an existing one:
   `backup-format-fixture.test.ts` pins the 2.0.0 fixture's hash and checks it still restores,
   and a new fixture gets the same two tests.

## Validation Pipeline

1. `parseZipBackup` — compression-ratio and uncompressed-size guards, required-file check, CSV parse,
   `upgradeBackupTables`, then `coerceRow` per row.
2. `validateBackupData` — metadata and `backupVersionError`, then `createInsertSchema(table)` per row, then
   `validateReferentialIntegrity` (which also runs `validateUniqueConstraints`).
3. `restoreFromBackup` — wipe (replace mode only) and insert in ONE synchronous `db.transaction`.

All validation runs before the replace-mode wipe; it is the only thing between a corrupt download and
an emptied account. Keep the transaction callback and its helpers synchronous — an async callback
leaves the wipe committed when an insert throws.

Coerce at parse time rather than through `createInsertSchema` field overrides: `TABLE_SCHEMAS` is
deliberately bare `createInsertSchema(table)`, so both restore paths share one coercion layer.

## Adding a Table to the Backup

1. `TABLE_SCHEMA_MAP` and `TABLE_FILENAME_MAP` in `backend/src/config.ts`, plus its file in
   `OPTIONAL_BACKUP_FILES`: backups written before the table existed lack that CSV, and the
   required-file check would refuse them.
2. `ParsedBackupData` in `backend/src/types.ts`, and an `ImportSummary` count in `restore.ts`.
3. `createBackup` query, `insertBackupData` insert (FK parents first), `deleteUserData` delete.
4. `SHEET_HEADERS` in `google-sheets-service.ts` — hand-maintained, unlike the schema-derived CSV
   columns; a missing header silently drops the column from a Sheets backup.
5. `validateReferentialIntegrity` / `validateUniqueConstraints` if the table has foreign keys or a
   unique index, and a `detectConflicts` probe unless it is a child of an already-probed parent.

New *columns* need no manual mapping — CSV headers, coercion, and Zod validation all derive from
Drizzle metadata. New *tables* do. The invariant is that every table round-trips, and committed guards
enforce it: `backup-table-coverage`, `restore-table-coverage`, `backup-ref-validation-coverage`, and
`backup-unique-constraint-coverage` in `backend/src/api/sync/__tests__/`, plus
`sheets-header-coverage.test.ts` under `providers/services/__tests__/`, all fail when a list above
drifts from the schema. A table that should not be backed up belongs on `backup-table-coverage`'s
`EXCLUDED_BY_DESIGN` allowlist, with a reason.
