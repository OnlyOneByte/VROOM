# Requirements Document

## Introduction

This document defines the requirements for the Reminders & Recurring Expenses feature. The system provides a unified reminders mechanism that supports two action types: automatic expense creation and persistent user notifications. Reminders are processed via a check-on-login model — no background cron infrastructure is needed. The feature integrates with the existing expense split system, supports configurable frequencies, and includes catch-up logic for missed periods.

## Glossary

- **Reminder**: A scheduling entity that fires on a recurring basis, either creating expenses or surfacing notifications.
- **Reminder_Type**: The action a reminder performs when triggered. One of `'expense'` (auto-creates expense records) or `'notification'` (creates persistent notification rows).
- **Frequency**: The recurrence interval for a reminder. One of `'weekly'`, `'monthly'`, `'yearly'`, or `'custom'`.
- **Interval_Unit**: The unit for custom frequencies. One of `'day'`, `'week'`, `'month'`, `'year'`.
- **Action_Mode**: Controls whether a reminder fires automatically or requires user confirmation. Only `'automatic'` is implemented.
- **Trigger_Service**: The backend service (`ReminderTriggerService`) that processes overdue reminders on login.
- **Reminder_Repository**: The data access layer for reminders, junction rows, and due-date queries.
- **Reminder_Notification**: A persistent database row created when a notification-type reminder fires, with read/unread state.
- **Split_Config**: A discriminated union describing how an expense is divided across vehicles (`'even'`, `'absolute'`, or `'percentage'`).
- **Expense_Split_Service**: The existing service that computes per-vehicle allocations and creates sibling expense rows.
- **Next_Due_Date**: The timestamp indicating when a reminder next needs to fire.
- **Catch_Up_Limit**: The maximum number of overdue periods processed per reminder per trigger invocation (`MAX_CATCHUP_OCCURRENCES`, default 12).
- **Optimistic_Locking**: A concurrency control technique where the UPDATE query includes `WHERE next_due_date = expectedValue` to prevent double-processing.
- **Source_Tracking**: Two nullable columns (`source_type`, `source_id`) on the expenses table that record which system created an expense.
- **Reminder_Vehicles**: A junction table linking reminders to one or more vehicles.

## Requirements

### Requirement 1: Create Reminder

**User Story:** As a vehicle owner, I want to create recurring reminders for expenses or notifications, so that I can automate repetitive financial tracking and maintenance alerts.

#### Acceptance Criteria

1. WHEN a user submits a valid reminder with type, frequency, start date, and at least one vehicle ID, THE Reminder_Repository SHALL create a reminder record and corresponding Reminder_Vehicles junction rows within a single transaction.
2. WHEN a reminder is created, THE Reminder_Repository SHALL set the reminder's Next_Due_Date to the provided start date.
3. WHEN a user submits a reminder with Reminder_Type `'expense'` and Action_Mode `'automatic'`, THE System SHALL require a positive `expenseAmount` (not exceeding 1,000,000) and a valid `expenseCategory` (must be a value from the `EXPENSE_CATEGORIES` enum: fuel, maintenance, financial, regulatory, enhancement, misc).
4. WHEN a user submits a reminder with Frequency `'custom'`, THE System SHALL require a positive integer `intervalValue` and a valid Interval_Unit.
5. WHEN a user provides an `endDate`, THE System SHALL validate that `endDate` is strictly after `startDate`.
6. WHEN a user provides a Split_Config, THE System SHALL validate that the vehicle IDs within the Split_Config exactly match the provided `vehicleIds` array.
7. WHEN a user provides vehicle IDs, THE System SHALL verify that all vehicles exist and belong to the authenticated user before creating the reminder.
8. THE System SHALL accept only `'automatic'` as the Action_Mode value, rejecting any other value.
9. WHEN a reminder is created, THE System SHALL return HTTP 201 with the created reminder data including the assigned Next_Due_Date.

### Requirement 2: Read, Update, and Delete Reminders

**User Story:** As a vehicle owner, I want to view, modify, and remove my reminders, so that I can manage my recurring expenses and notifications over time.

#### Acceptance Criteria

