# Implementation Plan: Schema V2

## Overview

Comprehensive schema v2 redesign following the 6-phase order. Pre-launch clean rebuild — no data migration, no v1 backup compatibility.


## Tasks

### Phase 1 — Schema & Infrastructure

- [x] 1. Update Drizzle schema and infrastructure (design §1, §24, §2)
  - [x] 1.1 Modify `backend/src/db/schema.ts` — vehicles table: remove `currentInsurancePolicyId` column and its FK reference
    - _Requirements: 3.1_
  - [x] 1.2 Modify vehicleFinancing table: remove `currentBalance` column
    - _Requirements: 4.1_
  - [x] 1.3 Modify insurancePolicies table: remove `terms` JSON column, `currentTermStart`, `currentTermEnd`; remove `PolicyTerm` interface
    - _Requirements: 1.4, 1.5, 25.5_
  - [x] 1.4 Add `insuranceTerms` table with flat columns (id, policyId FK CASCADE, startDate, endDate, policyNumber, coverageDescription, deductibleAmount, coverageLimit, agentName, agentPhone, agentEmail, totalCost, monthlyCost, premiumFrequency, paymentAmount, createdAt, updatedAt), indexes `it_policy_id_idx` and `it_policy_end_date_idx`
    - _Requirements: 1.1, 1.2, 1.3_
  - [x] 1.5 Add `insuranceTermVehicles` table with composite PK (termId, vehicleId), index `itv_vehicle_idx`; remove `insurancePolicyVehicles` table
    - _Requirements: 2.1, 2.2, 2.3_
  - [x] 1.6 Modify expenses table: rename `fuelAmount` → `volume`, remove `insurancePolicyId`, add `insuranceTermId` FK to insuranceTerms(id) ON DELETE SET NULL, add `expenses_insurance_term_idx`
    - _Requirements: 5.1, 5.2, 5.3, 5.4_
  - [x] 1.7 Modify odometerEntries table: remove `linkedEntityType`, `linkedEntityId`, remove `odometer_linked_entity_idx`
    - _Requirements: 6.1, 6.2_
  - [x] 1.8 Modify photos table: add `userId` FK to users(id) ON DELETE CASCADE, add `photos_user_entity_type_idx`
    - _Requirements: 7.1, 7.2_
  - [x] 1.9 Modify photoRefs: remove existing `pendingIdx` from Drizzle schema (will be manually appended as partial index)
    - _Requirements: 8.1_
  - [x] 1.10 Add `userPreferences` table (userId PK, FK to users CASCADE, all preference columns); add `syncState` table (userId PK, FK to users CASCADE, timestamp columns only — no createdAt/updatedAt); remove `userSettings` table
    - _Requirements: 9.1, 9.2, 9.3_
  - [x] 1.11 Update `expensesRelations` for insuranceTermId → insuranceTerms; export new types (InsuranceTerm, NewInsuranceTerm, InsuranceTermVehicle, NewInsuranceTermVehicle, UserPreferences, NewUserPreferences, SyncState, NewSyncState); remove old types (UserSettings, NewUserSettings, InsurancePolicyVehicle, NewInsurancePolicyVehicle)
    - _Requirements: 25.6, 25.7, 25.8_


- [x] 2. Update config and types infrastructure (design §24)
  - [x] 2.1 Update `backend/src/config.ts`: add `insuranceTerms`, `insuranceTermVehicles`, `userPreferences`, `syncState` to `TABLE_SCHEMA_MAP` and `TABLE_FILENAME_MAP`; remove `insurancePolicyVehicles`, `userSettings` entries; update `OPTIONAL_BACKUP_FILES` and `getRequiredBackupFiles()`
    - _Requirements: 25.1, 25.2, 25.3_
  - [x] 2.2 Update `backend/src/types.ts`: add fields for new tables in `BackupData` and `ParsedBackupData`; remove old table fields; remove `PolicyTerm` re-export; add new type re-exports; remove old type re-exports; remove `financing.currentBalance`, `vehicles.currentInsurancePolicyId`, `insurance.terms` from backup interfaces
    - _Requirements: 25.4, 25.9_

