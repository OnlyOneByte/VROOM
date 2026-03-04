# Implementation Plan: Odometer Log

## Overview

Add a chronological odometer reading log to each vehicle. Entries come from manual user input or auto-population from expenses with mileage. Includes a consolidated migration (merging old 0004+0005 + new odometer table), backend domain module with expense hooks, backup/restore/sync pipeline integration, and a frontend tab with timeline list and mileage chart.

## Tasks

- [x] 1. Database schema and consolidated migration
  - [x] 1.1 Add `odometerEntries` table to `backend/src/db/schema.ts`
    - Define the table per the design: id, vehicle_id, user_id, odometer, recorded_at, note, linked_entity_type, linked_entity_id, created_at, updated_at
    - Add indexes: `odometer_vehicle_date_idx` on (vehicle_id, recorded_at), `odometer_linked_entity_idx` on (linked_entity_type, linked_entity_id)
    - Add FK references: vehicle_id → vehicles(id) ON DELETE CASCADE, user_id → users(id) ON DELETE CASCADE
    - Export `OdometerEntry` and `NewOdometerEntry` types
    - Update `PhotoEntityType` union to include `'odometer_entry'`
    - _Requirements: 11.1, 11.5, 11.6, 8.3_

  - [x] 1.2 Create consolidated migration 0004
    - Delete existing `backend/drizzle/0004_high_obadiah_stane.sql` and `backend/drizzle/0005_lucky_stardust.sql`
    - Create new `backend/drizzle/0004_consolidated.sql` combining: track_fuel/track_charging ALTER TABLEs + UPDATE statements, google_drive_custom_folder_name ALTER TABLE, CREATE TABLE odometer_entries + CREATE INDEX statements
    - Update `backend/drizzle/meta/_journal.json` to remove old 0004/0005 entries and add the new consolidated 0004 entry
    - Update `backend/drizzle/meta/0004_snapshot.json` with the consolidated schema snapshot
    - _Requirements: 11.1, 11.2, 11.3_

  - [x] 1.3 Write migration test for consolidated 0004
    - Replace `backend/src/db/__tests__/migration-0004.test.ts` with tests covering: odometer_entries table exists with correct columns, track_fuel/track_charging columns on vehicles, google_drive_custom_folder_name on user_settings, seed data from 0000–0003 survives, CASCADE delete from vehicles removes odometer entries, both indexes exist
    - Delete `backend/src/db/__tests__/migration-0005.test.ts`
    - Update `migration-general.test.ts` to include `odometer_entries` in expected tables list and remove references to old 0005
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

  - [x] 1.4 Dev database reconciliation
    - Run the odometer_entries CREATE TABLE and CREATE INDEX statements directly against the dev database (`backend/data/vroom.db`) using `sqlite3` or Bun's SQLite API
    - Delete the old migration 0004 and 0005 hash rows from `__drizzle_migrations`
    - Insert the new consolidated migration 0004 hash into `__drizzle_migrations` (compute hash via `shasum -a 256` on the new migration file, get timestamp from `_journal.json`)
    - Verify the migration state is correct by checking `__drizzle_migrations` has the right entries
    - _Requirements: 11.4_

