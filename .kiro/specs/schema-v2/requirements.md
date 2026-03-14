# Requirements Document

## Introduction

This document specifies the requirements for the Schema V2 redesign of the VROOM application database. The redesign is a comprehensive structural overhaul based on a merged proposal derived from access pattern analysis and two independent schema proposals. The key goals are: eliminate all 9 cross-domain hooks (odometer, financing, insurance→expense), extract insurance terms from JSON to a proper relational table, split user_settings into user_preferences + sync_state, compute derived values on read instead of caching them via hooks, rename columns for consistency, add DB-enforced invariants via partial unique indexes, and add user_id to photos for direct ownership queries.

This is a pre-launch change — no production database exists. The schema is edited directly in `schema.ts`, existing migration files are deleted, and a fresh `0000` migration is regenerated from scratch. The database is rebuilt on startup. No data migration service is needed.

The previous schema-redesign spec (expense_groups → unified expenses table) is COMPLETE and already reflected in the current schema. The multi-provider OAuth spec is also COMPLETE — `user_providers` already has `providerAccountId`, the `up_auth_identity_idx` partial unique index, and auth-domain rows. This spec treats both as the baseline.

## Glossary

- **Vehicles_Table**: The SQLite `vehicles` table storing vehicle records owned by users
- **Vehicle_Financing_Table**: The SQLite `vehicle_financing` table storing loan, lease, and ownership financing records
- **Insurance_Policies_Table**: The SQLite `insurance_policies` table storing insurance policy header records
- **Insurance_Terms_Table**: The new SQLite `insurance_terms` table storing individual policy terms extracted from the JSON column
- **Insurance_Term_Vehicles_Table**: The new SQLite `insurance_term_vehicles` junction table linking terms to covered vehicles
- **Expenses_Table**: The SQLite `expenses` table storing all expense records
- **Odometer_Entries_Table**: The SQLite `odometer_entries` table storing manual odometer readings
- **Photos_Table**: The SQLite `photos` table storing photo metadata with polymorphic entity references
- **Photo_Refs_Table**: The SQLite `photo_refs` table storing per-provider physical photo locations
- **User_Preferences_Table**: The new SQLite `user_preferences` table storing user-facing settings (split from user_settings)
- **Sync_State_Table**: The new SQLite `sync_state` table storing system-managed timestamps (split from user_settings)
- **User_Settings_Table**: The current SQLite `user_settings` table to be replaced by User_Preferences_Table and Sync_State_Table
- **Insurance_Policy_Vehicles_Table**: The current SQLite `insurance_policy_vehicles` junction table to be replaced by Insurance_Term_Vehicles_Table
- **Backup_Service**: The service responsible for creating and exporting backup ZIP files
- **Restore_Service**: The service responsible for importing and restoring backup ZIP files
- **Google_Sheets_Service**: The service that syncs user data to/from Google Sheets spreadsheets
- **Financing_Repository**: The repository managing vehicle financing CRUD and balance computation
- **Insurance_Repository**: The repository managing insurance policy and term CRUD
- **Odometer_Repository**: The repository managing odometer entry CRUD and history queries
- **Preferences_Repository**: The repository managing user preferences (read-heavy, write-rare)
- **Sync_State_Repository**: The repository managing sync state timestamps (write-heavy via activity tracker)
- **Photo_Repository**: The repository managing photo CRUD operations
- **Activity_Tracker**: The middleware that records data mutation timestamps for sync scheduling
- **UNION_Query**: A SQL query combining results from multiple tables (expenses.mileage + odometer_entries) for odometer history
- **Partial_Unique_Index**: A SQLite unique index with a WHERE clause that enforces uniqueness only for rows matching the predicate
- **Schema_Version**: An integer field in backup metadata indicating the backup format version

## Requirements

### Requirement 1: Insurance Terms Extraction

**User Story:** As a developer, I want insurance terms stored in a proper relational table instead of a JSON column, so that term CRUD uses standard SQL operations with real foreign key integrity instead of JSON parse-mutate-serialize cycles.

#### Acceptance Criteria

