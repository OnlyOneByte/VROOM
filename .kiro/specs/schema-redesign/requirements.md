# Requirements Document

## Introduction

This document specifies the requirements for the schema redesign that unifies the `expenses` and `expense_groups` tables into a single `expenses` table. The redesign adds `userId` directly to expenses for query performance, replaces the parent/child expense group model with sibling rows sharing a `groupId`, drops the `expense_groups` table entirely, and adds missing indexes. The change ripples through backend repositories, services, routes, analytics, backup/restore, Google Sheets sync, photo helpers, and frontend types/components.

This is a pre-launch change — no production database exists, so the schema is edited directly and the DB is rebuilt from scratch.

## Glossary

- **Expenses_Table**: The SQLite `expenses` table storing all expense records, including standalone and split expenses
- **Split_Expense**: A multi-vehicle expense represented as sibling rows in the Expenses_Table sharing the same `groupId`
- **Sibling_Row**: An individual expense row that is part of a Split_Expense group, identified by a shared `groupId`
- **GroupId**: A UUID string shared by all Sibling_Rows in a Split_Expense, NULL for standalone expenses
- **GroupTotal**: The pre-split total amount stored on each Sibling_Row, identical across all siblings in a group
- **SplitMethod**: The method used to derive per-vehicle amounts from GroupTotal: `even`, `absolute`, or `percentage`
- **SplitConfig**: An API-layer type representing the split configuration sent by the frontend (method + vehicle allocations)
- **Photo_Entity_Type**: The polymorphic type discriminator for the photos table (`vehicle`, `expense`, `trip`, `insurance_policy`, `odometer_entry`)
- **Old_Format_Backup**: A backup ZIP created before this redesign, containing `expense_groups.csv` and expenses with `expenseGroupId`
- **New_Format_Backup**: A backup ZIP created after this redesign, with no `expense_groups.csv` and expenses with `userId`/`groupId`/`groupTotal`/`splitMethod`
- **Split_Service**: The `ExpenseSplitService` responsible for computing allocations and creating Sibling_Rows
- **Insurance_Repository**: The repository managing insurance policy CRUD and associated expense creation/sync
- **Google_Sheets_Service**: The service that syncs user data to/from Google Sheets spreadsheets

## Requirements

### Requirement 1: Schema Column Changes

**User Story:** As a developer, I want the expenses table to have direct userId, groupId, groupTotal, and splitMethod columns, so that expense queries no longer require JOINs through the vehicles table and split expense semantics are self-contained.

#### Acceptance Criteria

1. THE Expenses_Table SHALL include a `userId` column of type TEXT that is NOT NULL and references the users table with CASCADE on delete
2. THE Expenses_Table SHALL include a `groupId` column of type TEXT that is NULL for standalone expenses and contains a shared UUID for Split_Expense siblings
3. THE Expenses_Table SHALL include a `groupTotal` column of type REAL that stores the pre-split total amount for Split_Expense siblings
4. THE Expenses_Table SHALL include a `splitMethod` column of type TEXT that stores the SplitMethod value for Split_Expense siblings
5. THE Expenses_Table SHALL NOT contain the `expenseGroupId` column

### Requirement 2: Legacy Table Removal

**User Story:** As a developer, I want the expense_groups table dropped entirely, so that the codebase has a single unified expenses model.

#### Acceptance Criteria

1. THE database SHALL NOT contain an `expense_groups` table
2. THE database schema definitions SHALL NOT export `ExpenseGroup` or `NewExpenseGroup` types
3. THE database schema definitions SHALL NOT contain `expenseGroupsRelations`

### Requirement 3: Index Additions

**User Story:** As a developer, I want proper indexes on expenses, vehicle_financing, and insurance_policy_vehicles, so that query performance is optimized for common access patterns.

#### Acceptance Criteria

1. THE Expenses_Table SHALL have an index `expenses_user_date_idx` on columns (`userId`, `date`)
2. THE Expenses_Table SHALL have an index `expenses_user_category_date_idx` on columns (`userId`, `category`, `date`)
3. THE Expenses_Table SHALL have an index `expenses_group_idx` on column (`groupId`)
4. THE vehicle_financing table SHALL have an index `vf_vehicle_id_idx` on column (`vehicleId`)
5. THE insurance_policy_vehicles table SHALL have an index `ipv_vehicle_policy_idx` on columns (`vehicleId`, `policyId`)

### Requirement 4: Schema Generation