- [x] 3. Delete hook files (design §2)
  - [x] 3.1 Delete `backend/src/api/odometer/hooks.ts`
    - _Requirements: 10.4_
  - [x] 3.2 Delete `backend/src/api/financing/hooks.ts`
    - _Requirements: 11.4_
  - [x] 3.3 Delete `backend/src/api/financing/__tests__/hooks.property.test.ts` and `backend/src/api/odometer/__tests__/hooks.property.test.ts`
    - _Requirements: 30.1_

- [ ] 4. Checkpoint — Phase 1 validation
  - Run `cd backend && bun run all:fix && bun run validate` to verify schema compiles. Expect type errors in downstream files — those are fixed in subsequent phases. Ask the user if questions arise.


### Phase 2 — Repository Layer

- [x] 5. Split settings repository (design §11)
  - [x] 5.1 Rewrite `backend/src/api/settings/repository.ts`: create `PreferencesRepository` class with `getByUserId`, `getOrCreate`, `update` methods reading/writing `userPreferences` table; create `SyncStateRepository` class with `getOrCreate`, `markDataChanged`, `hasChangesSinceLastSync`, `updateSyncDate`, `updateBackupDate` methods reading/writing `syncState` table; export `preferencesRepository` and `syncStateRepository` singletons; remove old `SettingsRepository` class and `settingsRepository` singleton
    - _Requirements: 27.1, 27.2, 27.3_
  - [x] 5.2 Write property test for settings repository split
    - **Property 23: Settings repository split — preferences and sync state separate**
    - **Validates: Requirements 27.1, 27.2**

- [x] 6. Rewrite insurance repository (design §6)
  - [x] 6.1 Rewrite `backend/src/api/insurance/repository.ts`: remove all JSON parse-mutate-serialize logic, `syncDenormalizedFields`, `buildSplitConfig`, `stripVehicleCoverage`, `createExpensesForTerm`, `syncExpensesForTerm`, `syncVehicleReferences`, `clearRemovedVehicleRefs`, `PolicyTerm` import; implement standard CRUD on `insuranceTerms` table (INSERT/UPDATE/DELETE); implement junction management on `insuranceTermVehicles`; add `getCurrentTermDates(policyId)`, `findExpiringTerms(startDate, endDate)`, `getActiveInsurancePolicyId(vehicleId)` methods; update `InsurancePolicyWithVehicles` return type; implement `attachTermsAndCoverage`, `insertJunctionRows`, `validateVehicleOwnership` helpers
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 32.1, 32.2_
  - [x] 6.2 Write property test for current term derivation
    - **Property 1: Current term derivation returns latest term**
    - **Validates: Requirements 1.6**
  - [x] 6.3 Write property test for active policy derivation
    - **Property 2: Active policy derivation for vehicle**
    - **Validates: Requirements 3.2, 32.1**
  - [x] 6.4 Write property test for insurance term CRUD round-trip
    - **Property 11: Insurance term CRUD round-trip**
    - **Validates: Requirements 16.1, 36.1**
  - [x] 6.5 Write property test for expiring terms date range query
    - **Property 12: Expiring terms date range query**
    - **Validates: Requirements 16.3**
  - [x] 6.6 Write property test for term-vehicle junction FK cascade
    - **Property 13: Insurance term-vehicle junction FK cascade**
    - **Validates: Requirements 16.4**


- [x] 7. Update financing repository (design §9)
  - [x] 7.1 Update `backend/src/api/financing/repository.ts`: remove `updateBalance` and `markAsCompleted` methods; add `computeBalance(financingId)` method that looks up the financing record's `originalAmount` and `vehicleId`, then computes `originalAmount - COALESCE(SUM(expenses.expenseAmount), 0)` WHERE `is_financing_payment = 1` for the vehicle, clamped to min 0
    - _Requirements: 17.1, 17.2_
  - [x] 7.2 Update `backend/src/api/financing/routes.ts`: GET endpoints call `computeBalance()` and include `computedBalance` and `eligibleForPayoff: true` (when balance ≤ 0.01) in the API response; remove `currentBalance: financingData.originalAmount` from the POST handler's create call; remove `currentBalance` from any update calls; remove `currentBalance: true` from the `createFinancingSchema.omit()` call (the field no longer exists in the base schema after column removal); rewrite the DELETE handler to use `financingRepository.update(id, { isActive: false, endDate: new Date() })` instead of calling the removed `markAsCompleted()` method; add/update a PUT endpoint to explicitly set `isActive = false` for payoff
    - _Requirements: 17.3_
  - [x] 7.3 Write property test for financing balance computation
    - **Property 5: Financing balance computation**
    - **Validates: Requirements 4.2, 17.1**
  - [x] 7.4 Write property test for financing payoff eligibility flag
    - **Property 6: Financing payoff eligibility flag**
    - **Validates: Requirements 4.4, 17.3**

