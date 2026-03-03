# Requirements Document

## Introduction

This document defines the requirements for two interconnected systems: a general-purpose expense splitting mechanism and per-term vehicle coverage for insurance policies. The expense splitting system uses a separate `expense_groups` table to represent cross-vehicle costs, materializing child expense rows in the existing `expenses` table. Insurance becomes a consumer of this system, creating expense groups per term with per-vehicle child expenses based on coverage configuration. The `insurance_policy_vehicles` junction table is repurposed to track per-term coverage with a `(policy_id, term_id, vehicle_id)` composite primary key.

## Glossary

- **Expense_Group**: A record in the `expense_groups` table representing a cross-vehicle cost allocation container. Holds total amount, split configuration, category, date, description, and optional insurance references.
- **Child_Expense**: An expense row in the `expenses` table with a non-null `expenseGroupId` FK, materialized from an expense group's split configuration. System-managed — regenerated when split config changes.
- **Split_Config**: A JSON object describing how a total amount is divided among vehicles. One of three methods: `even`, `absolute`, or `percentage`.
- **Split_Service**: The `ExpenseSplitService` class responsible for computing allocations and materializing/regenerating child expenses.
- **Junction_Table**: The `insurance_policy_vehicles` table with composite PK `(policyId, termId, vehicleId)` tracking which vehicles are covered by which term.
- **Term_Vehicle_Coverage**: The per-term specification of which vehicles a policy term covers and how costs are split among them.
- **Policy_Repository**: The `InsurancePolicyRepository` class responsible for CRUD operations on insurance policies, terms, and junction rows.
- **Expense_Repository**: The `ExpenseRepository` class responsible for CRUD operations on expenses and expense groups.
- **Split_Config_Editor**: The frontend component that allows users to configure split method and per-vehicle allocations.
- **Materialization**: The process of deleting existing child expenses and creating new ones from a split configuration.

## Requirements

### Requirement 1: Expense Group Schema

**User Story:** As a developer, I want a dedicated `expense_groups` table separate from `expenses`, so that cross-vehicle cost allocation is cleanly modeled without breaking existing expense queries.

#### Acceptance Criteria

1. THE Schema SHALL define an `expense_groups` table with columns: `id` (PK), `userId` (FK to users), `splitConfig` (JSON), `category` (text), `tags` (JSON), `date` (timestamp), `description` (text), `totalAmount` (real), `insurancePolicyId` (text, nullable), `insuranceTermId` (text, nullable), `createdAt` (timestamp), `updatedAt` (timestamp)
2. THE Schema SHALL add an `expenseGroupId` nullable FK column on the `expenses` table referencing `expense_groups.id` with cascade delete
3. THE Schema SHALL keep the `vehicleId` column on the `expenses` table as NOT NULL
4. WHEN an expense group is deleted, THE Database SHALL cascade-delete all child expenses referencing that group via the `expenseGroupId` FK

### Requirement 2: Insurance Policy Vehicles Junction Table

**User Story:** As a developer, I want the `insurance_policy_vehicles` junction table to track per-term vehicle coverage, so that each term can have its own set of covered vehicles.

#### Acceptance Criteria

1. THE Schema SHALL define the `insurance_policy_vehicles` table with columns: `policyId` (FK to insurance_policies), `termId` (text), `vehicleId` (FK to vehicles)
2. THE Schema SHALL use a composite primary key of `(policyId, termId, vehicleId)` on the junction table
3. WHEN an insurance policy is deleted, THE Database SHALL cascade-delete all junction rows referencing that policy
4. WHEN a vehicle is deleted, THE Database SHALL cascade-delete all junction rows referencing that vehicle

### Requirement 3: Split Config Validation

**User Story:** As a user, I want the system to validate my split configuration, so that cost allocations are mathematically correct before being applied.

#### Acceptance Criteria

1. THE Validation_Layer SHALL accept split configs with method `even`, `absolute`, or `percentage` as a discriminated union on the `method` field
2. WHEN the split method is `even`, THE Validation_Layer SHALL require a `vehicleIds` array with at least one entry
3. WHEN the split method is `absolute`, THE Validation_Layer SHALL require an `allocations` array where each entry has a `vehicleId` and a non-negative `amount`
4. WHEN the split method is `percentage`, THE Validation_Layer SHALL require an `allocations` array where each entry has a `vehicleId` and a `percentage` between 0 and 100
5. WHEN creating a split expense, THE Validation_Layer SHALL require a positive `totalAmount`, a non-empty `category`, and a valid `date`

### Requirement 4: Compute Allocations

**User Story:** As a developer, I want a pure function that computes per-vehicle dollar amounts from a split config and total, so that allocation logic is testable and reusable.

#### Acceptance Criteria