**User Story:** As a developer, I want a clean schema rebuild from the updated Drizzle definitions, so that the database matches the new schema without incremental migrations.

#### Acceptance Criteria

1. AFTER editing `schema.ts`, THE developer SHALL delete existing migration files in `backend/drizzle/` and regenerate with `bun run db:generate`
2. AFTER regenerating migrations, THE developer SHALL delete `backend/data/vroom.db` so it is recreated on startup
3. THE seed script SHALL be updated to include `userId` on all expense inserts

### Requirement 5: Split Expense Creation

**User Story:** As a user, I want to create multi-vehicle split expenses, so that I can allocate a single cost across multiple vehicles.

#### Acceptance Criteria

1. WHEN a split expense creation request is received with a valid SplitConfig and totalAmount, THE Split_Service SHALL create Sibling_Rows sharing the same GroupId
2. THE Split_Service SHALL set identical `groupTotal`, `splitMethod`, `userId`, `category`, and `date` values on all Sibling_Rows in a group
3. WHEN Sibling_Rows are created, THE sum of all sibling `expenseAmount` values SHALL equal the GroupTotal within a tolerance of ±0.01
4. WHEN a split expense is created, THE Split_Service SHALL create at least 2 Sibling_Rows per group
5. WHEN a split expense creation request is received, THE route handler SHALL validate that all vehicleIds in the SplitConfig belong to the requesting user

### Requirement 6: Split Expense Update

**User Story:** As a user, I want to update an existing split expense's allocation, so that I can correct or change how costs are distributed across vehicles.

#### Acceptance Criteria

1. WHEN a split expense update request is received, THE repository SHALL delete old Sibling_Rows and insert new Sibling_Rows with the same GroupId
2. WHEN old Sibling_Rows are deleted during update, THE repository SHALL migrate all photos attached to old siblings to the first new sibling
3. WHEN a split expense update is performed, THE repository SHALL verify that the GroupId belongs to the requesting user

### Requirement 7: Split Expense Deletion

**User Story:** As a user, I want to delete a split expense group, so that I can remove incorrectly entered multi-vehicle expenses.

#### Acceptance Criteria

1. WHEN a split expense deletion request is received, THE repository SHALL delete all expense rows matching the GroupId
2. WHEN Sibling_Rows are deleted, THE repository SHALL delete all photos attached to those expense rows
3. WHEN Sibling_Rows are deleted, THE repository SHALL delete all odometer entries linked to those expense rows

### Requirement 8: Photo Entity Type Update

**User Story:** As a developer, I want the photo system to no longer reference expense_group as an entity type, so that the polymorphic photo system is consistent with the unified expenses model.

#### Acceptance Criteria

1. THE Photo_Entity_Type enumeration SHALL include `vehicle`, `expense`, `trip`, `insurance_policy`, and `odometer_entry` only
2. THE Photo_Entity_Type enumeration SHALL NOT include `expense_group`
3. WHEN validating expense photo ownership, THE photo helpers SHALL query `expenses.userId` directly instead of joining through vehicles

### Requirement 9: Insurance Repository Changes

**User Story:** As a developer, I want the insurance repository to create split expenses directly as sibling rows, so that insurance-generated expenses use the unified model.

#### Acceptance Criteria

1. WHEN creating expenses for an insurance term, THE Insurance_Repository SHALL create Sibling_Rows via the Split_Service instead of creating an expense group row
2. WHEN deleting an insurance term, THE Insurance_Repository SHALL delete expenses by `insurancePolicyId` and `insuranceTermId` from the Expenses_Table directly
3. WHEN syncing expenses for an insurance term, THE Insurance_Repository SHALL query the Expenses_Table for existing expenses by `insurancePolicyId`, `insuranceTermId`, and `groupId IS NOT NULL`
4. WHEN coverage is updated for an insurance term, THE Insurance_Repository SHALL use the updated sync method to reconcile expenses

### Requirement 10: Backup Creation Changes

**User Story:** As a user, I want backups to reflect the new schema, so that backup files are consistent with the current data model.

#### Acceptance Criteria

1. WHEN creating a backup, THE backup service SHALL export expenses with `userId`, `groupId`, `groupTotal`, and `splitMethod` columns
2. WHEN creating a backup, THE backup service SHALL NOT export an `expense_groups.csv` file
3. WHEN creating a backup, THE backup service SHALL NOT include `expense_group` as a valid photo entity type
4. WHEN validating referential integrity during backup, THE backup service SHALL validate that `expenses.userId` references a valid user