- [x] 8. Update odometer repository (design §10)
  - [x] 8.1 Update `backend/src/api/odometer/repository.ts`: remove `upsertFromLinkedEntity`, `deleteByLinkedEntity`, `findByLinkedEntity` methods; add `getHistory(vehicleId, options?)` method executing UNION query combining `expenses.mileage` (WHERE mileage IS NOT NULL) and `odometer_entries.odometer`, with `source` and `source_id` fields, ordered by date DESC, with LIMIT/OFFSET pagination and total count. Use Drizzle's `sql` tagged template for the UNION query.
    - _Requirements: 6.3, 6.4_
  - [x] 8.2 Update `backend/src/api/odometer/routes.ts`: add or update a GET endpoint (e.g., `GET /api/v1/odometer/:vehicleId/history` or update existing list endpoint) to call `odometerRepository.getHistory()` and return the UNION query results with pagination; remove `linkedEntityType: null, linkedEntityId: null` from the POST handler's create call; remove the `linkedEntityType` guard checks from PUT and DELETE handlers (all entries are now manual-only)
    - _Requirements: 6.3, 6.4_
  - [x] 8.3 Write property test for odometer UNION query
    - **Property 8: Odometer UNION query completeness and source labeling**
    - **Validates: Requirements 6.3, 6.4**

- [x] 9. Update photo repository (design §15)
  - [x] 9.1 Update `backend/src/api/photos/photo-repository.ts`: `create()` accepts and stores `userId` parameter; user-scoped queries use `WHERE user_id = ?` directly instead of 4-branch entity JOINs
    - _Requirements: 28.1, 28.3_
  - [x] 9.2 Write property test for photo userId storage and user-scoped queries
    - **Property 20: Photo create stores userId and user-scoped queries work**
    - **Validates: Requirements 28.1, 28.3**

- [x] 10. Update vehicles repository (design §20)
  - [x] 10.1 Update `backend/src/api/vehicles/repository.ts`: remove all reads/writes of `currentInsurancePolicyId` from select, insert, update operations
    - _Requirements: 31.1, 31.2_

- [x] 11. Update expense repository (design §5a)
  - [x] 11.1 Update `backend/src/api/expenses/repository.ts`: remove `insurancePolicyId` from `createSplitExpense()` data param type AND from the `createSiblings()` call inside it; in `updateSplitExpense()`, remove the `insurancePolicyId: firstOld.insurancePolicyId ?? undefined` line from the `createSiblings()` call; rename `fuelAmount` → `volume` in any query referencing the column; remove odometer cleanup from `deleteSplitExpense()` and `updateSplitExpense()` that references `linkedEntityType`/`linkedEntityId` on odometer_entries (those columns no longer exist — expense-linked odometer entries are eliminated in v2)
    - _Requirements: 5.6, 18.4_

- [ ] 12. Checkpoint — Phase 2 validation
  - Run `cd backend && bun run all:fix && bun run validate`. All repository files should compile. Ask the user if questions arise.


### Phase 3 — Routes & Middleware

- [x] 13. Simplify expense routes (design §3)
  - [x] 13.1 Update `backend/src/api/expenses/routes.ts`: remove all hook imports (`handleFinancingOnCreate/Update/Delete`, `handleOdometerOnExpenseCreate/Update/Delete`); remove hook calls from POST, PUT, DELETE handlers; keep the financing-record-exists validation for `isFinancingPayment = true` (the `findByVehicleId` check that validates a financing record exists — NOT the balance adjustment); rename `fuelAmount` → `volume` in `baseExpenseSchema`, `createExpenseSchema`, and PUT handler local variables (e.g., `finalFuelAmount` → `finalVolume`); remove `insurancePolicyId` from all schemas and route handler queries; update `validateFuelExpenseData` call sites to pass `volume`
    - _Requirements: 10.1, 10.2, 10.3, 11.1, 11.2, 11.3, 18.1, 18.2, 18.3, 18.4, 26.1_
  - [x] 13.2 Write property test for expense CRUD self-containment
    - **Property 9: Expense CRUD is self-contained**
    - **Validates: Requirements 10.1, 10.2, 10.3, 11.1, 11.2, 11.3, 18.1, 18.2, 18.3**