1. THE database SHALL contain an `insurance_terms` table with columns: `id` (TEXT PK), `policy_id` (TEXT FK to insurance_policies ON DELETE CASCADE), `start_date` (INTEGER NOT NULL), `end_date` (INTEGER NOT NULL), `policy_number` (TEXT), `coverage_description` (TEXT), `deductible_amount` (REAL), `coverage_limit` (REAL), `agent_name` (TEXT), `agent_phone` (TEXT), `agent_email` (TEXT), `total_cost` (REAL), `monthly_cost` (REAL), `premium_frequency` (TEXT), `payment_amount` (REAL), `created_at` (INTEGER NOT NULL), `updated_at` (INTEGER NOT NULL)
2. THE Insurance_Terms_Table SHALL have an index `it_policy_id_idx` on column (`policy_id`)
3. THE Insurance_Terms_Table SHALL have an index `it_policy_end_date_idx` on columns (`policy_id`, `end_date`)
4. THE Insurance_Policies_Table SHALL NOT contain a `terms` JSON column
5. THE Insurance_Policies_Table SHALL NOT contain `current_term_start` or `current_term_end` columns
6. WHEN the current term dates for a policy are needed, THE Insurance_Repository SHALL derive them via `SELECT start_date, end_date FROM insurance_terms WHERE policy_id = ? ORDER BY end_date DESC LIMIT 1`

### Requirement 2: Insurance Term Vehicles Junction

**User Story:** As a developer, I want the insurance-vehicle junction table to reference terms directly with real foreign keys, so that referential integrity is enforced at the database level.

#### Acceptance Criteria

1. THE database SHALL contain an `insurance_term_vehicles` table with columns: `term_id` (TEXT FK to insurance_terms ON DELETE CASCADE), `vehicle_id` (TEXT FK to vehicles ON DELETE CASCADE), with composite primary key (`term_id`, `vehicle_id`)
2. THE Insurance_Term_Vehicles_Table SHALL have an index `itv_vehicle_idx` on column (`vehicle_id`)
3. THE database SHALL NOT contain an `insurance_policy_vehicles` table

### Requirement 3: Vehicles Table Cleanup

**User Story:** As a developer, I want the derived `current_insurance_policy_id` column removed from vehicles, so that there is no denormalized cache requiring manual sync hooks.

#### Acceptance Criteria

1. THE Vehicles_Table SHALL NOT contain a `current_insurance_policy_id` column
2. WHEN the active insurance policy for a vehicle is needed, THE application SHALL derive it via a JOIN through insurance_terms and insurance_term_vehicles tables
3. THE Vehicles_Table SHALL have a partial unique index `vehicles_license_plate_idx` on column (`license_plate`) WHERE `license_plate IS NOT NULL`

### Requirement 4: Vehicle Financing Simplification

**User Story:** As a developer, I want the cached `current_balance` column removed from vehicle_financing and the balance computed on read, so that financing hooks are eliminated and balance drift bugs are prevented.

#### Acceptance Criteria

1. THE Vehicle_Financing_Table SHALL NOT contain a `current_balance` column
2. WHEN the current balance for a financing record is needed, THE Financing_Repository SHALL compute it as `original_amount - COALESCE(SUM(expenses.expense_amount), 0)` by querying expenses WHERE `is_financing_payment = 1` for the vehicle
3. THE Vehicle_Financing_Table SHALL have a partial unique index `vf_active_vehicle_idx` on column (`vehicle_id`) WHERE `is_active = 1` to enforce one active financing per vehicle
4. WHEN a financing balance reaches zero or below, THE application SHALL display a "Mark as paid off" action for the user to confirm explicitly instead of auto-completing

### Requirement 5: Expenses Table Changes

**User Story:** As a developer, I want the expenses table to use consistent column names and proper foreign keys, so that the schema matches the frontend type contract and insurance term references have real integrity.

#### Acceptance Criteria

1. THE Expenses_Table SHALL contain a column named `volume` (REAL) instead of `fuel_amount`
2. THE Expenses_Table SHALL NOT contain an `insurance_policy_id` column
3. THE Expenses_Table SHALL contain an `insurance_term_id` column with a foreign key reference to `insurance_terms(id)` ON DELETE SET NULL
4. THE Expenses_Table SHALL have an index `expenses_insurance_term_idx` on column (`insurance_term_id`)
5. WHEN an insurance term is deleted, THE database SHALL set `insurance_term_id` to NULL on linked expenses instead of deleting the expenses
6. THE `ExpenseSplitService.createSiblings` method SHALL NOT accept or write an `insurancePolicyId` parameter, since the column no longer exists

### Requirement 6: Odometer Entries Simplification

**User Story:** As a developer, I want odometer entries to store only manual readings, so that the linked-entity hook system is eliminated and expense mileage stays on the expense row.

#### Acceptance Criteria