1. WHEN a user requests their reminders list, THE Reminder_Repository SHALL return all reminders belonging to that user, with optional filtering by vehicle ID, Reminder_Type, and active status.
2. WHEN a user requests a single reminder by ID, THE Reminder_Repository SHALL return the reminder with its associated vehicle IDs, scoped to the authenticated user.
3. WHEN a user updates a reminder with new `vehicleIds`, THE Reminder_Repository SHALL fully replace all Reminder_Vehicles junction rows within a transaction.
4. WHEN a user updates a reminder with partial data, THE System SHALL merge the update with the existing record and re-validate the merged result against the full `createReminderSchema` to prevent invalid intermediate states (e.g., changing `frequency` to `'custom'` without providing `intervalValue`).
5. WHEN a user deletes a reminder, THE Reminder_Repository SHALL remove the reminder record, and CASCADE deletion SHALL remove associated Reminder_Vehicles and Reminder_Notification rows.
6. WHEN a user attempts to access a reminder that does not exist or belongs to another user, THE System SHALL return HTTP 404.

### Requirement 3: Trigger Overdue Reminders (Check-on-Login)

**User Story:** As a vehicle owner, I want overdue reminders to be processed when I open the app, so that recurring expenses are created and notifications are surfaced without requiring background infrastructure.

#### Acceptance Criteria

1. WHEN the trigger endpoint is called, THE Trigger_Service SHALL query all reminders where `next_due_date <= now` and `is_active = true` for the authenticated user.
2. WHEN an expense-type reminder is overdue and has remaining vehicles, THE Trigger_Service SHALL create exactly one expense (or split expense group) per overdue period, with `source_type = 'reminder'` and `source_id` set to the reminder's ID.
3. WHEN a notification-type reminder is overdue, THE Trigger_Service SHALL create one Reminder_Notification row per overdue period with `isRead = false`.
4. WHEN a reminder is processed for an overdue period, THE Trigger_Service SHALL advance the Next_Due_Date and set `last_triggered_at` to the current time, within the same transaction as the expense or notification creation.
5. WHEN a reminder's `endDate` falls between its current Next_Due_Date and `now`, THE Trigger_Service SHALL process all overdue periods up to and including the `endDate`, then deactivate the reminder. It SHALL NOT skip all processing just because `endDate` has passed.
6. WHEN all vehicles associated with a reminder have been deleted (CASCADE removed junction rows), THE Trigger_Service SHALL skip the reminder and include it in the skipped results with reason `'no_vehicles'`.
7. WHEN a reminder is overdue by multiple periods, THE Trigger_Service SHALL catch up by processing each missed period individually, up to the Catch_Up_Limit.
8. WHEN the Catch_Up_Limit is reached and additional periods remain overdue, THE Trigger_Service SHALL fast-forward the Next_Due_Date past the current time without creating expenses or notifications for the skipped periods, and include the reminder in skipped results with reason `'catch_up_limit_reached'`.
9. WHEN the trigger completes, THE Trigger_Service SHALL return a result containing arrays of created expenses, created notifications, and skipped reminders with reasons.
10. WHEN expense or notification creation fails for a specific reminder during trigger processing, THE Trigger_Service SHALL continue processing remaining reminders. The failed reminder's Next_Due_Date SHALL NOT be advanced, so it will be retried on the next trigger call. The failed reminder SHALL be included in the `skipped` array with reason `'error'` and the error message.
11. THE Trigger_Service SHALL capture `now` once at the start of `processOverdueReminders` and use that timestamp consistently for all `last_triggered_at` values and overdue comparisons within the same invocation.
12. WHEN `intervalValue` or `intervalUnit` is provided but Frequency is not `'custom'`, THE System SHALL ignore those fields (they are only used when Frequency is `'custom'`).

### Requirement 4: Date Advancement (computeNextDueDate)

**User Story:** As a vehicle owner, I want my reminders to advance correctly across all calendar edge cases, so that monthly and yearly reminders on the 29th, 30th, or 31st do not produce invalid dates.

#### Acceptance Criteria