- [x] 14. Update expense validation (design §4)
  - [x] 14.1 Update `backend/src/api/expenses/validation.ts`: remove `insurancePolicyId` from `createSplitExpenseSchema` and `updateSplitSchema`
    - _Requirements: 26.1_

- [x] 15. Update split service (design §5)
  - [x] 15.1 Update `backend/src/api/expenses/split-service.ts`: remove `insurancePolicyId` from `createSiblings` params type AND from the `NewExpense` object body (line ~100 sets `insurancePolicyId: params.insurancePolicyId ?? null` — remove this line); keep `insuranceTermId` parameter
    - _Requirements: 5.6_

- [x] 16. Rewrite insurance routes (design §7)
  - [x] 16.1 Rewrite `backend/src/api/insurance/routes.ts`: remove `PolicyTerm` import and `toStorableTerm()` helper; routes accept flat term fields in request bodies; term CRUD routes call standard INSERT/UPDATE/DELETE via repository; POST `/:id/terms`, PUT `/:id/terms/:termId`, DELETE `/:id/terms/:termId` endpoints
    - _Requirements: 36.1, 36.2, 36.3, 36.4, 36.5_
  - [x] 16.2 Write property test for insurance term creation not auto-creating expenses
    - **Property 10: Insurance term creation does not auto-create expenses**
    - **Validates: Requirements 12.1, 12.2**
  - [x] 16.3 Write property test for insurance term FK ON DELETE SET NULL
    - **Property 7: Insurance term FK ON DELETE SET NULL**
    - **Validates: Requirements 5.3, 5.5, 12.3**

- [x] 17. Rewrite insurance validation (design §8)
  - [x] 17.1 Rewrite `backend/src/api/insurance/validation.ts`: remove `policyDetailsSchema`, `financeDetailsSchema`, `policyTermSchema`; create flat `createTermSchema` with direct fields (policyNumber, coverageDescription, deductibleAmount, coverageLimit, agentName, agentPhone, agentEmail, totalCost, monthlyCost, premiumFrequency, paymentAmount, startDate, endDate, vehicleCoverage); create `updateTermSchema` (partial); create `createPolicySchema` with `company`, `terms[]`, `notes`, `isActive`
    - _Requirements: 26.2_
  - [x] 17.2 Write property test for insurance validation flat fields
    - **Property 19: Insurance validation accepts flat term fields**
    - **Validates: Requirements 26.2, 36.4**