1. THE Odometer_Entries_Table SHALL NOT contain `linked_entity_type` or `linked_entity_id` columns
2. THE Odometer_Entries_Table SHALL NOT have an `odometer_linked_entity_idx` index
3. WHEN the full odometer history for a vehicle is needed, THE Odometer_Repository SHALL return results from a UNION_Query combining `expenses.mileage` (where mileage IS NOT NULL) and `odometer_entries.odometer`, ordered by date descending, with support for LIMIT/OFFSET pagination and a total count
4. THE UNION_Query result SHALL include a `source` field indicating `'expense'` or `'manual'` and a `source_id` field containing the original expense or odometer entry ID for each entry

### Requirement 7: Photos Table User Ownership

**User Story:** As a developer, I want photos to carry a direct `user_id` foreign key, so that user-scoped photo queries are direct index lookups instead of multi-branch JOINs through entity tables.

#### Acceptance Criteria

1. THE Photos_Table SHALL contain a `user_id` column (TEXT NOT NULL) with a foreign key reference to `users(id)` ON DELETE CASCADE
2. THE Photos_Table SHALL have an index `photos_user_entity_type_idx` on columns (`user_id`, `entity_type`)
3. WHEN counting or listing photos for a user, THE Photo_Repository SHALL query `WHERE user_id = ?` directly instead of JOINing through entity tables

### Requirement 8: Photo Refs Partial Index

**User Story:** As a developer, I want the photo_refs pending index to match the sync worker's exact query predicate, so that the index is smaller and precisely covers the poll query.

#### Acceptance Criteria

1. THE Photo_Refs_Table SHALL have a partial index `pr_pending_idx` on columns (`status`, `created_at`) WHERE `status IN ('pending', 'failed') AND retry_count < 3`

### Requirement 9: User Settings Split

**User Story:** As a developer, I want user settings split into user_preferences (user-facing, write-rare) and sync_state (system-managed, write-frequent), so that high-frequency activity tracking writes do not contend with the user-facing preferences row.

#### Acceptance Criteria

1. THE database SHALL contain a `user_preferences` table with `user_id` (TEXT PK, FK to users ON DELETE CASCADE), `unit_preferences` (TEXT JSON NOT NULL), `currency_unit` (TEXT NOT NULL DEFAULT 'USD'), `auto_backup_enabled` (INTEGER boolean NOT NULL DEFAULT 0), `backup_frequency` (TEXT NOT NULL DEFAULT 'weekly'), `sync_on_inactivity` (INTEGER boolean NOT NULL DEFAULT 1), `sync_inactivity_minutes` (INTEGER NOT NULL DEFAULT 5), `storage_config` (TEXT JSON), `backup_config` (TEXT JSON), `created_at` (INTEGER NOT NULL), `updated_at` (INTEGER NOT NULL)
2. THE database SHALL contain a `sync_state` table with `user_id` (TEXT PK, FK to users ON DELETE CASCADE), `last_sync_date` (INTEGER), `last_data_change_date` (INTEGER), `last_backup_date` (INTEGER)
3. THE database SHALL NOT contain a `user_settings` table
4. THE Activity_Tracker SHALL write `last_data_change_date` to the Sync_State_Table instead of the User_Settings_Table

### Requirement 10: Odometer Hook Elimination

**User Story:** As a developer, I want all odometer hooks removed from expense CRUD, so that expense mutations no longer trigger side effects in the odometer_entries table.

#### Acceptance Criteria

1. WHEN an expense is created with a non-null mileage value, THE expense route handler SHALL NOT create a linked odometer entry
2. WHEN an expense is updated with a changed mileage value, THE expense route handler SHALL NOT upsert or delete a linked odometer entry
3. WHEN an expense is deleted, THE expense route handler SHALL NOT delete a linked odometer entry
4. THE codebase SHALL NOT contain an `odometer/hooks.ts` file

### Requirement 11: Financing Hook Elimination

**User Story:** As a developer, I want all financing hooks removed from expense CRUD, so that expense mutations no longer trigger balance updates on the vehicle_financing table.

#### Acceptance Criteria

1. WHEN a financing expense is created, THE expense route handler SHALL NOT update the `current_balance` on vehicle_financing
2. WHEN a financing expense is updated, THE expense route handler SHALL NOT adjust the balance on vehicle_financing
3. WHEN a financing expense is deleted, THE expense route handler SHALL NOT restore the balance on vehicle_financing
4. THE codebase SHALL NOT contain a `financing/hooks.ts` file

### Requirement 12: Insurance Auto-Expense Elimination

**User Story:** As a developer, I want insurance term creation to stop auto-generating expenses, so that the user explicitly creates insurance expenses with pre-filled data from the term.

#### Acceptance Criteria

