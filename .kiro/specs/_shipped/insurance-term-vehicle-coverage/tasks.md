# Implementation Plan: Insurance Term-Vehicle Coverage & General Expense Splitting

## Overview

This plan implements a general-purpose expense splitting system (`expense_groups` table + child expense materialization) and per-term vehicle coverage for insurance policies. Backend work comes first (schema, split service, repositories, routes, sync), followed by frontend (split config editor, expense form changes, insurance term UI). Each task builds incrementally on the previous.

## Tasks

- [x] 1. Schema migration and database changes
  - [x] 1.1 Add `expense_groups` table and `expenseGroupId` FK on `expenses` in `backend/src/db/schema.ts`
    - Define the `expenseGroups` table with all columns: `id`, `userId`, `splitConfig`, `category`, `tags`, `date`, `description`, `totalAmount`, `insurancePolicyId`, `insuranceTermId`, `createdAt`, `updatedAt`
    - Add `expenseGroupId` nullable FK column on the `expenses` table referencing `expenseGroups.id` with `onDelete: 'cascade'`
    - Export the new table and add Drizzle relations
    - **Piggyback: Expense photos support** — Add `'expense_group'` to the `PhotoEntityType` union type (currently `'vehicle' | 'expense' | 'trip' | 'insurance_policy'`). No new DB columns needed — the existing polymorphic `photos` table already supports this via `entityType` + `entityId`. This avoids a separate migration.
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 1.2 Rebuild `insurance_policy_vehicles` table with `(policyId, termId, vehicleId)` composite PK in `backend/src/db/schema.ts`
    - Add `termId` text column (NOT NULL)
    - Update composite PK to `(policyId, termId, vehicleId)`
    - Keep existing cascade delete FKs on `policyId` and `vehicleId`
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 1.3 Generate and apply the Drizzle migration
    - Run `bun run db:generate` to create the migration SQL
    - Verify the generated migration creates `expense_groups`, adds `expenseGroupId` to `expenses`, and rebuilds `insurance_policy_vehicles`
    - Run `bun run db:push` to apply
    - _Requirements: 15.1, 15.2, 15.3, 15.4_

  - [x] 1.4 Write migration tests in `backend/src/db/__tests__/`
    - Follow the pattern in existing migration test files (`migration-0000.test.ts`, etc.)
    - Test that `expense_groups` table is created with correct columns
    - Test that `expenseGroupId` column exists on `expenses` as nullable
    - Test that `insurance_policy_vehicles` has the new composite PK with `termId`
    - Test cascade delete behavior for `expenseGroupId` FK
    - _Requirements: 15.1, 15.2, 15.3, 15.4_

  - [x] 1.5 Update `backend/src/db/seed.ts` if needed to accommodate new schema
    - Ensure seed data doesn't break with the new columns
    - _Requirements: 15.4_