1. WHEN the split method is `even`, THE Split_Service SHALL divide the total amount equally among all vehicles, assigning remainder cents to the first vehicle
2. WHEN the split method is `absolute`, THE Split_Service SHALL return each vehicle's specified amount unchanged
3. WHEN the split method is `percentage`, THE Split_Service SHALL compute each vehicle's amount as `floor(total * percentage / 100 * 100) / 100`, assigning remainder cents to the last vehicle
4. THE Split_Service SHALL return allocations whose amounts sum to exactly the input `totalAmount` for all split methods
5. THE Split_Service SHALL return one allocation entry per vehicle specified in the split config
6. WHEN the split method is `even`, THE Split_Service SHALL produce amounts that differ by at most one cent between any two vehicles

### Requirement 5: Child Expense Materialization

**User Story:** As a developer, I want the system to automatically create and regenerate child expenses from an expense group's split config, so that per-vehicle cost records stay in sync with the group.

#### Acceptance Criteria

1. WHEN an expense group is created, THE Split_Service SHALL delete any existing child expenses for that group and insert new child expenses — one per vehicle in the split config
2. THE Split_Service SHALL set each child expense's `vehicleId` to the corresponding vehicle from the split config and `expenseGroupId` to the group's ID
3. THE Split_Service SHALL copy `category`, `date`, `tags`, and `description` from the expense group to each child expense
4. THE Split_Service SHALL ensure the sum of all child expenses' `expenseAmount` values equals the expense group's `totalAmount`
5. WHEN `materializeChildren` is called multiple times on the same group without config changes, THE Split_Service SHALL produce identical child expenses each time (idempotent regeneration)

### Requirement 6: Expense Group CRUD API

**User Story:** As a user, I want API endpoints to create, read, update, and delete expense groups, so that I can manage cross-vehicle cost splits.

#### Acceptance Criteria

1. WHEN a POST request is sent to `/api/v1/expenses/split` with a valid split config and total amount, THE Expense_Repository SHALL create an expense group and return the group with its materialized children with HTTP status 201
2. WHEN a PUT request is sent to `/api/v1/expenses/split/:id` with a new split config, THE Split_Service SHALL update the group's split config, delete old children, regenerate new children, and return the updated group with children
3. WHEN a GET request is sent to `/api/v1/expenses/split/:id`, THE Expense_Repository SHALL return the expense group and its child expenses
4. WHEN a DELETE request is sent to `/api/v1/expenses/split/:id`, THE Expense_Repository SHALL delete the expense group and cascade-delete all child expenses
5. WHEN a user attempts to access an expense group belonging to another user, THE API SHALL return a 404 error
6. WHEN a user references a vehicle they do not own in a split config, THE API SHALL return a 404 error

### Requirement 7: Insurance Policy Creation with Per-Term Coverage

**User Story:** As a user, I want to create insurance policies with per-term vehicle coverage, so that each term can cover different vehicles with different cost splits.

#### Acceptance Criteria

1. WHEN creating a policy, THE Policy_Repository SHALL accept a `vehicleCoverage` object on each term specifying `vehicleIds`, optional `splitMethod`, and optional `allocations`
2. WHEN creating a policy, THE Policy_Repository SHALL insert junction rows `(policyId, termId, vehicleId)` for each vehicle in each term's coverage
3. WHEN a term has a non-null `financeDetails.totalCost`, THE Policy_Repository SHALL create an expense group with the term's total cost and vehicle coverage split config, and materialize child expenses via the Split_Service
4. WHEN a policy is created with `isActive: true`, THE Policy_Repository SHALL set `currentInsurancePolicyId` on all covered vehicles
5. THE Validation_Layer SHALL require at least one term when creating a policy
6. THE Validation_Layer SHALL require at least one vehicle in each term's `vehicleCoverage`
7. WHEN any `vehicleId` in the coverage does not belong to the authenticated user, THE Policy_Repository SHALL return a 404 error

### Requirement 8: Insurance Term Management

**User Story:** As a user, I want to add and update terms on existing policies with per-term vehicle coverage, so that I can manage policy renewals and coverage changes over time.

#### Acceptance Criteria

1. WHEN adding a term to a policy, THE Policy_Repository SHALL append the term to the policy's `terms` JSON array, insert junction rows for the term's vehicle coverage, and create an expense group if `financeDetails.totalCost` is non-null
2. WHEN adding a term with an ID that already exists in the policy, THE Policy_Repository SHALL return a 409 conflict error
3. WHEN updating a term's `vehicleCoverage`, THE Policy_Repository SHALL delete old junction rows for that term, insert new junction rows, and regenerate child expenses via the Split_Service
4. WHEN a vehicle is removed from a term's coverage during an update, THE Policy_Repository SHALL clear that vehicle's `currentInsurancePolicyId` if the vehicle is not covered by any other term of the same policy
5. WHEN updating a term, THE Policy_Repository SHALL update the policy's `currentTermStart` and `currentTermEnd` denormalized fields

### Requirement 9: Insurance API Response Shape

**User Story:** As a frontend developer, I want insurance API responses to include per-term vehicle coverage data, so that the UI can display which vehicles each term covers.