1. WHEN an insurance term is created with a totalCost value, THE Insurance_Repository SHALL NOT auto-create split expenses for covered vehicles
2. WHEN an insurance term's coverage is updated, THE Insurance_Repository SHALL NOT auto-sync or recreate linked expenses
3. WHEN an insurance term is deleted, THE database SHALL set `insurance_term_id` to NULL on linked expenses via the ON DELETE SET NULL foreign key constraint instead of deleting expenses
4. WHEN a user views a term without a linked expense, THE frontend SHALL display a prompt to create an expense with cost and vehicle allocation pre-filled from the term data


### Requirement 13: Schema Regeneration (Pre-Launch)

**User Story:** As a developer, I want the schema changes applied by regenerating a single fresh migration from scratch, so that only one `0000` migration file exists and the database is rebuilt cleanly on startup.

#### Acceptance Criteria

1. AFTER editing `schema.ts` with all v2 changes, THE developer SHALL delete all existing migration files in `backend/drizzle/` (SQL files, `meta/` folder contents)
2. AFTER deleting old migrations, THE developer SHALL run `bun run db:generate` to produce a single fresh `0000` migration from the updated schema
3. THE `backend/drizzle/` directory SHALL contain exactly one migration SQL file (the `0000` file) after regeneration
4. AFTER regenerating the migration, THE developer SHALL delete `backend/data/vroom.db*` files so the database is recreated on startup
5. THE seed script (`backend/src/db/seed.ts`) SHALL be updated to seed data matching the v2 schema (new tables, renamed columns, removed columns)
6. Partial unique indexes that Drizzle cannot express (e.g., `WHERE` clauses on indexes) SHALL be manually appended to the generated `0000` migration SQL file. This includes: `vehicles_license_plate_idx`, `vf_active_vehicle_idx`, `up_auth_identity_idx`, and `pr_pending_idx`

### Requirement 14: Backup/Restore Pipeline Updates

**User Story:** As a user, I want the backup and restore pipeline to reflect the new schema structure, so that backups are consistent with the current data model.

#### Acceptance Criteria

1. WHEN creating a backup, THE Backup_Service SHALL export `insurance_terms` and `insurance_term_vehicles` data instead of embedding terms in the insurance_policies export
2. WHEN creating a backup, THE Backup_Service SHALL export `user_preferences` and `sync_state` data instead of `user_settings`
3. WHEN creating a backup, THE Backup_Service SHALL export expenses with the `volume` column name instead of `fuel_amount`, and SHALL NOT export `insurance_policy_id`
4. WHEN creating a backup, THE Backup_Service SHALL export photos with the `user_id` column
5. WHEN creating a backup, THE Backup_Service SHALL export odometer entries without `linked_entity_type` or `linked_entity_id` columns
6. WHEN creating a backup, THE Backup_Service SHALL export vehicles without the `current_insurance_policy_id` column
7. WHEN creating a backup, THE Backup_Service SHALL export vehicle_financing without the `current_balance` column
8. WHEN restoring a backup, THE Restore_Service SHALL insert data matching the v2 schema structure
9. THE Backup_Service SHALL update `validateBackupData()` and `validateReferentialIntegrity()` for the new table structure (insurance_terms, insurance_term_vehicles, user_preferences, sync_state, photos.user_id)

### Requirement 15: Google Sheets Sync Updates

**User Story:** As a user, I want Google Sheets sync to reflect the new schema structure, so that my spreadsheet data matches the current data model.

#### Acceptance Criteria

1. WHEN creating a spreadsheet, THE Google_Sheets_Service SHALL create an `Insurance Terms` sheet and an `Insurance Term Vehicles` sheet instead of embedding term data in the policies sheet
2. WHEN creating a spreadsheet, THE Google_Sheets_Service SHALL create `User Preferences` and `Sync State` sheets instead of a `User Settings` sheet
3. WHEN exporting expense headers, THE Google_Sheets_Service SHALL use `volume` instead of `fuel_amount` and SHALL NOT include `insurance_policy_id`
4. WHEN exporting photo headers, THE Google_Sheets_Service SHALL include `user_id`
5. WHEN exporting odometer headers, THE Google_Sheets_Service SHALL NOT include `linked_entity_type` or `linked_entity_id`
6. WHEN exporting vehicle financing headers, THE Google_Sheets_Service SHALL NOT include `current_balance`
7. WHEN exporting vehicle headers, THE Google_Sheets_Service SHALL NOT include `current_insurance_policy_id`

### Requirement 16: Insurance Repository Simplification

