# Implementation Plan: Schema Redesign

## Overview

Unify `expenses` and `expense_groups` tables into a single `expenses` table with direct `userId`, `groupId`, `groupTotal`, and `splitMethod` columns. Pre-launch change — edit schema directly, rebuild DB from scratch. No incremental migrations needed.

## Tasks

- [x] 1. Update Drizzle schema and regenerate migration
  - [x] 1.1 Edit `backend/src/db/schema.ts` with all schema changes
    - Add `userId` (NOT NULL, FK to users), `groupId`, `groupTotal`, `splitMethod` columns to `expenses` table
    - Remove `expenseGroupId` column from `expenses` table
    - Remove `expenseGroups` table definition, `SplitConfig` type, `ExpenseGroup`/`NewExpenseGroup` types, `expenseGroupsRelations`, `expensesRelations` (expenseGroup ref)
    - Add `expenses_user_date_idx`, `expenses_user_category_date_idx`, `expenses_group_idx` indexes to expenses
    - Add `vf_vehicle_id_idx` index to `vehicle_financing` table
    - Add `ipv_vehicle_policy_idx` index to `insurance_policy_vehicles` table
    - Remove old `expenseGroupIdx` index from expenses
    - Add `SplitMethod` type export
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 1.2 Delete old migrations and regenerate
    - Delete all files in `backend/drizzle/` (migration SQL files, meta folder)
    - Run `bun run db:generateom the new schema
    - Delete `backend/data/vroom.db` so it recreates on startup
    - _Requirements: 4.1, 4.2_

  - [x] 1.3 Update seed script
    - Update `backend/src/db/seed.ts` to include `userId` on all expense inserts
    - Remove any expense_group seeding
    - Update split expense seeds to use `groupId`/`groupTotal`/`splitMethod` instead of `expenseGroupId`
    - _Requirements: 4.3_

- [x] 2. Update Split Service
  - [ ] 2.1 Refactor `ExpenseSplitService` .ts`
    - Keep `computeAllocations()` signature unchanged (takes `SplitConfig`, returns allocations)
    - Replace `materializeChildren()` with `createSiblings()` that inserts expense rows directly with `groupId`, `groupTotal`, `splitMethod`, `userId`
    - Remove `updateSplit()` method (replaced by repository method)
    - Remove imports of `expenseGroups` table and `ExpenseGroup` type
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 2.2 Write property test: split sibling consistency (Property 2)
    - **Property 2: Split sibling consistency — all siblings share groupTotal, splitMethod, userId**
    - **Validates: Requirements 5.2, 14.2**

  - [x] 2.3 Write property test: split amounts sum to groupTotal (Property 3)
    - **Property 3: Split amounts sum to groupTotal within ±0.01**
    - **Validates: Requirements 5.3, 14.3**

- [x] 3. Update Expense Repository
  - [x] 3.1 Rewrite split expense methods in `backend/src/api/expenses/repository.ts`
    - Replace `createExpenseGroup()` with `createSplitExpense()` that calls `expenseSplitService.createSiblings()`
    - Replace `updateExpenseGroup()` with `updateSplitExpense()` that deletes old siblings, inserts new ones with same `groupId`, migrates photos from old to first new sibling
    - Replace `deleteExpenseGroup()` with `deleteSplitExpense()` that deletes all expenses by `groupId` plus associated photos and odometer entries
    - Replace `getExpenseGroup()` with `getSplitExpense()` that queries expenses by `groupId`
 table
    - _Requirements: 5.1, 5.5, 6.1, 6.2, 6.3, 7.1, 7.2, 7.3_

  - [x] 3.2 Update expense list/summary queries to use `expenses.userId`
    - Update `findPaginated()`, `findAll()`, `getSummary()`, `getPerVehicleStats()` to filter by `expenses.userId` directly instead of JOIN through vehicles
    - Remove vehicles JOIN from these methods (keep JOIN only where vehicle metadata is needed)
    - _Requirements: 1.1, 3.1, 3.2_