#### Acceptance Criteria

1. WHEN returning a policy via GET endpoints, THE API SHALL include a `termVehicleCoverage` array containing `{ termId, vehicleId }` objects from the junction table
2. WHEN returning a policy via GET endpoints, THE API SHALL include a `vehicleIds` array containing the distinct vehicle IDs across all terms
3. THE API SHALL return the same enriched response shape for both single-policy and list-policy GET endpoints

### Requirement 10: Backup, Restore, and Sync

**User Story:** As a user, I want the backup/restore and Google Sheets sync systems to handle expense groups, so that my split expense data is preserved across backups.

#### Acceptance Criteria

1. THE Backup_Service SHALL export the `expense_groups` table as part of the backup archive
2. THE Restore_Service SHALL insert `expense_groups` rows before `expenses` rows to satisfy the `expenseGroupId` FK constraint
3. THE Restore_Service SHALL delete `expense_groups` rows as part of `deleteUserData()`
4. THE Google_Sheets_Service SHALL include an `expense_groups` sheet with appropriate headers in the synced spreadsheet
5. IF an old backup file is missing the `expense_groups` table or `expenseGroupId` column, THEN THE Restore_Service SHALL allow the restore to fail without graceful handling

### Requirement 11: Frontend Split Expense Creation

**User Story:** As a user, I want a toggle on the expense creation form to split a cost among multiple vehicles, so that I can allocate shared costs without manual math.

#### Acceptance Criteria

1. WHEN the user enables the split toggle on the expense form, THE UI SHALL switch the vehicle selector from single-select to multi-select mode, keeping the currently selected vehicle as the first selection
2. WHEN split mode is enabled, THE UI SHALL display a Split_Config_Editor showing the split method selector (Even, Absolute, Percentage) and per-vehicle allocation inputs
3. WHEN the split method is `even`, THE Split_Config_Editor SHALL display read-only computed per-vehicle amounts
4. WHEN the split method is `absolute`, THE Split_Config_Editor SHALL display editable amount inputs per vehicle and validate that amounts sum to the total
5. WHEN the split method is `percentage`, THE Split_Config_Editor SHALL display editable percentage inputs per vehicle and validate that percentages sum to 100
6. WHEN the user switches split method, THE Split_Config_Editor SHALL reset allocations to even-split defaults
7. WHEN the user submits a split expense, THE UI SHALL call `POST /api/v1/expenses/split` instead of the normal expense creation endpoint

### Requirement 12: Frontend Child Expense Behavior

**User Story:** As a user, I want child expenses to redirect me to the group editor when tapped, so that I always manage splits as a unit rather than editing individual children.

#### Acceptance Criteria

1. WHEN a user opens an expense with a non-null `expenseGroupId` in edit mode, THE UI SHALL redirect to the expense group's split editor instead of the normal edit form
2. WHEN displaying child expenses in expense lists, THE UI SHALL show a split icon (GitBranch from lucide-svelte) next to the amount
3. WHEN the user clicks the split icon on a child expense, THE UI SHALL navigate to the group's split editor

### Requirement 13: Insurance Term UI Vehicle Coverage

**User Story:** As a user, I want the insurance term form to let me configure per-term vehicle coverage with cost splitting, so that I can specify which vehicles each term covers and how costs are divided.

#### Acceptance Criteria

1. WHEN creating or editing an insurance term with a non-null `financeDetails.totalCost`, THE UI SHALL display the Split_Config_Editor for configuring vehicle coverage and cost allocation
2. THE UI SHALL default the split method to `even` when no split method is specified
3. WHEN the user saves a term with vehicle coverage, THE UI SHALL send the `vehicleCoverage` object as part of the term data to the backend

### Requirement 14: Error Handling

**User Story:** As a user, I want clear error messages when split operations fail, so that I can correct my input.

#### Acceptance Criteria

1. WHEN absolute split allocations do not sum to the total amount, THE Validation_Layer SHALL return a 400 error with message "Absolute allocations must sum to total amount"
2. WHEN percentage split allocations do not sum to 100, THE Validation_Layer SHALL return a 400 error with message "Percentages must sum to 100"
3. WHEN a referenced expense group does not exist, THE API SHALL return a 404 error
4. WHEN a duplicate term ID is provided, THE Policy_Repository SHALL return a 409 error with message "Term with this ID already exists"

### Requirement 15: Migration

**User Story:** As a developer, I want a clean schema migration with no backward compatibility concerns, so that the new tables and columns are set up correctly.

#### Acceptance Criteria

1. THE Migration SHALL create the `expense_groups` table with all specified columns and constraints
2. THE Migration SHALL add the `expenseGroupId` nullable FK column to the `expenses` table with cascade delete
3. THE Migration SHALL rebuild the `insurance_policy_vehicles` table with the `(policyId, termId, vehicleId)` composite PK
4. THE Migration SHALL drop existing `insurance_policy_vehicles` rows since the schema is not in production