1. THE computeNextDueDate function SHALL return a date strictly after the input date for all valid frequency configurations.
2. WHEN Frequency is `'weekly'`, THE computeNextDueDate function SHALL return the input date plus 7 days.
3. WHEN Frequency is `'monthly'`, THE computeNextDueDate function SHALL return the input date plus 1 calendar month, with day-of-month set to `min(anchorDay, lastDayOfTargetMonth)` where `anchorDay` is derived from the reminder's `startDate`. This prevents permanent drift after short months (e.g., start=Jan 31: Jan 31 → Feb 28 → Mar 31 → Apr 30).
4. WHEN Frequency is `'yearly'`, THE computeNextDueDate function SHALL return the input date plus 1 calendar year, with day-of-month set to `min(anchorDay, lastDayOfTargetMonth)` for leap year edge cases.
5. WHEN Frequency is `'custom'`, THE computeNextDueDate function SHALL return the input date plus `intervalValue` units of `intervalUnit`, applying anchor-day clamping for month and year units.

### Requirement 5: Expense Creation from Reminders

**User Story:** As a vehicle owner, I want expenses created by reminders to match my configured template exactly, so that automated expenses are indistinguishable from manually entered ones in reports.

#### Acceptance Criteria

1. WHEN an expense-type reminder fires for a single vehicle (no Split_Config), THE Trigger_Service SHALL create one expense row with the reminder's `expenseCategory`, `expenseTags`, `expenseAmount`, and `expenseDescription`. Fields not configured on the reminder (`mileage`, `volume`, `fuelType`) SHALL be set to `null`, and `isFinancingPayment` and `missedFillup` SHALL be set to `false`.
2. WHEN an expense-type reminder fires with a Split_Config, THE Trigger_Service SHALL delegate to the Expense_Split_Service to compute allocations and create sibling expense rows sharing a `groupId`. The Expense_Split_Service's `createSiblings()` method SHALL be extended to accept optional `sourceType` and `sourceId` parameters and pass them through to each created expense row.
3. WHEN an expense is created from a reminder, THE Trigger_Service SHALL set the expense `date` to the overdue period's due date, not the current time.
4. WHEN an expense is created from a reminder, THE Trigger_Service SHALL set `source_type = 'reminder'` and `source_id` to the reminder's ID on every created expense row.
5. THE Trigger_Service SHALL execute expense creation and Next_Due_Date advancement within a single database transaction, so that a failure rolls back both operations.

### Requirement 6: Concurrency Safety

**User Story:** As a vehicle owner, I want the trigger system to handle concurrent calls safely, so that double-clicking or multiple browser tabs do not create duplicate expenses.

#### Acceptance Criteria

1. WHEN advancing a reminder's Next_Due_Date, THE Reminder_Repository SHALL use Optimistic_Locking by including `WHERE next_due_date = expectedCurrentDueDate` in the UPDATE query.
2. WHEN a concurrent trigger call attempts to advance a reminder that has already been advanced, THE Reminder_Repository SHALL match 0 rows and the Trigger_Service SHALL silently skip that reminder without creating duplicate expenses.

### Requirement 7: Reminder Notifications

**User Story:** As a vehicle owner, I want notification reminders to create persistent alerts that I can review and dismiss, so that I don't forget maintenance tasks.

#### Acceptance Criteria

1. WHEN a notification-type reminder fires, THE Trigger_Service SHALL insert a Reminder_Notification row with the reminder ID, user ID, the period's due date, and `isRead = false`.
2. WHEN a user requests their notifications, THE System SHALL return notifications filtered by the authenticated user, with optional `unreadOnly` filtering.
3. WHEN a user marks a notification as read, THE System SHALL update the `isRead` field to `true` and set `updatedAt` to the current time, scoped to the authenticated user's notifications.
4. THE reminder_notifications table SHALL enforce a unique constraint on `(reminder_id, due_date)` to prevent duplicate notifications for the same reminder and period.

### Requirement 8: Source Tracking on Expenses

**User Story:** As a vehicle owner, I want to see which expenses were auto-created by reminders, so that I can distinguish automated entries from manual ones.

#### Acceptance Criteria