**User Story:** As a developer, I want the insurance repository to use standard CRUD on the insurance_terms table instead of JSON parse-mutate-serialize cycles, so that the code is simpler and term operations are standard SQL.

#### Acceptance Criteria

1. THE Insurance_Repository SHALL perform term CRUD as standard INSERT, UPDATE, DELETE operations on the Insurance_Terms_Table
2. THE Insurance_Repository SHALL NOT parse, mutate, or serialize a `terms` JSON array on the insurance_policies row
3. WHEN finding expiring policies, THE Insurance_Repository SHALL query `WHERE end_date BETWEEN ? AND ?` on the Insurance_Terms_Table instead of loading all policies and parsing JSON
4. THE Insurance_Repository SHALL manage the Insurance_Term_Vehicles_Table junction rows with real foreign keys to `insurance_terms(id)`

### Requirement 17: Financing Repository Changes

**User Story:** As a developer, I want the financing repository to compute balance on read and support explicit payoff, so that cached balance columns and auto-complete hooks are eliminated.

#### Acceptance Criteria

1. THE Financing_Repository SHALL provide a `computeBalance` method that returns `original_amount - COALESCE(SUM(expenses.expense_amount), 0)` for financing payment expenses on the vehicle
2. THE Financing_Repository SHALL NOT contain `updateBalance` or `markAsCompleted` methods
3. WHEN the computed balance is less than or equal to 0.01, THE financing API response SHALL indicate the financing is eligible for payoff so the frontend can display a "Mark as paid off" action

### Requirement 18: Expense CRUD Simplification

**User Story:** As a developer, I want expense create, update, and delete operations to be self-contained without cross-domain side effects, so that each mutation touches only the expenses table and the activity tracker.

#### Acceptance Criteria

1. WHEN a single (non-split) expense is created, THE expense route handler SHALL NOT call any odometer or financing hook functions
2. WHEN a single (non-split) expense is updated, THE expense route handler SHALL NOT call any odometer or financing hook functions
3. WHEN a single (non-split) expense is deleted, THE expense route handler SHALL NOT call any odometer or financing hook functions
4. THE expense route handler SHALL use the column name `volume` instead of `fuel_amount` in all insert and update operations
5. THE `validateFuelExpenseData` utility function in `backend/src/utils/validation.ts` and all call sites SHALL use `volume` instead of `fuelAmount`

### Requirement 19: Frontend Insurance Flow Changes

**User Story:** As a user, I want to explicitly create insurance expenses after saving a term, so that I have control over how insurance costs are allocated across vehicles.

#### Acceptance Criteria

1. WHEN a user saves an insurance term with cost data, THE frontend SHALL display a prompt offering to create an expense with the cost and vehicle allocation pre-filled from the term
2. WHEN a user views a term detail page for a term without a linked expense, THE frontend SHALL display a "Create expense" action
3. THE frontend insurance term type SHALL use flat fields (`policyNumber`, `coverageDescription`, `deductibleAmount`, `coverageLimit`, `agentName`, `agentPhone`, `agentEmail`, `totalCost`, `monthlyCost`, `premiumFrequency`, `paymentAmount`) instead of nested `policyDetails` and `financeDetails` objects
4. THE frontend SHALL display insurance term data from the Insurance_Terms_Table API responses instead of parsing terms from the policy object

### Requirement 20: Frontend Financing Flow Changes

**User Story:** As a user, I want to see a computed financing balance and explicitly mark a loan as paid off, so that the balance is always accurate and payoff is a conscious action.

#### Acceptance Criteria

1. THE frontend financing detail page SHALL display the balance as computed by the API (original_amount minus sum of payments) instead of a cached value
2. WHEN the computed balance is less than or equal to 0.01, THE frontend SHALL display a "Mark as paid off" button
3. WHEN the user clicks "Mark as paid off", THE frontend SHALL send an explicit API request to set `is_active = false` on the financing record

### Requirement 21: Frontend Odometer History Changes

**User Story:** As a user, I want the odometer history page to show readings from both expenses and manual entries with a source indicator, so that I can see the complete mileage history for my vehicle.

#### Acceptance Criteria

1. THE frontend odometer history page SHALL display entries from the UNION_Query API response combining expense mileage and manual odometer readings
2. THE frontend SHALL display a `source` indicator label (`'expense'` or `'manual'`) on each odometer history entry

### Requirement 22: Frontend Type and API Transformer Updates

**User Story:** As a developer, I want frontend types and the API transformer to match the new schema column names, so that there is no naming mismatch between backend and frontend.

#### Acceptance Criteria

