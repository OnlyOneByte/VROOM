# Requirements Document

## Introduction

This feature allows users to flag a fuel fill-up as "missed previous fill-up" so the system excludes that data point from all fuel efficiency calculations. When a user forgets to log a fill-up between two recorded ones, the odometer difference spans multiple tanks, producing an artificially inflated MPG. The `missedFillup` flag tells all three MPG calculation paths (vehicle stats, analytics, and chart data) to skip the affected consecutive pairs.

## Glossary

- **Expense_Form**: The frontend form component (ExpenseForm.svelte + FuelFieldsSection.svelte) used to create and edit expenses
- **API_Transformer**: The frontend module (api-transformer.ts) that maps field names between frontend and backend representations
- **Vehicle_Stats_Calculator**: The backend module (vehicle-stats.ts) that computes vehicle statistics including average MPG from sequential fuel expenses
- **Analytics_Calculator**: The backend module (calculations.ts) that computes average MPG for the analytics path
- **Chart_Data_Preparer**: The frontend module (expense-helpers.ts) that prepares fuel efficiency data points for charting
- **Expense_API**: The backend route handlers (expenses/routes.ts + repository.ts) that accept, persist, and return expense data
- **Consecutive_Pair**: Two chronologically adjacent fuel expenses used to compute a single MPG data point by dividing the odometer difference by the fuel amount of the later entry
- **Missed_Fillup_Flag**: A boolean field (`missedFillup`) on an expense indicating the user missed logging a fill-up before this one

## Requirements

### Requirement 1: Persist Missed Fill-up Flag

**User Story:** As a user, I want to mark a fuel expense as having a missed previous fill-up, so that the system knows to exclude it from efficiency calculations.

#### Acceptance Criteria

1. WHEN a user submits a fuel expense with the Missed_Fillup_Flag set to true, THE Expense_API SHALL persist the flag value to the database
2. WHEN a user updates an existing fuel expense and changes the Missed_Fillup_Flag, THE Expense_API SHALL persist the updated flag value
3. WHEN the Expense_API returns expense data, THE Expense_API SHALL include the Missed_Fillup_Flag in the response
4. WHEN the Missed_Fillup_Flag is not provided in a request, THE Expense_API SHALL default the value to false

### Requirement 2: Skip Flagged Pairs in Vehicle Stats MPG

**User Story:** As a user, I want vehicle stats to exclude MPG data points affected by missed fill-ups, so that my average MPG is accurate.

#### Acceptance Criteria

1. WHEN computing average MPG from sequential fuel expenses, THE Vehicle_Stats_Calculator SHALL skip any Consecutive_Pair where the current expense has Missed_Fillup_Flag set to true
2. WHEN computing average MPG from sequential fuel expenses, THE Vehicle_Stats_Calculator SHALL skip any Consecutive_Pair where the previous expense has Missed_Fillup_Flag set to true
3. WHEN all Consecutive_Pairs are skipped due to Missed_Fillup_Flag, THE Vehicle_Stats_Calculator SHALL return null for average MPG
4. WHEN no expenses have Missed_Fillup_Flag set to true, THE Vehicle_Stats_Calculator SHALL produce the same result as before this feature was added

### Requirement 3: Skip Flagged Pairs in Analytics MPG

**User Story:** As a user, I want analytics calculations to exclude MPG data points affected by missed fill-ups, so that my analytics are accurate.

#### Acceptance Criteria

1. WHEN computing average MPG from fuel expenses, THE Analytics_Calculator SHALL skip any Consecutive_Pair where the current expense has Missed_Fillup_Flag set to true
2. WHEN computing average MPG from fuel expenses, THE Analytics_Calculator SHALL skip any Consecutive_Pair where the previous expense has Missed_Fillup_Flag set to true
3. WHEN all Consecutive_Pairs are skipped due to Missed_Fillup_Flag, THE Analytics_Calculator SHALL return null for average MPG
4. WHEN no expenses have Missed_Fillup_Flag set to true, THE Analytics_Calculator SHALL produce the same result as before this feature was added

### Requirement 4: Skip Flagged Pairs in Chart Data

**User Story:** As a user, I want fuel efficiency charts to exclude data points affected by missed fill-ups, so that my charts show accurate trends.

#### Acceptance Criteria

1. WHEN preparing fuel efficiency chart data, THE Chart_Data_Preparer SHALL exclude any data point where the current expense has Missed_Fillup_Flag set to true
2. WHEN preparing fuel efficiency chart data, THE Chart_Data_Preparer SHALL exclude any data point where the previous expense has Missed_Fillup_Flag set to true
3. WHEN all data points are excluded due to Missed_Fillup_Flag, THE Chart_Data_Preparer SHALL return an empty array
4. WHEN no expenses have Missed_Fillup_Flag set to true, THE Chart_Data_Preparer SHALL produce the same result as before this feature was added

### Requirement 5: Frontend Type and Transformer Support

**User Story:** As a developer, I want the frontend type system and API transformer to support the missed fill-up flag, so that the field flows correctly between frontend and backend.

#### Acceptance Criteria

1. THE Expense type SHALL include an optional missedFillup boolean field
2. THE ExpenseFormData type SHALL include an optional missedFillup boolean field
3. WHEN transforming a frontend expense to a backend request, THE API_Transformer SHALL include the Missed_Fillup_Flag in the request payload
4. WHEN transforming a backend expense response to a frontend expense, THE API_Transformer SHALL map the Missed_Fillup_Flag to the frontend Expense object

### Requirement 6: Expense Form Toggle

**User Story:** As a user, I want a checkbox in the fuel expense form to mark a missed previous fill-up, so that I can flag inaccurate data points.

#### Acceptance Criteria

1. WHEN the expense category is fuel, THE Expense_Form SHALL display a "Missed previous fill-up" checkbox in the fuel details section
2. WHEN the expense category is not fuel, THE Expense_Form SHALL hide the missed fill-up checkbox
3. WHEN the user toggles the Missed_Fillup_Flag to true, THE Expense_Form SHALL suppress the real-time MPG calculation indicator
4. WHEN the user submits the form, THE Expense_Form SHALL include the Missed_Fillup_Flag value in the expense payload
5. WHEN editing an existing expense that has Missed_Fillup_Flag set to true, THE Expense_Form SHALL display the checkbox in the checked state
