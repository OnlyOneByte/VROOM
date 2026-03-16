# Implementation Plan: Reminders & Recurring Expenses

## Overview

Implement a unified reminders system with two action types (expense creation and notifications), triggered via a check-on-login model. The implementation follows the existing domain structure under `backend/src/api/reminders/` with schema changes regenerated from scratch (pre-production). Frontend scope is limited to API service, types, and route registration — no UI pages.

## Tasks

- [x] 1. Schema, types, and config changes
  - [x] 1.1 Add `ReminderSplitConfig` type to `backend/src/db/types.ts`
    - Define `ReminderSplitConfig` discriminated union type mirroring `SplitConfig` shape (even/absolute/percentage) without importing from api layer
    - _Requirements: 10.1, 10.2_

  - [x] 1.2 Add `reminders`, `reminder_vehicles`, and `reminder_notifications` tables to `backend/src/db/schema.ts`
    - Add `reminders` table with all columns per design (id, userId, name, description, type, actionMode, frequency, intervalValue, intervalUnit, startDate, endDate, nextDueDate, expenseCategory, expenseTags, expenseAmount, expenseDescription, expenseSplitConfig, isActive, lastTriggeredAt, createdAt, updatedAt)
    - Add compound index `(userId, isActive, nextDueDate)` on reminders
    - Add `reminderVehicles` junction table with composite PK `(reminderId, vehicleId)`, CASCADE on both FKs, and secondary index on `(vehicleId)`
    - Add `reminderNotifications` table with unique index on `(reminderId, dueDate)` and index on `(userId, isRead)`
    - Add `sourceType` and `sourceId` nullable text columns to existing `expenses` table with index on `(sourceType, sourceId)`
    - Export all new types: `Reminder`, `NewReminder`, `ReminderVehicle`, `NewReminderVehicle`, `ReminderNotification`, `NewReminderNotification`
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 8.1_

  - [x] 1.3 Re-export new types from `backend/src/types.ts`
    - Add re-exports for `Reminder`, `NewReminder`, `ReminderVehicle`, `NewReminderVehicle`, `ReminderNotification`, `NewReminderNotification` from `./db/schema`
    - Add to `BackupData`: `reminders?: import('./db/schema').Reminder[]`, `reminderVehicles?: import('./db/schema').ReminderVehicle[]`, `reminderNotifications?: import('./db/schema').ReminderNotification[]` (optional — older backups won't have them)
    - Add to `ParsedBackupData`: `reminders?: Record<string, unknown>[]`, `reminderVehicles?: Record<string, unknown>[]`, `reminderNotifications?: Record<string, unknown>[]` (optional — same reason)
    - _Requirements: 10.1, 12.1_

  - [x] 1.4 Add reminder config values to `backend/src/config.ts`
    - Add `CONFIG.validation.reminder` with `nameMaxLength: 100`, `descriptionMaxLength: 500`, `maxExpenseAmount: 1_000_000`, `maxCatchUpOccurrences: 12`, `maxTags: 10`, `tagMaxLength: 50`
    - Add `CONFIG.rateLimit.trigger` with `windowMs: 15 * 60 * 1000`, `limit: 10`, `message: 'Too many trigger requests'`
    - Add `reminders`, `reminderVehicles`, `reminderNotifications` to `TABLE_SCHEMA_MAP` and `TABLE_FILENAME_MAP`
    - Add all three filenames to `OPTIONAL_BACKUP_FILES`
    - _Requirements: 11.1, 12.1_

  - [x] 1.5 Update migration tests and regenerate migration 0000
    - Update `backend/src/db/__tests__/migration-0000.test.ts`: add assertions for `reminders`, `reminder_vehicles`, `reminder_notifications` tables; verify indexes `reminders_user_active_due_idx`, `rv_vehicle_idx`, `rn_user_unread_idx`, `rn_reminder_due_idx`, `expenses_source_idx`; verify `sourceType` and `sourceId` columns on expenses table
    - Update `backend/src/db/__tests__/migration-general.test.ts`: add `reminders`, `reminder_vehicles`, `reminder_notifications` to expected tables list
    - Delete existing `backend/drizzle/0000_*.sql` and `backend/drizzle/meta/` contents
    - Run `bun run db:generate` from `backend/` to produce fresh migration
    - Delete `backend/data/vroom.db*` files so fresh migration applies on next startup
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 8.1, 8.4_

- [x] 2. Modify existing expense code for source tracking
  - [x] 2.1 Strip `sourceType`/`sourceId` from user-facing expense schemas in `backend/src/api/expenses/routes.ts`
    - Add `sourceType: true, sourceId: true` to the `baseExpenseSchema.omit()` call in `createExpenseSchema`
    - Note: `updateExpenseSchema` inherits from `createExpenseSchema.partial()` so it automatically strips these fields too — no separate change needed
    - _Requirements: 8.2, 8.3_

  - [x] 2.2 Extend `ExpenseSplitService.createSiblings()` in `backend/src/api/expenses/split-service.ts`
    - Add optional `sourceType?: string` and `sourceId?: string` to the params interface
    - Pass them through to each `NewExpense` as `sourceType: params.sourceType ?? null` and `sourceId: params.sourceId ?? null`
    - _Requirements: 5.2, 5.4_

- [x] 3. Checkpoint — Ensure schema and existing code changes compile
  - Run `bun run validate` from `backend/`. All tests including migration tests should pass.
  - Verify existing expense tests still pass with the new nullable `sourceType`/`sourceId` columns. If `createInsertSchema()` requires these fields in test generators, add `sourceType: null, sourceId: null` to generated test data.

- [x] 4. Implement reminder validation
  - [x] 4.1 Create `backend/src/api/reminders/validation.ts`
    - Import `splitConfigSchema` from `../expenses/validation` (existing file, not a new dependency)
    - Implement `createReminderSchema` with all Zod validation per design: name max 100, description max 500, type enum, actionMode `z.literal('automatic')`, frequency enum, custom frequency requires intervalValue + intervalUnit, expense type requires expenseCategory + expenseAmount, endDate > startDate, vehicleIds min 1, split config vehicle ID match, percentage sum = 100, absolute sum = expenseAmount, expenseTags max 10 items / 50 chars each, expenseAmount positive and ≤ 1,000,000, expenseDescription max 500
    - Implement `updateReminderSchema` as `createReminderSchema.partial()`
    - _Requirements: 1.3, 1.4, 1.5, 1.6, 1.8, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_

  - [ ]* 4.2 Write property tests for reminder validation in `backend/src/api/reminders/__tests__/`
    - **Property 5: Validation rejects invalid reminder configurations**
    - **Property 6: Split config vehicle IDs must match provided vehicleIds**
    - **Property 7: Percentage split allocations must sum to 100**
    - **Validates: Requirements 1.3, 1.4, 1.5, 1.6, 1.8, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6**

- [x] 5. Implement reminder repository
  - [x] 5.1 Create `backend/src/api/reminders/repository.ts`
    - Import `BaseRepository` from `../../utils/repository`
    - Import `DrizzleTransaction` from `../../db/types`
    - Define and export `ReminderWithVehicles` interface at the top of the file: `{ reminder: Reminder; vehicleIds: string[] }` — this is the canonical location, imported by routes and trigger service
    - Implement `ReminderRepository` extending `BaseRepository<Reminder, NewReminder>` with methods:
      - `findByUserId(userId, filters?)` — accepts optional `{ vehicleId?, type?, isActive? }` filter object. When `vehicleId` is provided, JOIN with `reminder_vehicles` to filter. Returns `ReminderWithVehicles[]`.
      - `findByIdAndUserId(id, userId)` — returns `ReminderWithVehicles | null` (includes vehicleIds from junction table)
      - `findOverdue(userId, now)` — returns `ReminderWithVehicles[]` where `nextDueDate <= now AND isActive = true`
      - `findByVehicleId(vehicleId, userId)` — returns `Reminder[]`
      - `createWithVehicles(data, vehicleIds)` — transactional insert of reminder + junction rows, sets nextDueDate = startDate
      - `updateWithVehicles(id, userId, data, vehicleIds?)` — transactional update + full junction row replacement when vehicleIds provided
      - `advanceNextDueDate(id, expectedCurrentDueDate, nextDueDate)` — optimistic locking: `WHERE next_due_date = expectedCurrentDueDate`
      - `advanceNextDueDateTx(tx, id, expectedCurrentDueDate, nextDueDate, lastTriggeredAt)` — transactional variant, also sets `lastTriggeredAt`
      - `deactivate(id)` — sets `isActive = false`
      - `findNotifications(userId, unreadOnly?)` — query `reminder_notifications` filtered by userId, optionally by `isRead = false`
      - `markNotificationRead(id, userId)` — update `isRead = true` and `updatedAt = new Date()` with ownership check `WHERE id = ? AND user_id = ?`
    - Export singleton `reminderRepository` created with `getDb()`
    - _Requirements: 1.1, 1.2, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 6.1, 6.2, 7.2, 7.3_

  - [ ]* 5.2 Write property tests for reminder repository in `backend/src/api/reminders/__tests__/`
    - **Property 4: Reminder creation round-trip preserves fields**
    - **Property 14: Vehicle update fully replaces junction rows**
    - **Property 15: Cascade deletion removes all associated rows**
    - **Property 18: Reminder list filtering returns correct subset**
    - **Validates: Requirements 1.1, 1.2, 2.1, 2.2, 2.3, 2.5, 10.3, 10.4**

- [x] 6. Implement trigger service and date advancement
  - [x] 6.1 Create `backend/src/api/reminders/trigger-service.ts`
    - Depends on: task 2.2 (createSiblings sourceType/sourceId extension) and task 5.1 (repository)
    - Implement `computeNextDueDate(currentDueDate, frequency, intervalValue, intervalUnit, anchorDay)` — co-located in this file, not in utils
      - Weekly: +7 days
      - Monthly: +1 month with anchor-day clamping via `setDate(1)` then `min(anchorDay, lastDayOfTargetMonth)`
      - Yearly: +1 year with anchor-day clamping
      - Custom: +intervalValue units with anchor-day clamping for month/year
    - Implement `ReminderTriggerService.processOverdueReminders(userId)`:
      - Capture `now` once at start for consistent timestamps (Req 3.11)
      - Query overdue reminders via `reminderRepository.findOverdue(userId, now)`
      - Per-reminder try/catch: on error, add to `skipped` with `reason: 'error'` and error message, continue to next reminder
      - Skip reminders with 0 vehicles (reason: `'no_vehicles'`)
      - Catch-up loop per reminder up to `CONFIG.validation.reminder.maxCatchUpOccurrences`
      - EndDate check INSIDE the loop (before processing each period): if `nextDue > endDate`, deactivate and break
      - For expense type: call `createExpenseFromReminder` + advance due date in single `transaction()` from `../../db/connection`
      - For notification type: insert `reminder_notifications` row + advance due date in single `transaction()`, return result outside callback (don't mutate outer `nextDue` inside callback)
      - Fast-forward past now when catch-up limit reached using `advanceNextDueDate` (non-transactional with optimistic locking)
    - Implement `createExpenseFromReminder(tx, reminderWithVehicles, dueDate)`:
      - Single vehicle (no splitConfig): use `tx.insert(expenses).values({...}).returning()` directly — NOT `expenseRepository.create()`, because the operation must run within the caller's transaction. Import `expenses` table from `../../db/schema`. Set sourceType='reminder', sourceId=reminder.id, null for mileage/volume/fuelType, false for isFinancingPayment/missedFillup
      - Split config: call `expenseSplitService.computeAllocations()` then `createSiblings(tx, {..., sourceType: 'reminder', sourceId: reminder.id})`
      - Set expense date to dueDate (not current time)
    - Export singleton `reminderTriggerService`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2_

  - [x] 6.2 Write property tests for `computeNextDueDate` in `backend/src/api/reminders/__tests__/`
    - **Property 1: Date advancement is strictly monotonic**
    - **Property 2: Monthly advancement clamps to last day of target month**
    - **Property 3: Weekly advancement adds exactly 7 days**
    - **Property 20: Anchor day prevents month-end drift**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**

  - [ ]* 6.3 Write property tests for trigger service in `backend/src/api/reminders/__tests__/`
    - **Property 8: Trigger creates correct expense count per overdue periods**
    - **Property 9: Trigger creates correct notification count per overdue periods**
    - **Property 10: Catch-up limit bounds expense creation**
    - **Property 11: Post-trigger invariant — no overdue active reminders**
    - **Property 12: Expense field fidelity from reminder template**
    - **Property 13: Split expense amount conservation**
    - **Property 21: EndDate mid-range deactivation**
    - **Property 22: Concurrent trigger safety**
    - **Validates: Requirements 3.2, 3.3, 3.4, 3.5, 3.7, 3.8, 5.1, 5.2, 5.3, 5.4, 6.1, 6.2**

- [x] 7. Implement reminder routes
  - [x] 7.1 Create `backend/src/api/reminders/routes.ts`
    - Apply `requireAuth` and `changeTracker` middleware via `routes.use('*', requireAuth)` and `routes.use('*', changeTracker)`
    - Apply trigger-specific rate limit on `POST /trigger`: `const triggerRateLimiter = rateLimiter({ ...CONFIG.rateLimit.trigger, keyGenerator: (c) => \`trigger:${c.get('user').id}\` })` imported from `../../middleware`, applied as `routes.post('/trigger', triggerRateLimiter, async (c) => {...})` — follows the pattern in `sync/routes.ts`
    - `POST /` — create reminder: validate with `zValidator('json', createReminderSchema)`, verify vehicle ownership via `vehicleRepository`, call `createWithVehicles`, return 201
    - `GET /` — list reminders: support `?vehicleId`, `?type`, `?isActive` query params, pass to `findByUserId(userId, filters)`
    - `GET /:id` — get single reminder with vehicleIds via `findByIdAndUserId`, scoped to user, return 404 if not found
    - `PUT /:id` — update reminder: validate with `zValidator('json', updateReminderSchema)`, fetch existing via `findByIdAndUserId` (returns `ReminderWithVehicles` which includes `vehicleIds` from junction table), merge partial update with existing: `{ ...existing.reminder, ...partialUpdate, vehicleIds: partialUpdate.vehicleIds ?? existing.vehicleIds }`, re-validate merged result with `createReminderSchema.parse(merged)`, call `updateWithVehicles`
    - `DELETE /:id` — delete reminder via repository (CASCADE handles junction + notifications)
    - `POST /trigger` — call `reminderTriggerService.processOverdueReminders(userId)`
    - `GET /notifications` — list notifications with optional `?unreadOnly=true` filter, scoped to `userId`
    - `PUT /notifications/:id/read` — mark notification as read: `WHERE id = ? AND user_id = ?`, set `updatedAt: new Date()` manually
    - Return 404 for non-existent or non-owned reminders/notifications
    - _Requirements: 1.1, 1.7, 1.9, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.9, 7.2, 7.3, 11.1, 11.2, 11.3_

  - [x] 7.2 Mount reminder routes in `backend/src/index.ts`
    - Import: `import { routes as reminderRoutes } from './api/reminders/routes'`
    - Mount: `app.route('/api/v1/reminders', reminderRoutes)`
    - _Requirements: 11.3_

- [x] 8. Checkpoint — Ensure all backend tests pass
  - Run `bun run validate` from `backend/`. All tests should pass.

- [x] 9. Backup, restore, and sync integration
  - [x] 9.1 Update `backend/src/api/sync/backup.ts`
    - Export `reminders`, `reminder_vehicles`, `reminder_notifications` in `createBackup()` — query each table filtered by userId
    - Add CSV column output for all three tables in `exportAsZip()`
    - Add referential integrity validators: `validateReminderRefs()` (check userId exists in vehicles list), `validateReminderVehicleJunctionRefs()` (check reminderId + vehicleId exist), `validateReminderNotificationRefs()` (check reminderId + userId exist)
    - Add expense source tracking validation: when `sourceType = 'reminder'`, verify `sourceId` references a valid reminder ID in the backup's reminders array
    - _Requirements: 12.1, 12.4_

  - [x] 9.2 Update `backend/src/api/sync/restore.ts`
    - In `insertBackupData()`: insert in this order relative to existing code: `vehicles → financing → insurance → insuranceTerms → insuranceTermVehicles → reminders → reminderVehicles → reminderNotifications → expenses → odometer → ...`. Use optional chaining (`backup.reminders?.length`) since older backups won't have these fields.
    - In `deleteUserData()`: delete reminders BEFORE vehicles in the deletion order (CASCADE handles reminder_vehicles + reminder_notifications automatically). Add after existing photo/photoRef deletes but before vehicle deletes.
    - Add `reminders: number`, `reminderVehicles: number`, `reminderNotifications: number` to `ImportSummary` type and update all places where `ImportSummary` objects are constructed (in `restoreFromBackup` and `restoreFromSheets`)
    - _Requirements: 12.2, 12.3_

  - [x] 9.3 Update Google Sheets service at `backend/src/api/providers/services/google-sheets-service.ts`
    - Update `getExpenseHeaders()` to include `'sourceType'` and `'sourceId'` columns (existing expense Sheets sync will otherwise silently drop source tracking data)
    - Add header functions for reminders, reminder_vehicles, and reminder_notifications (return column name arrays matching the table schemas)
    - Add sheets `'Reminders'`, `'Reminder Vehicles'`, `'Reminder Notifications'` in `createSpreadsheet()` request body
    - Add to `ensureRequiredSheets()` hardcoded list
    - Export data for all three tables in `updateSpreadsheetWithUserData()`
    - Read data for all three tables in `readSpreadsheetData()` and update its return type to include the new keys
    - _Requirements: 12.1, 12.4_

  - [ ]* 9.4 Write property test for backup JSON column round-trip in `backend/src/api/reminders/__tests__/`
    - **Property 19: Backup JSON column round-trip**
    - **Validates: Requirement 12.4**

- [ ] 10. Additional property tests
  - [ ]* 10.1 Write property test for source tracking server-set-only in `backend/src/api/reminders/__tests__/`
    - **Property 16: Source tracking fields are server-set only**
    - **Validates: Requirements 8.2, 8.3**

  - [ ]* 10.2 Write property test for notification read/unread filtering in `backend/src/api/reminders/__tests__/`
    - **Property 17: Notification read/unread filtering**
    - **Validates: Requirements 7.2, 7.3, 7.4**

- [x] 11. Frontend API service and types
  - [x] 11.1 Create `frontend/src/lib/types/reminder.ts`
    - Define `Reminder`, `ReminderWithVehicles`, `ReminderNotification`, `TriggerResult`, `ReminderFrequency`, `IntervalUnit`, `ReminderType` types
    - Export from `frontend/src/lib/types/index.ts`
    - _Requirements: 1.1, 3.9, 7.1_

  - [x] 11.2 Create `frontend/src/lib/services/reminder-api.ts`
    - Implement methods: `create()`, `list(filters?)`, `getById(id)`, `update(id, data)`, `delete(id)`, `trigger()`, `getNotifications(unreadOnly?)`, `markNotificationRead(id)`
    - Use `apiClient` from `$lib/services/api-client.ts`
    - _Requirements: 1.1, 2.1, 2.2, 3.9, 7.2, 7.3_

  - [x] 11.3 Register reminder routes in `frontend/src/lib/routes.ts`
    - Add `reminders` route to the routes object
    - _Requirements: 11.3_

- [x] 12. Final checkpoint — Ensure all tests pass
  - Run `bun run validate` from `backend/` and `npm run validate` from `frontend/`.

## Notes

- Tasks marked with `*` are optional property tests that can be skipped for faster MVP — EXCEPT task 6.2 (computeNextDueDate tests) which is non-optional due to the complexity of date arithmetic with anchor-day clamping
- Each task references specific requirements for traceability
- Checkpoints run `validate` which chains linting, format checking, type checking, and tests
- Property tests validate universal correctness properties from the design document (22 properties mapped across tasks)
- Migration is regenerated from scratch since the project is not in production
- `computeNextDueDate` is co-located in `trigger-service.ts`, not in a utils file
- `ReminderSplitConfig` is defined in `db/types.ts` to avoid reverse dependency (db → api)
- Frontend scope is limited to API service, types, and route registration — no UI pages in this spec