- [x] 2. Implement `ExpenseSplitService` in `backend/src/api/expenses/split-service.ts`
  - [x] 2.1 Implement `computeAllocations()` pure function
    - Handle `even` split: `floor(total / n * 100) / 100`, remainder cents to first vehicle
    - Handle `absolute` split: passthrough of input allocations
    - Handle `percentage` split: `floor(total * pct / 100 * 100) / 100`, remainder to last vehicle
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 2.2 Write property test: Allocation sum invariant
    - **Property 1: Allocation sum invariant**
    - For any valid SplitConfig and positive totalAmount, `sum(computeAllocations(config, totalAmount)[].amount) === totalAmount`
    - **Validates: Requirements 4.4, 5.4**

  - [x] 2.3 Write property test: Even split fairness
    - **Property 2: Even split fairness**
    - For any even split with N vehicles and positive totalAmount, max amount minus min amount <= 0.01
    - **Validates: Requirement 4.6**

  - [x] 2.4 Write property test: Allocation count matches vehicle count
    - **Property 3: Allocation count matches vehicle count**
    - For any valid SplitConfig and positive totalAmount, result length equals number of vehicles in config
    - **Validates: Requirements 4.5, 5.1**

  - [x] 2.5 Write property test: Absolute split passthrough
    - **Property 4: Absolute split passthrough**
    - For any absolute split where allocations sum to totalAmount, output amounts match input amounts in order
    - **Validates: Requirement 4.2**

  - [x] 2.6 Implement `materializeChildren()` method
    - Delete existing children `WHERE expenseGroupId = group.id`
    - Call `computeAllocations()` to get per-vehicle amounts
    - Insert child expenses copying `category`, `date`, `tags`, `description` from group
    - Set `expenseGroupId` and `vehicleId` on each child
    - Run inside the caller's transaction
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 2.7 Write property test: Materialized children sum equals group total
    - **Property 5: Materialized children sum equals group total**
    - For any expense group with valid split config, sum of child `expenseAmount` values equals `group.totalAmount`
    - **Validates: Requirements 5.4, 4.4**

  - [x] 2.8 Write property test: Idempotent regeneration
    - **Property 6: Idempotent regeneration**
    - Calling `materializeChildren` twice without config changes produces identical child expenses
    - **Validates: Requirement 5.5**

  - [x] 2.9 Write property test: Child expenses inherit group properties
    - **Property 7: Child expenses inherit group properties**
    - Every materialized child expense has `expenseGroupId` set to the group's ID, `vehicleId` from the split config, and `category`, `date`, `tags`, `description` matching the group's values
    - **Validates: Requirements 5.2, 5.3**

  - [x] 2.10 Implement `updateSplit()` method
    - Update group's `splitConfig` and optionally `totalAmount`
    - Delete old children and regenerate via `materializeChildren()`
    - Return updated group + children
    - _Requirements: 6.2_

- [x] 3. Split config validation schemas in `backend/src/api/expenses/validation.ts`
  - [x] 3.1 Add Zod schemas for `SplitConfig` discriminated union
    - `evenSplitSchema`, `absoluteSplitSchema`, `percentageSplitSchema` as discriminated union on `method`
    - `createSplitExpenseSchema` with `splitConfig`, `category`, `tags`, `date`, `description`, `totalAmount`, `insurancePolicyId`, `insuranceTermId`
    - `updateSplitSchema` with `splitConfig` and optional `totalAmount`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 3.2 Write property test: Split config validation correctness
    - **Property 9: Split config validation correctness**
    - Valid configs with correct method, non-empty vehicles, non-negative amounts, percentages in [0,100] are accepted; invalid configs are rejected
    - **Validates: Requirements 3.1, 3.3, 3.4**

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Expense group CRUD routes in `backend/src/api/expenses/`
  - [x] 5.1 Add expense group repository methods in `backend/src/api/expenses/repository.ts`
    - `createExpenseGroup()`: insert group row, call `materializeChildren()`, return group + children
    - `getExpenseGroup()`: fetch group + children, validate user ownership
    - `deleteExpenseGroup()`: delete group (children cascade)
    - Validate vehicle ownership for all vehicles in split config
    - _Requirements: 6.1, 6.3, 6.4, 6.5, 6.6_

  - [x] 5.2 Add expense split routes in `backend/src/api/expenses/routes.ts`
    - `POST /api/v1/expenses/split` — create group + children (201)
    - `PUT /api/v1/expenses/split/:id` — update split config, regenerate children
    - `GET /api/v1/expenses/split/:id` — get group with children
    - `DELETE /api/v1/expenses/split/:id` — delete group (cascade)
    - Wire validation schemas from 3.1
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 5.3 Write property test: Cascade delete integrity
    - **Property 8: Cascade delete integrity**
    - Deleting an expense group results in zero child expenses remaining with that `expenseGroupId`
    - **Validates: Requirements 1.4, 2.3, 2.4**