### Requirement 11: Backward-Compatible Restore

**User Story:** As a user, I want to restore backups created before the schema redesign, so that I do not lose access to my historical data.

#### Acceptance Criteria

1. WHEN restoring an Old_Format_Backup, THE restore service SHALL detect the old format by checking for `expenseGroupId` presence and `userId` absence on expense records
2. WHEN restoring an Old_Format_Backup, THE restore service SHALL populate `userId` on each expense from the vehicle-to-user mapping in the backup's vehicles data
3. WHEN restoring an Old_Format_Backup, THE restore service SHALL convert `expenseGroupId` references to `groupId`, `groupTotal`, and `splitMethod` using the backup's expense_groups data
4. WHEN restoring an Old_Format_Backup, THE restore service SHALL transform photos with `entity_type = 'expense_group'` to `entity_type = 'expense'` pointing to the first child expense
5. WHEN restoring an Old_Format_Backup, THE restore service SHALL discard orphaned `expense_group` photos that have no matching child expense
6. WHEN restoring a New_Format_Backup, THE restore service SHALL insert expenses directly without transformation
7. WHEN deleting user data during restore, THE restore service SHALL delete expenses directly by `userId` without requiring vehicle ID lookups

### Requirement 12: Google Sheets Sync Changes

**User Story:** As a user, I want Google Sheets sync to reflect the new schema, so that my spreadsheet data matches the current data model.

#### Acceptance Criteria

1. WHEN creating a spreadsheet, THE Google_Sheets_Service SHALL NOT create an `Expense Groups` sheet
2. WHEN updating spreadsheet data, THE Google_Sheets_Service SHALL query expenses using `expenses.userId` directly without joining through vehicles
3. WHEN updating spreadsheet data, THE Google_Sheets_Service SHALL NOT write an `Expense Groups` sheet
4. WHEN exporting expense headers, THE Google_Sheets_Service SHALL include `userId`, `groupId`, `groupTotal`, `splitMethod` and exclude `expenseGroupId`
5. WHEN querying photos for spreadsheet export, THE Google_Sheets_Service SHALL NOT query for `expense_group` entity type photos
6. WHEN reading spreadsheet data from an old-format spreadsheet that contains an `Expense Groups` sheet, THE Google_Sheets_Service SHALL transform the data using the same backward-compatible logic as the restore service

### Requirement 13: Frontend Type and Component Changes

**User Story:** As a user, I want the frontend to work seamlessly with the new expense model, so that split expense creation, editing, and display continue to function correctly.

#### Acceptance Criteria

1. THE frontend Expense type SHALL include `userId`, `groupId`, `groupTotal`, and `splitMethod` fields and SHALL NOT include `expenseGroupId`
2. THE frontend type definitions SHALL replace `ExpenseGroupWithChildren` with `SplitExpenseGroup` containing `siblings`, `groupId`, `groupTotal`, and `splitMethod`
3. THE frontend type definitions SHALL NOT export `ExpenseGroup` or `ExpenseGroupWithChildren` types
4. WHEN the API transformer maps expense responses, THE transformer SHALL map `groupId`, `groupTotal`, and `splitMethod` instead of `expenseGroupId`
5. WHEN displaying expenses in a table, THE expenses table component SHALL group rows by `expense.groupId` instead of `expense.expenseGroupId`
6. WHEN uploading photos for expenses, THE expense form component SHALL use `entityType: 'expense'` and SHALL NOT use `entityType: 'expense_group'`
7. WHEN displaying a restore preview, THE restore dialog SHALL NOT display an `expenseGroups` count

### Requirement 14: Data Integrity Invariants

**User Story:** As a developer, I want strong data integrity invariants enforced at the database and application level, so that the unified expenses model remains consistent.

#### Acceptance Criteria

1. FOR ALL expenses in the Expenses_Table, THE `userId` value SHALL match the `userId` of the vehicle referenced by `vehicleId`
2. FOR ALL Split_Expense groups sharing a GroupId, THE `groupTotal`, `splitMethod`, `userId`, `category`, and `date` values SHALL be identical across all Sibling_Rows
3. FOR ALL Split_Expense groups sharing a GroupId, THE absolute difference between the sum of sibling `expenseAmount` values and the `groupTotal` SHALL be less than 0.02
4. FOR ALL GroupId values that are not NULL, THE count of expenses with that GroupId SHALL be at least 2