1. THE expenses table SHALL include nullable `source_type` and `source_id` columns for generic provenance tracking.
2. WHEN an expense is created manually by a user, THE System SHALL leave `source_type` and `source_id` as null.
3. THE System SHALL prevent users from setting `source_type` or `source_id` via the expense creation or update API — these fields are server-set only.
4. THE expenses table SHALL include an index on `(source_type, source_id)` to support efficient queries for expenses from a specific source.

### Requirement 9: Validation

**User Story:** As a vehicle owner, I want clear validation errors when I misconfigure a reminder, so that I can correct my input without guessing.

#### Acceptance Criteria

1. WHEN a user submits a reminder with `name` exceeding 100 characters, THE System SHALL reject the request with a validation error.
2. WHEN a user submits a reminder with Reminder_Type `'expense'` but omits `expenseCategory`, THE System SHALL reject the request with a validation error specifying the missing field.
3. WHEN a user submits a reminder with Frequency `'custom'` but omits `intervalValue` or `intervalUnit`, THE System SHALL reject the request with a validation error specifying the missing field.
4. WHEN a user submits a Split_Config where vehicle IDs do not match the provided `vehicleIds`, THE System SHALL reject the request with a validation error.
5. WHEN a user submits a Split_Config with percentage allocations that do not sum to 100, THE System SHALL reject the request with a validation error.
6. WHEN a user submits a reminder with `expenseAmount` that is not positive or exceeds 1,000,000, THE System SHALL reject the request with a validation error.
7. WHEN a user submits a reminder with `description` or `expenseDescription` exceeding 500 characters, THE System SHALL reject the request with a validation error.
8. WHEN a user submits a reminder with more than 10 `expenseTags`, or any individual tag exceeding 50 characters, THE System SHALL reject the request with a validation error.

### Requirement 10: Schema and Data Model

**User Story:** As a developer, I want the database schema to support reminders with proper indexing and referential integrity, so that queries are efficient and data stays consistent.

#### Acceptance Criteria

1. THE reminders table SHALL include a compound index on `(user_id, is_active, next_due_date)` to optimize the overdue query.
2. THE Reminder_Vehicles junction table SHALL use a composite primary key on `(reminder_id, vehicle_id)` and CASCADE delete on both foreign keys.
3. WHEN a vehicle is deleted, THE database SHALL CASCADE-remove all Reminder_Vehicles rows referencing that vehicle.
4. WHEN a reminder is deleted, THE database SHALL CASCADE-remove all associated Reminder_Vehicles and Reminder_Notification rows.
5. THE reminder_notifications table SHALL include an index on `(user_id, is_read)` to optimize the unread notifications query.
6. THE Reminder_Vehicles junction table SHALL include a secondary index on `(vehicle_id)` to optimize "reminders for this vehicle" lookups.

### Requirement 11: Rate Limiting and Route Configuration

**User Story:** As a developer, I want the trigger endpoint to be rate-limited separately from CRUD routes, so that write-heavy trigger calls cannot exhaust the global rate limit.

#### Acceptance Criteria

1. THE trigger endpoint SHALL have its own rate limit configuration (10 requests per 15 minutes) separate from the global rate limit. WHEN the limit is exceeded, THE System SHALL return HTTP 429 with the message "Too many trigger requests".
2. THE reminder CRUD routes SHALL use the `requireAuth` and `changeTracker` middleware on all endpoints.
3. THE reminder routes SHALL be mounted at `/api/v1/reminders` following the existing route mounting pattern.

### Requirement 12: Backup and Restore Integration

**User Story:** As a vehicle owner, I want my reminders included in backups and restores, so that I don't lose my recurring expense configuration when migrating or recovering data.

#### Acceptance Criteria

1. THE backup system SHALL export `reminders`, `reminder_vehicles`, and `reminder_notifications` tables as optional backup files.
2. THE restore system SHALL insert reminders before Reminder_Vehicles and Reminder_Notifications to satisfy foreign key ordering.
3. WHEN restoring from an older backup that does not contain reminder tables, THE restore system SHALL skip those tables without error.
4. THE backup system SHALL serialize JSON columns (`expenseTags`, `expenseSplitConfig`) as valid JSON strings in CSV output that can be deserialized back to equivalent objects.