- [x] 2. Backend odometer domain module
  - [x] 2.1 Create `backend/src/api/odometer/repository.ts`
    - Extend `BaseRepository<OdometerEntry, NewOdometerEntry>`
    - Implement `findByVehicleIdPaginated(vehicleId, limit, offset)` — returns `{ data: OdometerEntry[], totalCount: number }` with data sorted by recorded_at DESC using SQL LIMIT/OFFSET, plus a COUNT(*) query for totalCount
    - Implement `findByLinkedEntity(entityType, entityId)` — returns single entry or null
    - Implement `upsertFromLinkedEntity(params)` — find by linked_entity_type+id, update if exists, insert if not
    - Implement `deleteByLinkedEntity(entityType, entityId)` — delete entry matching type+id
    - Export singleton `odometerRepository`
    - _Requirements: 4.1, 4.2, 5.1, 6.1, 6.4, 6.5_

  - [x] 2.2 Create `backend/src/api/odometer/hooks.ts`
    - Implement `handleOdometerOnExpenseCreate(expense)` — if mileage non-null, upsert linked entry
    - Implement `handleOdometerOnExpenseUpdate(existingExpense, updateData)` — handle all four mileage transition cases (null→null, null→value, value→null, value→value)
    - Implement `handleOdometerOnExpenseDelete(expense)` — if mileage non-null, delete linked entry
    - Follow the same pattern as `backend/src/api/financing/hooks.ts`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 2.3 Create `backend/src/api/odometer/routes.ts`
    - Define Zod schemas: createSchema (odometer: non-negative integer, recordedAt: valid date not in future, note: optional string), updateSchema (partial of createSchema), listQuerySchema (limit: optional int clamped to maxPageSize, offset: optional int min 0)
    - Apply `requireAuth` and `changeTracker` middleware
    - GET `/:vehicleId` — validate vehicle ownership, parse limit/offset from query, call repository.findByVehicleIdPaginated, return paginated envelope `{ success, data, totalCount, limit, offset, hasMore }`
    - POST `/:vehicleId` — validate vehicle ownership, create manual entry (linkedEntityType/Id = null)
    - PUT `/:id` — validate entry ownership, reject if linked entry (400), update
    - DELETE `/:id` — validate entry ownership, reject if linked entry (400), delete entry + cleanup photos
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 5.2, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 8.2, 14.1, 14.2, 14.3_

  - [x] 2.4 Mount odometer routes in `backend/src/index.ts`
    - Import `routes as odometerRoutes` from `./api/odometer/routes`
    - Mount at `app.route('/api/v1/odometer', odometerRoutes)`
    - _Requirements: 14.1_

  - [x] 2.5 Integrate odometer hooks into expense routes
    - In `backend/src/api/expenses/routes.ts`, import `handleOdometerOnExpenseCreate`, `handleOdometerOnExpenseUpdate`, `handleOdometerOnExpenseDelete` from `../odometer/hooks`
    - Call `handleOdometerOnExpenseCreate` after expense creation (alongside existing financing hook)
    - Call `handleOdometerOnExpenseUpdate` before expense update (alongside existing financing hook)
    - Call `handleOdometerOnExpenseDelete` before expense deletion (alongside existing financing hook)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 3. Property tests for backend
  - [x] 3.1 Write property test: expense hook invariant
    - Create `backend/src/api/odometer/__tests__/hooks.property.test.ts`
    - **Property 1: Expense hook invariant** — For any sequence of expense create/update/delete operations with random mileage values, the number of linked odometer entries equals the number of expenses with non-null mileage, and each entry's odometer matches its source expense's mileage
    - Use fast-check to generate random expense sequences with random mileage values (including null)
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

  - [x] 3.2 Write property test: upsert idempotency
    - Create `backend/src/api/odometer/__tests__/repository.property.test.ts`
    - **Property 2: Upsert idempotency** — For any linkedEntityType+linkedEntityId pair, calling upsertFromLinkedEntity N times (N ≥ 1) results in exactly one entry, and the entry ID remains stable across calls
    - Use fast-check to generate random N (1–10) and random params
    - **Validates: Requirements 4.1, 4.2**

  - [x] 3.3 Write property test: link field consistency
    - Add to `repository.property.test.ts`
    - **Property 3: Link field consistency invariant** — For any odometer entry in the database after any sequence of operations, either both linkedEntityType and linkedEntityId are null, or both are non-null
    - **Validates: Requirements 5.1, 5.2, 1.5**

  - [x] 3.4 Write property test: input validation
    - Create `backend/src/api/odometer/__tests__/validation.property.test.ts`
    - **Property 4: Input validation rejects invalid odometer data** — For any negative or non-integer number, the validation schema rejects it. For any future date, the schema rejects it. For any valid non-negative integer + non-future date, the schema accepts it.
    - **Validates: Requirements 1.2, 1.3**

- [x] 4. Backup/restore/sync pipeline integration
  - [x] 4.1 Update backup config and types
    - In `backend/src/config.ts`: add `odometer: odometerEntries` to `TABLE_SCHEMA_MAP`, add `odometer: 'odometer_entries.csv'` to `TABLE_FILENAME_MAP`, add `'odometer_entries.csv'` to `OPTIONAL_BACKUP_FILES`
    - In `backend/src/types.ts`: add `odometer` field to `BackupData` and `ParsedBackupData` interfaces
    - Import `odometerEntries` from schema in config.ts
    - _Requirements: 9.1, 9.3_

  - [x] 4.2 Update `backup.ts` — createBackup, queryUserPhotos, validation
    - In `createBackup()`: query odometer entries via innerJoin(vehicles) on userId, add to return object
    - In `queryUserPhotos()`: add `{ type: 'odometer_entry', ids: odometerEntryIds }` to entityQueries array
    - In `validateReferentialIntegrity()`: build odometerIds set, add `validateOdometerRefs()` call, pass odometerIds to `validatePhotoRefs()`
    - Add new `validateOdometerRefs()` method: check each odometer entry's vehicleId exists in vehicleIds set
    - In `validatePhotoRefs()`: add `odometer_entry: entityIds.odometerIds` to entityTypeToIds map
    - _Requirements: 9.1, 9.4, 9.5_

  - [x] 4.3 Update `restore.ts` — deleteUserData and insertBackupData
    - In `deleteUserData()`: collect odometer entry IDs, delete photos with entity_type='odometer_entry', delete odometer entries (before deleting vehicles)
    - In `insertBackupData()`: insert odometer entries AFTER expenses (linked_entity_id may reference expense IDs) and BEFORE photos
    - Add `odometer: number` to `ImportSummary` interface
    - _Requirements: 9.2, 9.6_

  - [x] 4.4 Update `google-sheets.ts` — spreadsheet creation, sync, and read
    - In `createSpreadsheet()`: add `{ properties: { title: 'Odometer' } }` to sheets array
    - In `ensureRequiredSheets()`: add `'Odometer'` to requiredSheets array
    - Add `getOdometerHeaders()` method returning column headers
    - In `updateSpreadsheetWithUserData()`: query odometer entries, call `updateSheet('Odometer', ...)`
    - In `readSpreadsheetData()`: read 'Odometer' sheet, coerce rows, add to returned data
    - _Requirements: 10.1, 10.2, 10.3_

  - [x] 4.5 Update backup tests
    - In `backend/src/api/sync/__tests__/backup.test.ts`: add `'odometer'` to TABLE_SCHEMA_MAP expected keys, add `odometer: []` to all ParsedBackupData fixtures, add coerceRow tests for odometer_entries (integer odometer, nullable text fields), add referential integrity test for odometer entry referencing non-existent vehicle
    - _Requirements: 9.4_

