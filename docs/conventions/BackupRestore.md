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
`3.0.0` today), and restore keeps it as written. `backupVersionError` in `backup.ts` accepts any
older version, and the current major with a minor at or below the current one. It refuses a newer
major or minor with a message telling the user to update VROOM, and a version that isn't a number.

An older backup reaches the current shape through `BACKUP_UPGRADE_STEPS`, an ordered list of
`{ to, upgrade(tables) }`. `upgradeBackupTables` runs every step whose `to` is newer than the
backup, on the raw rows, before `coerceRow`. Both restore paths call it: `parseZipBackup`, and
`restoreFromSheets` with the mirror's version.

There are two steps:

- **`2.0.0`, to cents:** a pre-2.0.0 backup stored dollar floats, so this step multiplies the
  `MONEY_CENTS_FIELDS` columns by 100. `coerceRow` then rounds them, since float products such as
  12.34 × 100 land just below the integer.
- **`3.0.0`, to the minor unit of the backup's own currency** (scale `minorUnitScale`):
  - The scale is 1 for the currencies in `noDecimals` in `backend/src/shared-currencies.json` and 100 for the rest. The list is pinned rather than read from `Intl`, because Bun and the browsers disagree on the digits of some currencies (HUF, IDR, COP, PKR, IRR and others).
  - The currency is the backup's `userPreferences.currencyUnit`. A backup without preferences (restore keeps the account's own in that case) uses the account's currency.
  - A 2.0.0 backup holds cents, so `centsToMinorUnits` rescales each money column, rounding halves away from zero.
  - The legs of a split group and the absolute allocations of a reminder split are rescaled together with `rescaleParts`: each part is floored, and the units left are handed out by largest remainder. Ties go to the leg with the lower `id`, and to the earlier allocation in a reminder split. So the parts still add up to the rounded total, and none goes below zero.
  - An absolute reminder split without allocations is left as it is.
  - A two-decimal currency is left as it is.
  - Migration `0028_money_minor_units` applies the same rules to stored data, once (`money_unit_migrations` records it). `migration-0028.test.ts` checks that it and this step agree for a forint user.

### Rollback and old backups

- **Restoring an older backup:** a backup taken before the minor-unit migration is a 2.0.0 backup
  in cents. Restoring it on a newer build runs the `3.0.0` step once and gives the same amounts the
  migration would have stored.
- **Rescaling can't run twice:** a 3.0.0 backup is never rescaled again, and an export after a
  restore is 3.0.0. For a Sheets mirror this relies on its `Metadata` tab: a mirror whose tab was deleted is read as 2.0.0 and rescaled again.
- **Merging into another currency:** a merge restore into an account whose currency differs in decimals from the backup's mixes two scales, as it already mixed two currencies before 3.0.0.
- **Rolling back the build:** a build older than 3.0.0 refuses 3.0.0 backups with its "newer
  version" message. To roll back, reinstall that build and restore a backup it made. Once the minor-unit database migration has run, rolling back the build also needs the database from before it (that backup, or a copy of the database file), because the older build reads stored amounts as cents.
- **Tests:** `backup-minor-units.test.ts` covers each case, and pins the frozen
  `fixtures/backup-3.0.0-jpy/` fixture.

A Sheets mirror records its version in a `Metadata` tab, written last on every sync. A mirror
without the tab was last synced by an older build: it counts as 1.x dollars only when its
Expenses header row is present and lacks `createdBy` (added in the same release as cents), and as
2.0.0 cents otherwise, which the `3.0.0` step then rescales. Never infer the unit from cell values: one hand-edited `45.50` would rescale
every amount.

### Changing the format

1. Bump `currentVersion`: the minor for an addition an older backup can do without, the major
   for anything that needs an upgrade step to read old data. Either way, older builds refuse the
   new backups: the gate reads only up to its own minor.
2. Add a `BACKUP_UPGRADE_STEPS` entry when old rows need changing to fit. A new column an older
   backup lacks needs none if it is nullable or NOT NULL with a static default, since `coerceRow`
   leaves it unset or fills the default. A NOT NULL column without one needs a step.
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