- [x] 6. Update insurance validation schemas in `backend/src/api/insurance/validation.ts`
  - Add `termVehicleCoverageSchema` with `vehicleIds`, optional `splitMethod`, optional `allocations`
  - Update `createPolicySchema`: replace top-level `vehicleIds` with per-term `vehicleCoverage`
  - Update `addTermSchema` to include `vehicleCoverage`
  - Update `updateTermSchema` with optional `vehicleCoverage`
  - Remove `vehicleIds` from `updatePolicySchema`
  - _Requirements: 7.1, 7.5, 7.6, 3.1_

- [x] 7. Update insurance repository in `backend/src/api/insurance/repository.ts`
  - [x] 7.1 Update `create()` to accept per-term `vehicleCoverage`
    - Strip `vehicleCoverage` from terms before storing in JSON
    - Insert junction rows `(policyId, termId, vehicleId)` per vehicle per term
    - Create expense group + materialize children for terms with `financeDetails.totalCost`
    - Sync `currentInsurancePolicyId` for active policies
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.7_

  - [x] 7.2 Update `addTerm()` to accept `vehicleCoverage`
    - Append term to `terms` JSON array (without `vehicleCoverage`)
    - Insert junction rows for the new term
    - Create expense group if `financeDetails.totalCost` is non-null
    - Update denormalized `currentTermStart`/`currentTermEnd`
    - _Requirements: 8.1, 8.2, 8.5_

  - [x] 7.3 Update `updateTerm()` to handle `vehicleCoverage` changes
    - Delete old junction rows for `(policyId, termId, *)`
    - Insert new junction rows
    - Call `ExpenseSplitService.updateSplit()` to regenerate children
    - Clear `currentInsurancePolicyId` for removed vehicles (if not covered by other terms)
    - _Requirements: 8.3, 8.4, 8.5_

  - [x] 7.4 Update `attachVehicleIds()` to include `termVehicleCoverage` from junction table
    - Query junction table for `{ termId, vehicleId }` rows
    - Attach as `termVehicleCoverage` array on the response
    - Keep `vehicleIds` as distinct union across all terms
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 7.5 Update `update()` to remove `vehicleIds` from `UpdatePolicyData`
    - Vehicle assignment is per-term only
    - _Requirements: 7.1_

  - [x] 7.6 Write property test: Term with totalCost creates expense group and children
    - **Property 10: Term with totalCost creates expense group and children**
    - For any term with non-null `financeDetails.totalCost` and at least one vehicle, creating/adding that term results in an expense group with matching `totalAmount` and children summing to `totalCost`
    - **Validates: Requirements 7.3, 8.1**

  - [x] 7.7 Write property test: Junction row correctness on policy create
    - **Property 11: Junction row correctness on policy create**
    - For T terms where term i covers V_i vehicles, junction table has exactly `sum(V_i)` rows with correct `(policyId, termId, vehicleId)` triples
    - **Validates: Requirement 7.2**

  - [x] 7.8 Write property test: Coverage update regenerates children
    - **Property 12: Coverage update regenerates children**
    - Updating a term's `vehicleCoverage` results in junction rows matching only the new vehicle set and child expenses regenerated with sum equaling `totalAmount`
    - **Validates: Requirements 8.3, 6.2**

  - [x] 7.9 Write property test: Vehicle removal clears policy reference
    - **Property 13: Vehicle removal clears policy reference**
    - A vehicle removed from a term's coverage (and not covered by other terms of the same policy) has `currentInsurancePolicyId` set to null
    - **Validates: Requirement 8.4**

  - [x] 7.10 Write property test: vehicleIds is the distinct union across terms
    - **Property 14: vehicleIds is the distinct union across terms**
    - The `vehicleIds` array in the API response equals the set of distinct vehicle IDs across all terms' junction rows
    - **Validates: Requirement 9.2**