1. THE frontend Expense type SHALL use `volume` instead of mapping from `fuelAmount`
2. THE frontend Expense type SHALL NOT contain an `insurancePolicyId` field
3. THE frontend InsurancePolicy type SHALL NOT contain a `terms` JSON array field, `currentTermStart`, or `currentTermEnd`
4. THE frontend SHALL define a new `InsuranceTerm` type with flat fields matching the Insurance_Terms_Table columns
5. THE frontend Vehicle type SHALL NOT contain a `currentInsurancePolicyId` field
6. THE frontend VehicleFinancing type SHALL NOT contain a `currentBalance` field; balance SHALL be a computed field in the API response
7. THE frontend OdometerEntry type SHALL NOT contain `linkedEntityType` or `linkedEntityId` fields
8. THE API transformer SHALL remove the `fuelAmount` ↔ `volume` bridging logic since the column names now match end-to-end

### Requirement 23: Analytics Query Updates

**User Story:** As a developer, I want analytics queries to use the new table structure, so that insurance analytics query the insurance_terms table and unit preferences come from user_preferences.

#### Acceptance Criteria

1. WHEN computing insurance analytics, THE analytics repository SHALL query the Insurance_Terms_Table directly instead of parsing JSON from insurance_policies
2. WHEN computing fleet health scores, THE analytics repository SHALL derive the active insurance policy for a vehicle via JOIN through insurance_terms and insurance_term_vehicles instead of reading `vehicles.current_insurance_policy_id`
3. WHEN reading user unit preferences, THE analytics repository SHALL query the User_Preferences_Table instead of the User_Settings_Table

### Requirement 24: User Providers Table Baseline

**User Story:** As a developer, I want the schema v2 spec to acknowledge the current state of user_providers (post-OAuth), so that no conflicting changes are made to this table.

#### Acceptance Criteria

1. THE user_providers table SHALL remain unchanged from its current state, which includes the `provider_account_id` column and the `up_auth_identity_idx` partial unique index added by the multi-provider OAuth spec
2. THE schema v2 migration SHALL NOT modify the user_providers table structure or indexes

### Requirement 25: Backend Infrastructure Updates

**User Story:** As a developer, I want the config, types, and Drizzle schema infrastructure updated for the new table structure, so that the backup pipeline, type system, and ORM all compile and function correctly.

#### Acceptance Criteria

1. THE `TABLE_SCHEMA_MAP` in `backend/src/config.ts` SHALL include entries for `insuranceTerms`, `insuranceTermVehicles`, `userPreferences`, and `syncState`, and SHALL NOT include entries for `insurancePolicyVehicles` or `userSettings`
2. THE `TABLE_FILENAME_MAP` in `backend/src/config.ts` SHALL include corresponding CSV filenames for the new tables and SHALL NOT include filenames for removed tables
3. THE `OPTIONAL_BACKUP_FILES` set and `getRequiredBackupFiles()` function SHALL be updated for the new table filenames
4. THE `BackupData` and `ParsedBackupData` interfaces in `backend/src/types.ts` SHALL include fields for `insuranceTerms`, `insuranceTermVehicles`, `userPreferences`, and `syncState`, and SHALL NOT include fields for `insurancePolicyVehicles` or `userSettings`
4. THE `BackupData` and `ParsedBackupData` interfaces SHALL NOT include a `financing.currentBalance` field, a `vehicles.currentInsurancePolicyId` field, or an `insurance.terms` JSON field
5. THE `PolicyTerm` interface SHALL be removed from `backend/src/db/schema.ts` since the `terms` JSON column no longer exists
6. THE schema SHALL export new Drizzle inferred types: `InsuranceTerm`, `NewInsuranceTerm`, `InsuranceTermVehicle`, `NewInsuranceTermVehicle`, `UserPreferences`, `NewUserPreferences`, `SyncState`, `NewSyncState`
7. THE schema SHALL NOT export `UserSettings`, `NewUserSettings`, `InsurancePolicyVehicle`, or `NewInsurancePolicyVehicle` types
8. THE `expensesRelations` in `schema.ts` SHALL be updated to reflect the new `insurance_term_id` FK relationship to `insurance_terms`
9. THE `types.ts` re-exports SHALL be updated: remove `NewUserSettings`, `UserSettings`, `InsurancePolicyVehicle`, `NewInsurancePolicyVehicle` and add the new type exports

### Requirement 26: Validation Schema Updates

**User Story:** As a developer, I want the Zod validation schemas updated for the new column names and term structure, so that API request validation matches the v2 schema.

#### Acceptance Criteria