- [x] 18. Update settings routes (design §12)
  - [x] 18.1 Update `backend/src/api/settings/routes.ts`: import `userPreferences` from schema instead of `userSettings`; derive Zod schema from `userPreferences` Drizzle table (remove `.omit({ lastBackupDate, lastSyncDate, lastDataChangeDate })` since those fields don't exist on `userPreferences`; also remove `id` from omit since `userPreferences` uses `userId` as PK); GET reads from `PreferencesRepository`; PUT writes to `userPreferences` for user-facing fields (not lastBackupDate/lastSyncDate/lastDataChangeDate); POST `/backup` route calls `syncStateRepository.updateBackupDate()` instead of writing `lastBackupDate` to settings; remove all `userSettings` imports
    - _Requirements: 33.1, 33.2, 33.3, 33.4, 33.5_

- [x] 19. Retarget activity tracker (design §13)
  - [x] 19.1 Update `backend/src/api/sync/activity-tracker.ts`: `markDataChanged()` calls `syncStateRepository.markDataChanged(userId)` instead of raw `db.update(userSettings)`; `hasChangesSinceLastSync()` calls `syncStateRepository.hasChangesSinceLastSync(userId)`; remove `userSettings` import, import `syncStateRepository`
    - _Requirements: 9.4, 27.4_
  - [x] 19.2 Update `backend/src/middleware/activity.ts`: read `syncOnInactivity`, `syncInactivityMinutes`, `backupConfig` from `preferencesRepository.getOrCreate()` instead of `settingsRepository`; import `preferencesRepository`
    - _Requirements: 27.4_
  - [x] 19.3 Write property test for activity tracker writing to sync_state
    - **Property 14: Activity tracker writes to sync_state**
    - **Validates: Requirements 9.4**

- [x] 20. Update backup orchestrator (design §14)
  - [x] 20.1 Update `backend/src/api/sync/backup-orchestrator.ts`: import `preferencesRepository` instead of `settingsRepository`; load `backupConfig` from `preferencesRepository.getOrCreate()`; after backup: call `preferencesRepository.update()` for per-provider `lastBackupAt`, `syncStateRepository.updateSyncDate()`, `syncStateRepository.updateBackupDate()`
    - _Requirements: 27.5_

- [x] 21. Update photo service (design §16)
  - [x] 21.1 Update `backend/src/api/photos/photo-service.ts`: pass authenticated user's `userId` to `PhotoRepository.create()`
    - _Requirements: 28.2_

- [x] 22. Simplify provider routes (design §17)
  - [x] 22.1 Update `backend/src/api/providers/routes.ts`: simplify `countUserPhotos()` and `findUserPhotoIds()` — replace ALL 4 entity-type branches (vehicle, expense, insurance_policy, odometer_entry) with a single `WHERE user_id = ? AND entity_type = ?` query pattern, eliminating all JOINs through entity tables; preserve `extraConditions` parameter support; import `preferencesRepository` instead of `settingsRepository`; remove `insurancePolicyVehicles` and `userSettings` imports; update `cleanupStorageConfig()` raw `db.update(userSettings)` to use `userPreferences` table; update `cleanupBackupConfig()` to use `preferencesRepository`; update backfill route's direct `userSettings` query to use `userPreferences`
    - _Requirements: 28.3_

- [x] 23. Update photo helpers (design §18)
  - [x] 23.1 Update `backend/src/api/photos/helpers.ts`: `validateEntityOwnership()` checks `photos.user_id` directly for existing photo operations (delete, set cover); for new uploads (no photo row), continue validating through entity tables
    - _Requirements: 28.4_
  - [x] 23.2 Write property test for validateEntityOwnership dual behavior
    - **Property 21: validateEntityOwnership dual behavior**
    - **Validates: Requirements 28.4**

- [x] 24. Update storage registry (design §19)
  - [x] 24.1 Update `backend/src/api/providers/domains/storage/registry.ts`: `loadStorageConfig()` reads from `userPreferences` table via `PreferencesRepository`; remove `userSettings` import
    - _Requirements: 34.1, 34.2_
  - [x] 24.2 Write property test for storage registry reading from user_preferences
    - **Property 24: Storage provider registry reads from user_preferences**
    - **Validates: Requirements 34.1**

- [x] 25. Update sync routes (design §23a)
  - [x] 25.1 Update `backend/src/api/sync/routes.ts`: import `preferencesRepository` instead of `settingsRepository`; replace all `settingsRepository.getOrCreate()` calls with `preferencesRepository.getOrCreate()` for reading backupConfig, syncOnInactivity, etc.; use `SyncStateRepository` for sync status reads; remove `settingsRepository` import
    - _Requirements: 27.3_

- [x] 26. Update vehicles routes (design §23b)
  - [x] 26.1 Update `backend/src/api/vehicles/routes.ts`: import `preferencesRepository` instead of `settingsRepository`; vehicle create handler reads `unitPreferences` from `preferencesRepository.getOrCreate()`; remove `settingsRepository` import
    - _Requirements: 27.3_

- [ ] 27. Checkpoint — Phase 3 backend validation
  - Run `cd backend && bun run all:fix && bun run validate`. All routes and middleware should compile and pass. Ask the user if questions arise.


### Phase 4 — Utilities

- [x] 28. Rename columns in calculations utility (design §21)
  - [x] 28.1 Update `backend/src/utils/calculations.ts`: rename `fuelAmount` → `volume` in `EfficiencyExpense` interface, `calculateAverageMPG()`, `calculateAverageMilesPerKwh()`, and all other functions referencing `fuelAmount`
    - _Requirements: 35.1, 35.2_
  - [x] 28.2 Update `backend/src/utils/analytics-charts.ts`: rename `fuelAmount` → `volume` in `FuelExpenseRow`, `GeneralExpenseRow`, `FuelRow` interfaces and all functions (`computeEfficiency`, `buildMonthlyFuelData`, `buildPricePerVolumeData`, `buildDayOfWeekData`, etc.); update `buildTCOMonthlyTrend()` to use `insuranceTermId` instead of `insurancePolicyId` for classifying insurance expenses
    - _Requirements: 35.2_
  - [x] 28.3 Update `backend/src/utils/vehicle-stats.ts`: rename `fuelAmount` → `volume` in `FuelExpense` interface, rename `sumFuelAmount()` → `sumVolume()`, and update all references to `expense.fuelAmount` → `expense.volume`
    - _Requirements: 35.1, 35.2_
  - [x] 28.4 Write property test for efficiency calculations using volume field
    - **Property 22: Efficiency calculations use volume field**
    - **Validates: Requirements 35.2**

- [x] 29. Update validation utility (design §22)
  - [x] 29.1 Update `backend/src/utils/validation.ts`: rename `fuelAmount` → `volume` in `validateFuelExpenseData()` function signature and body; update all call sites
    - _Requirements: 18.5, 26.3_

- [x] 30. Update analytics repository (design §26)
  - [x] 30.1 Update `backend/src/api/analytics/repository.ts`: remove imports for `insurancePolicyVehicles`, `PolicyTerm`, `userSettings`; add imports for `insuranceTerms`, `insuranceTermVehicles`, `userPreferences`; import `preferencesRepository` instead of `settingsRepository`
    - _Requirements: 23.1, 23.2, 23.3_
  - [x] 30.2 Rename `fuelAmount` → `volume` in `queryFuelExpenses()`, `queryAllExpenses()`, `queryFuelAggregates()`, and all fuel stats methods
    - _Requirements: 35.2_
  - [x] 30.3 Update `getUserUnits()` to query `userPreferences` table instead of `userSettings`
    - _Requirements: 23.3_
  - [x] 30.4 Rewrite insurance analytics methods: `getInsurance()`, `buildInsuranceDetails()`, `accumulateCarrierData()`, `buildInsuranceVehicleEntries()`, `accumulateMonthlyPremiums()` to query `insuranceTerms` table directly with flat fields instead of parsing JSON `PolicyTerm[]`; replace `insurancePolicyVehicles` with `insuranceTermVehicles` in junction queries
    - _Requirements: 23.1_
  - [x] 30.5 Rewrite fleet health methods: `computeFleetHealthScore()` and `queryActivePolicyIds()` to derive active policy via JOIN through `insuranceTerms` + `insuranceTermVehicles` instead of reading `vehicles.currentInsurancePolicyId`; also update the per-vehicle insurance detail path (around lines 1615-1632) that reads `currentInsurancePolicyId` for single-vehicle views
    - _Requirements: 23.2_
  - [x] 30.6 Update financing analytics methods: `getFinancing()`, `buildFinancingVehicleDetails()`, `buildSingleFinancingDetail()`, `buildFinancingTimeline()`, `buildLoanBreakdown()` to use `computeBalance()` from the financing repository instead of reading `currentBalance` from the financing record (the column no longer exists)
    - _Requirements: 23.1_
  - [x] 30.7 Write property test for analytics using terms table for insurance data
    - **Property 18: Analytics queries use terms table for insurance data**
    - **Validates: Requirements 23.1, 23.2, 23.3**

- [ ] 31. Checkpoint — Phase 4 validation
  - Run `cd backend && bun run all:fix && bun run validate`. All utilities and analytics should compile and pass. Ask the user if questions arise.


### Phase 5 — Data Pipeline

- [x] 32. Update backup/restore pipeline (design §23)
  - [x] 32.1 Update `backend/src/api/sync/backup.ts`: add queries for `insuranceTerms`, `insuranceTermVehicles`, `userPreferences`, `syncState` in `createBackup()`; export new tables instead of old ones; expenses CSV uses `volume` (not `fuelAmount`), no `insurancePolicyId`; photos CSV includes `userId`; odometer CSV excludes `linkedEntityType`/`linkedEntityId`; vehicles CSV excludes `currentInsurancePolicyId`; financing CSV excludes `currentBalance`; `loadBackupConfig()` uses `preferencesRepository`; `queryUserPhotos()` simplified to `WHERE user_id = ?`
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7_
  - [x] 32.2 Update `backend/src/api/sync/restore.ts`: import new schema tables; update `insertBackupData()` insert order and table targets (insuranceTerms, insuranceTermVehicles, userPreferences, syncState instead of old tables); update `deleteUserData()` for new tables (photos deletion simplified to `WHERE user_id = ?`); update `validateReferentialIntegrity()` for term→policy and junction→term refs; update `ImportSummary` type; use `preferencesRepository` instead of `settingsRepository`
    - _Requirements: 14.8, 14.9_
  - [x] 32.3 Update `validateBackupData()` and `validateReferentialIntegrity()` for new table structure
    - _Requirements: 14.9_
  - [x] 32.4 Write property test for backup round-trip data preservation
    - **Property 15: Backup round-trip preserves data**
    - **Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8**
  - [x] 32.5 Write property test for backup validation catching broken references
    - **Property 16: Backup validation catches broken references**
    - **Validates: Requirements 14.9**

- [x] 33. Update Google Sheets sync (design §25)
  - [x] 33.1 Update `backend/src/api/providers/services/google-sheets-service.ts`: add `Insurance Terms` sheet with flat columns; add `Insurance Term Vehicles` sheet (replaces `Insurance Policy Vehicles`); add `User Preferences` and `Sync State` sheets; update `Expenses` sheet headers (`volume` not `fuel_amount`, no `insurance_policy_id`); update `Photos` sheet headers (include `user_id`); update `Odometer Entries` headers (no `linked_entity_type`/`linked_entity_id`); update `Insurance Policies` headers (no `terms`/`current_term_start`/`current_term_end`); update `Vehicle Financing` headers (no `current_balance`); update `Vehicles` headers (no `current_insurance_policy_id`)
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7_
  - [x] 33.2 Write property test for Google Sheets export headers matching v2 schema
    - **Property 17: Google Sheets export headers match v2 schema**
    - **Validates: Requirements 15.3, 15.4, 15.5, 15.6, 15.7**

- [x] 34. Update seed script (design §27)
  - [x] 34.1 Update `backend/src/db/seed.ts`: create `insuranceTerms` rows with flat columns instead of JSON `terms` array; create `insuranceTermVehicles` junction rows instead of `insurancePolicyVehicles`; insurance policies without `currentTermStart`/`currentTermEnd`/`terms`; financing without `currentBalance`; expenses use `volume` instead of `fuelAmount`; create `userPreferences` + `syncState` rows instead of `userSettings`; photos include `userId`
    - _Requirements: 29.1, 29.2, 29.3, 29.4, 29.5, 29.6, 29.7_

- [ ] 35. Checkpoint — Phase 5 backend validation
  - Run `cd backend && bun run all:fix && bun run validate`. Full backend pipeline should compile and pass. Ask the user if questions arise.


### Phase 6 — Migration, Tests & Frontend

- [x] 36. Regenerate migration and add partial indexes (design §29)
  - [x] 36.1 Delete all existing migration files in `backend/drizzle/` (SQL files, `meta/` folder contents)
    - _Requirements: 13.1_
  - [x] 36.2 Run `bun run db:generate` from `backend/` to produce a single fresh `0000` migration
    - _Requirements: 13.2, 13.3_
  - [x] 36.3 Manually append 4 partial unique indexes to the generated `0000` migration SQL: `vf_active_vehicle_idx`, `vehicles_license_plate_idx`, `up_auth_identity_idx`, `pr_pending_idx`
    - _Requirements: 13.6_
  - [x] 36.4 Delete `backend/data/vroom.db*` files so the database is recreated on startup
    - _Requirements: 13.4_
  - [x] 36.5 Write property test for license plate partial unique index enforcement
    - **Property 3: License plate partial unique index enforcement**
    - **Validates: Requirements 3.3**
  - [x] 36.6 Write property test for active financing partial unique index enforcement
    - **Property 4: Active financing partial unique index enforcement**
    - **Validates: Requirements 4.3**

- [x] 37. Update test files (design §30)
  - [x] 37.1 Update `backend/src/db/__tests__/migration-helpers.ts`: update `seedCoreData()` for v2 schema (userId on expenses, no currentBalance on financing, no linkedEntityType on odometer, volume instead of fuelAmount, insuranceTerms rows instead of JSON terms)
    - _Requirements: 30.2_
  - [x] 37.2 Update `backend/src/db/__tests__/migration-general.test.ts`: update expected tables list — add `insurance_terms`, `insurance_term_vehicles`, `user_preferences`, `sync_state`; remove `insurance_policy_vehicles`, `user_settings`
    - _Requirements: 30.3_
  - [x] 37.3 Update `backend/src/api/sync/__tests__/backup.test.ts`: update all `ParsedBackupData` test objects for v2 table structure
    - _Requirements: 30.4_
  - [x] 37.4 Update insurance test files: flat term fields, insuranceTerms table CRUD, no JSON manipulation
    - _Requirements: 30.5_
  - [x] 37.5 Update expense test files: `volume` instead of `fuelAmount`, no `insurancePolicyId`
    - _Requirements: 30.5_
  - [x] 37.6 Update analytics test files: read from `insuranceTerms` table, `userPreferences` table
    - _Requirements: 30.5_
  - [x] 37.7 Update photo test files: include `userId` in test photo objects
    - _Requirements: 30.5_
  - [x] 37.8 Update utility test files (`calculations.property.test.ts`, `vehicle-stats.property.test.ts`, `validation.property.test.ts`): `volume` instead of `fuelAmount`
    - _Requirements: 35.3_

- [ ] 38. Checkpoint — Full backend validation
  - Run `cd backend && bun run all:fix && bun run validate`. All backend tests, types, and linting must pass. Ask the user if questions arise.

- [x] 39. Frontend type and transformer updates (design §28)
  - [x] 39.1 Update frontend Expense type: use `volume` instead of mapping from `fuelAmount`; remove `insurancePolicyId` field
    - _Requirements: 22.1, 22.2_
  - [x] 39.2 Update frontend InsurancePolicy type: remove `terms` JSON array, `currentTermStart`, `currentTermEnd`; define new `InsuranceTerm` type with flat fields matching insuranceTerms columns
    - _Requirements: 22.3, 22.4_
  - [x] 39.3 Update frontend Vehicle type: remove `currentInsurancePolicyId`
    - _Requirements: 22.5_
  - [x] 39.4 Update frontend VehicleFinancing type: remove `currentBalance`; balance is a computed field in API response
    - _Requirements: 22.6_
  - [x] 39.5 Update frontend OdometerEntry type: remove `linkedEntityType`, `linkedEntityId`
    - _Requirements: 22.7_
  - [x] 39.6 Update API transformer: remove `fuelAmount` ↔ `volume` bridging logic since column names now match end-to-end
    - _Requirements: 22.8_

- [x] 40. Frontend insurance flow changes (design §28)
  - [x] 40.1 Update insurance term components: use flat fields instead of nested `policyDetails`/`financeDetails`; term creation no longer auto-creates expenses; after saving a term with cost data, show prompt "Add expense for this term?"; term detail page shows "Create expense" action for terms without linked expenses
    - _Requirements: 19.1, 19.2, 19.3, 19.4_

- [x] 41. Frontend financing flow changes (design §28)
  - [x] 41.1 Update financing detail page: display computed balance from API; show "Mark as paid off" button when balance ≤ 0.01; button sends explicit API request to set `isActive = false`
    - _Requirements: 20.1, 20.2, 20.3_

- [x] 42. Frontend odometer history changes (design §28)
  - [x] 42.1 Update odometer history page: display UNION query results from API with `source` indicator (`'expense'` or `'manual'`) on each entry
    - _Requirements: 21.1, 21.2_

- [ ] 43. Checkpoint — Full frontend validation
  - Run `cd frontend && npm run all:fix && npm run validate`. All frontend types, linting, and tests must pass. Ask the user if questions arise.

- [ ] 44. Final checkpoint — End-to-end validation
  - Run `cd backend && bun run all:fix && bun run validate` and `cd frontend && npm run all:fix && npm run validate`. Ensure all tests pass across both projects. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation after each phase
- Property tests validate universal correctness properties from the design document
- This is a pre-launch rebuild — no data migration, no v1 backup compatibility
- The `user_providers` table is unchanged (Requirement 24)
- Partial unique indexes must be manually appended to the generated migration SQL since Drizzle cannot express WHERE clauses