tos (Property 5)
    - **Property 5: Update preserves groupId, photos migrate to first new sibling**
    - **Validates: Requirements 6.1, 6.2**

- [x] 4. Update Expense Routes
  - [x] 4.1 Update split expense route handlers in `backend/src/api/expenses/routes.ts`
    - Update POST `/api/v1/expenses/split` to call `createSplitExpense()` and return `{ siblings, groupId, groupTotal, splitMethod }`
    - Update PUT `/api/v1/expenses/split/:groupId` for new `updateSplitExpense()` return type
    - Update GET `/api/v1/expenses/split/:groupId` for new `getSplitExpense()` return type
    - Keep request validation schema (`createSplitExpenseSchema`) unchanged — frontend still sends `splitConfig`
    - _Requirements: 5.1, 6.1_

- [x] 5. Update Insurance Repository
  - [x] 5.1 Refactor insurance expense methods in `backend/src/api/insurance/repository.ts`
    - Replace `createExpenseGroupForTerm()` with `createExpensesForTerm()` that calls `expenseSplitService.createSiblings()`
y `insurancePolicyId` + `insuranceTermId` directly (not from expense_groups)
    - Refactor `syncExpenseGroupForTerm()` → `syncExpensesForTerm()` to query expenses by `insurancePolicyId` + `insuranceTermId` + `groupId IS NOT NULL`
    - Update `handleCoverageUpdate()` to use new sync method
    - Remove all imports/references to `expenseGroups` table
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [x] 6. Update Photo Helpers
  - [x] 6.1 Update `backend/src/api/photos/helpers.ts`
    - Remove `validateExpenseGroupOwnership()` function
    - Remove `case 'expense_group':` from `validateEntityOwnership()` switch
    - Update `validateExpenseOwnership()` to query `expenses.userId` directly instead of joining through vehicles
    - Update `PhotoEntityType` in schema.ts to remove `'expense_group'`
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 7. Update Analytics Repository
  - [x] 7.1 Update `backend/src/api/analytics/repository.ts` to use `expenses.userId`
    - Update `queryAllExpenses()`, pending()`, `queryFuelAggregates()` to filter by `expenses.userId` instead of JOIN through vehicles
    - Remove vehicles JOIN from these methods
    - Keep vehicles JOIN only in methods that need vehicle metadata (name map, unit preferences)
    - _Requirements: 1.1, 3.1, 3.2_

- [x] 8. Checkpoint
  - Run `bun run all:fix && bun run validate` in backend. Fix any compilation errors from removed types/tables. Ask the user if questions arise.

- [x] 9. Update Backup/Restore Pipeline
ig and types
    - Remove `expenseGroups` from `TABLE_SCHEMA_MAP` and `TABLE_FILENAME_MAP` in `backend/src/config.ts`
    - Add `expense_groups.csv` to `OPTIONAL_BACKUP_FILES` for backward compat
    - Remove `expenseGroups` from `BackupData`, `ParsedBackupData` in `backend/src/types.ts`
    - Remove `expenseGroups` from `ImportSummary` in `backend/src/api/sync/restore.ts`
    - _Requirements: 10.2_

  - [x] 9.2 Update backup creation in `backend/src/api/sync/backup.ts`
    - Remove `expenseGroups` query from `createBackup()`
    - Export expenses with new columns (`userId`, `groupId`, `groupTotal`, `splitMethod`)
    - Remove `expense_groups.csv` from `exportAsZip()`
    - Remove `expense_group` from photo entity type validation in `validateReferentialIntegrity()`
    - Add validation: `expenses.userId` references valid user
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [x] 9.3 Update restore with backward compatibility in `backend/src/api/sync/restore.ts`
    - Detect old format (has `expenseGroupId`, no `userId` on expenses)
    - Transform old-format expenses: populate `userId` from vehicle-user map, convert `expenseGroupId` → `groupId`/`groupTotal`/`splitMethod` from expense_groups data
    - Transform `expense_group` photos → `expense` photos pointing to first child, discard orphans
    - Pass through new-format backups without transformation
    - Update `deleteUserData()` to delete expenses by `userId` directly, remove `expenseGroups` delete step
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_

  - [x] 9.4 Write property test: old backup restore preserves group semantics (Property 10)
    - **Property 10: Old backup with expense_groups restores correctly as sibling expenses**
    - **Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5**

- [x] 10. Update Google Sheets Service
  - [x] 10.1 Update `backend/src/api/providers/google-sheets-service.ts`
    - Remove `Expense Groups` sheet from `createSpreadsheet()` and `ensureRequiredSheets()`
    - Remove `getExpenseGroupsHeaders()` method
    - Update `getExpenseHeaders()` to include `userId`, `groupId`, `groupTotal`, `splitMethod` and exclude `expenseGroupId`
    - Update `updateSpreadsheetWithUserData()`: remove expenseGroups query, query expenses using `expenses.userId` directly, remove `Expense Groups` sheet update
    - Update `queryUserPhotos()`: remove `expense_group` entity type query
    - Update `readSpreadsheetData()`: remove `expenseGroups` from return type, add backward-compat transform for old spreadsheets with `Expense Groups` data
- _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

- [x] 11. Update Backend Tests
  - [x] 11.1 Update test helpers and existing tests
    - Update `seedCoreData` in `backend/src/db/__tests__/migration-helpers.ts` to include `user_id` in expense inserts
    - Update expected tables list in `migration-general.test.ts` to remove `expense_groups`
    - Update all `ParsedBackupData` test objects in `backup.test.ts`: remove `expenseGroups` field, add `userId` to expense rows
e test
    - Fix any other test files that reference `expenseGroups` or `expenseGroupId`
    - _Requirements: 14.1_

- [x] 12. Checkpoint
  - Run `bun run all:fix && bun run validate` in backend. All tests must pass. Ask the user if questions arise.

- [x] 13. Frontend Type and Service Changes
  - [x] 13.1 Update frontend types
    - Update `Expense` interface in `frontend/src/lib/types/expense.ts`: add `userId`, `groupId`, `groupTotal`, `splitMethod`; remove `expenseGroupId`
    - Replace `ExpenseGroupWithChildren` with `SplitExpenseGroup` interface (`{ siblings, groupId, groupTotal, splitMethod }`)
    - Remove `ExpenseGroup` type export
    - Keep `SplitConfig` type (still used for API requests)
    - _Requirements: 13.1, 13.2, 13.3_

  - [x] 13.2 Update API transformer and expense API service
    - Update `frontend/src/lib/services/api-transformer.ts`: map `groupId`/`groupTotal`/`splitMethod` instead of `expenseGroupId`
    - Update `frontend/src/lib/services/expense-api.ts`: change split method return types to `SplitExpenseGroup`, remove `'expense_group'` from photo entity types
    - _Requirements: 13.4_

- [x] 14. Frontend Component Changes
  - [x] 14.1 Update expense components
    - Update `ExpenseForm.svelte`: use `expense.groupId` instead of `expense.expenseGroupId`, photos use `entityType: 'expense'` only
    - Update `ExpensesTable.svelte`: group rows by `expense.groupId`
    - Update `ExpensePhotoSection.svelte`: remove `expense_group` from accepted entity types
    - _Requirements: 13.5, 13.6_

  - [x] 14.2 Update restore dialog
    - Remove `expenseGroups` count from restore preview display in `UnifiedRestoreDialog.svelte`
    - _Requirements: 13.7_

- [x] 15. Final validation
  - Run `bun run all:fix && bun run validate` in backend and `npm run all:fix && npm run validate` in frontend. All tests must pass. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional property tests — can be skipped for faster implementation
rebuilt from scratch.
- Split service changes (task 2) must complete before expense repository (task 3) and insurance repository (task 5)
- Backend must be stable (checkpoint at task 12) before frontend changes (tasks 13-14)
- `SplitConfig` type is kept in `validation.ts` for the API layer — only removed from `schema.ts`
- `computeAllocations()` signature is unchanged — insurance repo's `buildSplitConfig()` still works