- [x] 5. Backend checkpoint
  - Run `bun run all:fix && bun run validate` from `backend/`. Fix all errors before proceeding.

- [x] 6. Frontend types and API service
  - [x] 6.1 Add `OdometerEntry` type to frontend
    - In `frontend/src/lib/types/index.ts` (or `types.ts`), add the `OdometerEntry` interface: id, vehicleId, odometer, recordedAt, note?, linkedEntityType?, linkedEntityId?, createdAt, updatedAt
    - _Requirements: 12.1_

  - [x] 6.2 Create `frontend/src/lib/services/odometer-api.ts`
    - Implement `odometerApi` object with methods: `getEntries(vehicleId, params?)` returning `PaginatedResponse<OdometerEntry>` (accepts optional `limit`/`offset`), `create(vehicleId, data)`, `update(entryId, data)`, `delete(entryId)`
    - Use `apiClient` from `$lib/services/api-client.ts`
    - Build query string from pagination params for getEntries
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

- [x] 7. Frontend odometer tab and add reading page
  - [x] 7.1 Create `OdometerTab.svelte` component
    - Create `frontend/src/lib/components/vehicles/OdometerTab.svelte`
    - Accept `vehicleId` prop, load first page of entries via `odometerApi.getEntries(vehicleId, { limit: 20, offset: 0 })` on mount
    - Display chronological list (newest first), visually distinguish manual vs linked entries
    - Linked entries with type 'expense' show a navigable link to `/expenses/{linkedEntityId}`
    - Show photo thumbnails on entries that have photos
    - Display mileage-over-time line chart using layerchart (entries plotted by recordedAt vs odometer)
    - Pagination controls: page indicator, previous/next buttons, disabled at boundaries, loading state during page transitions
    - Empty state with guidance when no entries exist
    - "Add Reading" button navigates to `/vehicles/{vehicleId}/odometer/new`
    - Use Svelte 5 runes, semantic color tokens, shadcn-svelte components
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

  - [x] 7.2 Create Add Odometer Reading page
    - Create `frontend/src/routes/vehicles/[id]/odometer/new/+page.svelte` (follows convention of `/expenses/new`, `/vehicles/new`, `/insurance/new`)
    - Create `frontend/src/routes/vehicles/[id]/odometer/new/+page.ts` to extract vehicleId from params
    - Fields: odometer (required, integer, min 0), date (required, defaults to today), note (optional), photo upload (optional via MediaCaptureDialog)
    - Zod validation before submission
    - Soft warning if new reading < latest entry's odometer value (fetch latest on mount)
    - Submit via `odometerApi.create()`, navigate back to vehicle detail page on success (use `returnTo` query param or default to `/vehicles/{vehicleId}`)
    - Back button/link to return to vehicle detail page
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

  - [x] 7.3 Add Odometer tab to vehicle detail page
    - In `frontend/src/routes/vehicles/[id]/+page.svelte`:
    - Import OdometerTab component
    - Add 4th tab trigger "Odometer" to TabsList (change grid-cols-3 to grid-cols-4)
    - Add TabsContent for "odometer" value rendering OdometerTab with vehicleId prop
    - _Requirements: 12.1_

- [x] 8. Frontend checkpoint
  - Run `npm run all:fix && npm run validate` from `frontend/`. Fix all errors before proceeding.

## Notes

- Each task references specific requirements for traceability
- Property tests use fast-check and validate universal correctness properties from the design document
- The consolidated migration replaces old 0004 + 0005 with a single 0004 containing all three changes
- Dev DB reconciliation requires manual SQL commands documented in task 1.4
- Backup pipeline treats `odometer_entries.csv` as optional for backward compatibility with older backups
- Odometer entries are inserted AFTER expenses in restore to preserve linked_entity_id references