- [x] 8. Update insurance routes in `backend/src/api/insurance/routes.ts`
  - Update `POST /api/v1/insurance` request body to use `terms[].vehicleCoverage` instead of top-level `vehicleIds`
  - Update `PUT /api/v1/insurance/:id` to remove `vehicleIds`
  - Update `POST /api/v1/insurance/:id/terms` to include `vehicleCoverage`
  - Update `PUT /api/v1/insurance/:id/terms/:termId` with optional `vehicleCoverage`
  - Ensure GET endpoints return enriched response with `termVehicleCoverage`
  - _Requirements: 7.1, 8.1, 8.3, 9.1, 9.2, 9.3_

- [x] 9. Update error handling for split-specific errors
  - Add validation in split service/routes for absolute sum mismatch (400) and percentage sum not 100 (400)
  - Add conflict error for duplicate term ID (409)
  - Add not-found error for non-existent expense group (404)
  - _Requirements: 14.1, 14.2, 14.3, 14.4_

- [x] 10. Wire up expense and expense_group photo support in `backend/src/api/photos/helpers.ts`
  - Add `'expense'` case to `validateEntityOwnership()`: look up expense → get `vehicleId` → verify vehicle belongs to user
  - Add `'expense_group'` case to `validateEntityOwnership()`: look up group → check `userId` matches
  - Add `'expense'` and `'expense_group'` cases to `resolveEntityDriveFolder()`: resolve to a flat `ExpensePhotos` subfolder under the main VROOM folder (no per-vehicle nesting — assets are always resolved from expense → photos, not the reverse)
  - _Piggyback on the expense splitting feature — no separate migration needed since the photos table is already polymorphic_

- [x] 11. Checkpoint - Backend core complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Update backup/restore/sync pipeline
  - [x] 12.1 Update `backend/src/config.ts`
    - Add `expense_groups` to `TABLE_SCHEMA_MAP` and `TABLE_FILENAME_MAP`
    - Add to `OPTIONAL_BACKUP_FILES` for old backup compatibility
    - _Requirements: 10.1_

  - [x] 12.2 Update `backend/src/types.ts`
    - Add `ExpenseGroup` type to `BackupData` and `ParsedBackupData` interfaces
    - _Requirements: 10.1_

  - [x] 12.3 Update `backend/src/api/sync/backup.ts`
    - Export `expense_groups` table in `createBackup()`
    - Add CSV output in `exportAsZip()`
    - Validate referential integrity for `expenseGroupId`
    - _Requirements: 10.1_

  - [x] 12.4 Update `backend/src/api/sync/restore.ts`
    - Insert `expense_groups` rows before `expenses` rows in `insertBackupData()`
    - Delete `expense_groups` rows in `deleteUserData()`
    - Old backups missing `expense_groups` are allowed to fail
    - _Requirements: 10.2, 10.3, 10.5_

  - [x] 12.5 Update `backend/src/api/sync/google-sheets.ts`
    - Add `getExpenseGroupsHeaders()` function
    - Add new sheet in `createSpreadsheet()`
    - Export/read expense groups in sync functions
    - _Requirements: 10.4_

- [x] 13. Checkpoint - Backend fully complete
  - Ensure all tests pass, ask the user if questions arise.
  - Run `bun run all:fix && bun run validate` in `backend/`

- [x] 14. Add frontend types and API service methods
  - [x] 14.1 Add `ExpenseGroup` and `SplitConfig` types in `frontend/src/lib/types/index.ts`
    - `SplitConfig` discriminated union (even, absolute, percentage)
    - `ExpenseGroup` type matching the backend schema
    - Add `expenseGroupId` to the existing `Expense` type
    - `TermVehicleCoverage` type for insurance term coverage
    - _Requirements: 1.1, 3.1, 9.1_

  - [x] 14.2 Add expense split API methods in `frontend/src/lib/services/expense-api.ts`
    - `createSplitExpense(data)` → `POST /api/v1/expenses/split`
    - `updateSplitExpense(id, data)` → `PUT /api/v1/expenses/split/:id`
    - `getSplitExpense(id)` → `GET /api/v1/expenses/split/:id`
    - `deleteSplitExpense(id)` → `DELETE /api/v1/expenses/split/:id`
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 14.3 Update insurance API service in `frontend/src/lib/services/insurance-api.ts`
    - Update create/update policy payloads to use per-term `vehicleCoverage` instead of top-level `vehicleIds`
    - Update response types to include `termVehicleCoverage`
    - _Requirements: 7.1, 9.1, 9.2_