1. THE expense validation schemas in `backend/src/api/expenses/routes.ts` and `backend/src/api/expenses/validation.ts` SHALL use `volume` instead of `fuelAmount` and SHALL NOT include `insurancePolicyId`
2. THE insurance validation schema in `backend/src/api/insurance/validation.ts` SHALL validate term data with flat fields (`policyNumber`, `coverageDescription`, `deductibleAmount`, `coverageLimit`, `agentName`, `agentPhone`, `agentEmail`, `totalCost`, `monthlyCost`, `premiumFrequency`, `paymentAmount`) instead of nested `policyDetails` and `financeDetails` objects
3. THE `validateFuelExpenseData` utility function and all call sites SHALL use `volume` instead of `fuelAmount`

### Requirement 27: Settings Repository Split

**User Story:** As a developer, I want the settings repository split into two repositories matching the two new tables, so that preferences and sync state have separate data access layers.

#### Acceptance Criteria

1. THE codebase SHALL contain a `PreferencesRepository` that reads and writes the User_Preferences_Table, providing `getByUserId`, `getOrCreate`, and `update` methods
2. THE codebase SHALL contain a `SyncStateRepository` that reads and writes the Sync_State_Table, providing `markDataChanged`, `hasChangesSinceLastSync`, `updateSyncDate`, and `updateBackupDate` methods
3. THE codebase SHALL NOT contain a `SettingsRepository` that reads or writes a `user_settings` table
4. THE activity tracker middleware SHALL read `syncOnInactivity`, `syncInactivityMinutes`, and `backupConfig` from the Preferences_Repository instead of the former Settings_Repository
5. THE backup orchestrator SHALL call `SyncStateRepository.updateBackupDate()` after a successful backup instead of the former Settings_Repository

### Requirement 28: Photo Repository and Provider Routes Updates

**User Story:** As a developer, I want the photo repository and provider routes updated to use the new `user_id` column on photos, so that user-scoped photo queries are direct lookups instead of multi-branch JOINs.

#### Acceptance Criteria

1. THE `PhotoRepository.create()` method SHALL accept and store a `userId` parameter on new photo rows
2. THE `PhotoService` SHALL pass the authenticated user's `userId` to `PhotoRepository.create()`
3. THE `countUserPhotos` and `findUserPhotoIds` functions in `backend/src/api/providers/routes.ts` SHALL query `photos WHERE user_id = ?` directly instead of using 4-branch entity-type JOINs
4. THE `validateEntityOwnership` function in `backend/src/api/photos/helpers.ts` SHALL check `photos.user_id` directly for operations on existing photos (delete, set cover). For new photo uploads (where no photo row exists yet), THE function SHALL continue to validate entity ownership through the entity tables.

### Requirement 29: Seed Script Updates

**User Story:** As a developer, I want the seed script updated for the v2 schema, so that the development database is populated with valid v2 data on startup.

#### Acceptance Criteria

1. THE seed script SHALL create `insurance_terms` rows with flat columns instead of inserting `terms` JSON arrays on insurance policies
2. THE seed script SHALL create `insurance_term_vehicles` junction rows instead of `insurance_policy_vehicles` rows
3. THE seed script SHALL NOT insert `currentBalance` on vehicle financing rows
4. THE seed script SHALL use `volume` instead of `fuelAmount` on expense rows
5. THE seed script SHALL NOT insert `currentTermStart`, `currentTermEnd`, or `terms` on insurance policy rows
6. THE seed script SHALL create `user_preferences` and `sync_state` rows instead of `user_settings` rows
7. THE seed script SHALL include `userId` on photo rows if photos are seeded

### Requirement 30: Test File Updates

**User Story:** As a developer, I want test files updated to match the v2 schema, so that all tests compile and pass against the new table structure.

#### Acceptance Criteria

1. THE test files `backend/src/api/financing/__tests__/hooks.property.test.ts` and `backend/src/api/odometer/__tests__/hooks.property.test.ts` SHALL be deleted since the hooks they test no longer exist
2. THE migration test helpers (`backend/src/db/__tests__/migration-helpers.ts`) SHALL be updated to seed data matching the v2 schema (e.g., `user_id` on expenses, no `current_balance` on financing, no `linked_entity_type` on odometer entries)
3. THE migration general test (`backend/src/db/__tests__/migration-general.test.ts`) SHALL update the expected tables list to include `insurance_terms`, `insurance_term_vehicles`, `user_preferences`, `sync_state` and exclude `insurance_policy_vehicles`, `user_settings`
4. ALL `ParsedBackupData` test objects in backup tests SHALL be updated for the v2 table structure
5. Insurance, expense, analytics, and photo test files SHALL be updated to reflect column renames, removed columns, and new table relationships