- [x] 15. Implement `SplitConfigEditor` component
  - [x] 15.1 Create `SplitConfigEditor.svelte` in `frontend/src/lib/components/expenses/`
    - Props: `vehicles`, `totalAmount`, `splitMethod`, `allocations`, event callbacks
    - Split method selector (Even / Absolute / Percentage) using shadcn-svelte Select
    - Even mode: read-only computed per-vehicle amounts
    - Absolute mode: editable amount inputs per vehicle, validate sum equals total
    - Percentage mode: editable percentage inputs per vehicle, validate sum equals 100
    - Switching method resets allocations to even-split defaults
    - Vehicle display uses `nickname || year make model` format
    - _Requirements: 11.2, 11.3, 11.4, 11.5, 11.6_

  - [x] 15.2 Create `SplitExpenseToggle.svelte` in `frontend/src/lib/components/expenses/`
    - Checkbox + label "Split this cost among multiple vehicles"
    - Emits toggle state change
    - _Requirements: 11.1_

  - [x] 15.3 Create `SplitExpenseBadge.svelte` in `frontend/src/lib/components/expenses/`
    - Small `GitBranch` icon from lucide-svelte shown next to child expense amounts
    - Clickable — navigates to group's split editor
    - _Requirements: 12.2, 12.3_

- [x] 16. Update `ExpenseForm.svelte` for split mode
  - [x] 16.1 Add split toggle and multi-select vehicle behavior
    - When split toggle is enabled, switch vehicle selector from single-select to multi-select
    - Keep currently selected vehicle as first selection
    - Show `SplitConfigEditor` when split mode is active
    - New state: `isSplit`, `splitMethod`, `splitAllocations`, `selectedVehicleIds`
    - _Requirements: 11.1, 11.2, 11.7_

  - [x] 16.2 Update submit handler to branch between normal and split creation
    - When `isSplit`: call `POST /api/v1/expenses/split` via `expenseApi.createSplitExpense()`
    - When not split: use existing normal expense creation
    - _Requirements: 11.7_

  - [x] 16.3 Add edit-mode redirect for child expenses
    - After loading expense in edit mode, check if `expenseGroupId` is set
    - If set, redirect to the expense group's split editor page
    - _Requirements: 12.1_

- [x] 17. Update expense list to show split indicators
  - Add `SplitExpenseBadge` next to child expense amounts in expense list components
  - Clicking the badge navigates to the group's split editor
  - _Requirements: 12.2, 12.3_

- [x] 18. Update insurance term UI for per-term vehicle coverage
  - [x] 18.1 Update insurance term form to include `SplitConfigEditor`
    - Show `SplitConfigEditor` when a term has non-null `financeDetails.totalCost`
    - Default split method to `even`
    - Send `vehicleCoverage` object as part of term data on save
    - _Requirements: 13.1, 13.2, 13.3_

  - [x] 18.2 Update insurance policy creation form
    - Replace top-level vehicle selection with per-term vehicle coverage
    - Each term section includes vehicle multi-select + split config
    - _Requirements: 7.1, 7.6, 13.1_

  - [x] 18.3 Update insurance policy display to show per-term coverage
    - Show which vehicles each term covers
    - Display split method and allocations if applicable
    - _Requirements: 9.1, 9.2_

- [x] 19. Final checkpoint - Full feature complete
  - Ensure all tests pass, ask the user if questions arise.
  - Run `bun run all:fix && bun run validate` in `backend/`
  - Run `npm run all:fix && npm run validate` in `frontend/`

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests use fast-check and validate universal correctness properties from the design document
- Backend tasks (1–13) should be completed before frontend tasks (14–19)
- The split service is general-purpose — insurance is just one consumer