### Requirement 31: Vehicles Repository Update

**User Story:** As a developer, I want the vehicles repository updated to stop reading and writing the removed `current_insurance_policy_id` column, so that the repository compiles and functions correctly against the v2 schema.

#### Acceptance Criteria

1. THE vehicles repository SHALL NOT read or write a `currentInsurancePolicyId` column in any query
2. THE vehicles repository SHALL NOT include `currentInsurancePolicyId` in select, insert, or update operations

### Requirement 32: Active Insurance Policy Derivation

**User Story:** As a developer, I want a shared method to derive the active insurance policy for a vehicle, so that all consumers use the same query logic instead of duplicating the JOIN.

#### Acceptance Criteria

1. THE Insurance_Repository SHALL provide a method to derive the active insurance policy ID for a vehicle via JOIN through `insurance_terms` and `insurance_term_vehicles` WHERE `insurance_policies.is_active = 1`, ordered by `insurance_terms.end_date DESC LIMIT 1`
2. ALL consumers that previously read `vehicles.current_insurance_policy_id` (analytics fleet health, vehicle detail) SHALL use this shared method instead

### Requirement 33: Settings Routes Update

**User Story:** As a developer, I want the settings routes updated to read/write the new `user_preferences` table instead of `user_settings`, so that the settings API continues to function after the table split.

#### Acceptance Criteria

1. THE settings routes (`backend/src/api/settings/routes.ts`) SHALL read and write the User_Preferences_Table via the Preferences_Repository instead of the User_Settings_Table via the Settings_Repository
2. THE settings routes Zod validation schema SHALL be derived from the `userPreferences` Drizzle table definition instead of `userSettings`
3. THE settings routes SHALL NOT import `userSettings` from the schema
4. THE settings GET endpoint SHALL return preferences data from the User_Preferences_Table (the API response shape MAY be preserved by combining preferences and sync state internally)
5. THE settings PUT endpoint SHALL write to the User_Preferences_Table for user-facing fields and SHALL NOT write `lastBackupDate`, `lastSyncDate`, or `lastDataChangeDate` (those live in Sync_State_Table)

### Requirement 34: Storage Provider Registry Update

**User Story:** As a developer, I want the storage provider registry updated to read storage config from `user_preferences` instead of `user_settings`, so that provider resolution continues to work after the table split.

#### Acceptance Criteria

1. THE storage provider registry (`backend/src/api/providers/domains/storage/registry.ts`) SHALL read `storageConfig` from the User_Preferences_Table via the Preferences_Repository instead of the User_Settings_Table
2. THE storage provider registry SHALL NOT import `userSettings` from the schema

### Requirement 35: Utility Function Column Rename

**User Story:** As a developer, I want all utility functions that reference `fuelAmount` updated to use `volume`, so that the column rename is consistent across the entire codebase.

#### Acceptance Criteria

1. THE `EfficiencyExpense` interface in `backend/src/utils/calculations.ts` SHALL use `volume` instead of `fuelAmount`
2. ALL functions in `backend/src/utils/calculations.ts` that reference `fuelAmount` (e.g., `calculateAverageMPG`, efficiency computations) SHALL use `volume` instead
3. ALL property test files that create test expense objects with `fuelAmount` SHALL use `volume` instead (including `backend/src/utils/__tests__/calculations.property.test.ts`, `backend/src/utils/__tests__/vehicle-stats.property.test.ts`, `backend/src/utils/__tests__/validation.property.test.ts`)

### Requirement 36: Insurance Routes and Validation Rewrite

**User Story:** As a developer, I want the insurance routes and validation schemas rewritten for the new term-as-table structure, so that the API accepts flat term fields and performs standard CRUD on the `insurance_terms` table.

#### Acceptance Criteria

1. THE insurance routes SHALL perform term CRUD via separate `insurance_terms` table operations instead of JSON manipulation on the policy row
2. THE insurance routes SHALL NOT import `PolicyTerm` from the schema (the interface is removed)
3. THE `toStorableTerm` helper function in insurance routes SHALL be removed since terms are no longer converted to/from JSON strings
4. THE insurance routes SHALL accept flat term fields in request bodies instead of nested `policyDetails` and `financeDetails` objects
5. THE `InsurancePolicyWithVehicles` return type SHALL be updated to not include a `terms` JSON array — term data SHALL be returned from the `insurance_terms` table via separate queries or JOINs
