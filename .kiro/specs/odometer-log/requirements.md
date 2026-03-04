# Requirements Document

## Introduction

The Odometer Log feature adds a chronological record of odometer readings to each vehicle in VROOM. Entries originate from two sources: manual readings logged by the user, and auto-populated entries derived from expenses that include a mileage value. The feature introduces a new `odometer_entries` table with polymorphic linking, a backend domain module, expense mutation hooks, photo attachment support, and a frontend tab on the vehicle detail page with a timeline list and mileage-over-time chart. The existing backup/restore/sync pipeline is extended to include odometer data.

## Glossary

- **Odometer_API**: The backend HTTP route handlers mounted at `/api/v1/odometer` that handle odometer entry CRUD operations
- **OdometerRepository**: The data access layer for the `odometer_entries` table, extending `BaseRepository`
- **Odometer_Hooks**: Cross-domain side-effect functions triggered by expense create/update/delete mutations to auto-manage linked odometer entries
- **OdometerTab**: The frontend Svelte component displayed as the 4th tab on the vehicle detail page, showing the timeline list and mileage chart
- **AddOdometerReading_Page**: The frontend page at `/vehicles/[id]/odometer/new` for creating manual odometer readings with optional photo upload, following the convention of `/expenses/new`, `/vehicles/new`, `/insurance/new`
- **Odometer_API_Service**: The frontend `odometerApi` service in `odometer-api.ts` that communicates with the Odometer_API
- **Manual_Entry**: An odometer entry where both `linkedEntityType` and `linkedEntityId` are null, created directly by the user
- **Linked_Entry**: An odometer entry where both `linkedEntityType` and `linkedEntityId` are non-null, auto-managed by Odometer_Hooks
- **Backup_Pipeline**: The collective backup, restore, and Google Sheets sync system in `backend/src/api/sync/`
- **Validation_Layer**: The Zod-based schema validation applied to incoming odometer data on the backend

## Requirements

### Requirement 1: Manual Odometer Entry Creation

**User Story:** As a vehicle owner, I want to manually log odometer readings, so that I can maintain an accurate mileage history for my vehicle.

#### Acceptance Criteria

1. WHEN a user submits a valid odometer reading via the Odometer_API, THE Odometer_API SHALL create a new Manual_Entry with the provided odometer value, date, and optional note, and return the created entry
2. WHEN a user submits an odometer reading, THE Validation_Layer SHALL require the odometer value to be a non-negative integer
3. WHEN a user submits an odometer reading, THE Validation_Layer SHALL require the recorded date to be a valid date not in the future
4. WHEN a user submits an odometer reading for a vehicle they do not own, THE Odometer_API SHALL reject the request with a 404 status
5. THE Odometer_API SHALL set `linkedEntityType` and `linkedEntityId` to null on all manually created entries

### Requirement 2: Manual Odometer Entry Update and Deletion

**User Story:** As a vehicle owner, I want to edit or delete my manual odometer readings, so that I can correct mistakes in my mileage history.

#### Acceptance Criteria

1. WHEN a user updates a Manual_Entry via the Odometer_API, THE Odometer_API SHALL persist the updated odometer value, date, and note
2. WHEN a user deletes a Manual_Entry via the Odometer_API, THE Odometer_API SHALL remove the entry from the database
3. WHEN a user attempts to update or delete a Linked_Entry via the Odometer_API, THE Odometer_API SHALL reject the request with a 400 status and the message "Linked odometer entries are managed automatically. Edit the source record instead."
4. WHEN a user attempts to update or delete an entry they do not own, THE Odometer_API SHALL reject the request with a 404 status

### Requirement 3: Expense-Derived Odometer Entries

**User Story:** As a vehicle owner, I want odometer readings to be automatically recorded when I log expenses with mileage, so that my mileage history stays complete without extra effort.

#### Acceptance Criteria

1. WHEN an expense is created with a non-null mileage value, THE Odometer_Hooks SHALL create a Linked_Entry with `linkedEntityType` set to `'expense'` and `linkedEntityId` set to the expense ID, using the expense mileage as the odometer value and the expense date as the recorded date
2. WHEN an expense is updated and the mileage changes from null to a non-null value, THE Odometer_Hooks SHALL create a new Linked_Entry for that expense
3. WHEN an expense is updated and the mileage changes from one non-null value to another, THE Odometer_Hooks SHALL update the existing Linked_Entry with the new odometer value
4. WHEN an expense is updated and the mileage is cleared to null, THE Odometer_Hooks SHALL delete the Linked_Entry associated with that expense
5. WHEN an expense with non-null mileage is deleted, THE Odometer_Hooks SHALL delete the Linked_Entry associated with that expense
6. WHEN an expense has null mileage and remains null after update, THE Odometer_Hooks SHALL perform no odometer operations

### Requirement 4: Upsert Idempotency

**User Story:** As a developer, I want the linked entry upsert to be idempotent, so that repeated hook invocations do not create duplicate entries.

#### Acceptance Criteria

1. WHEN the OdometerRepository upserts a Linked_Entry with a given `linkedEntityType` and `linkedEntityId`, THE OdometerRepository SHALL produce exactly one entry matching that type and ID combination, regardless of how many times the upsert is called
2. WHEN a Linked_Entry already exists for a given `linkedEntityType` and `linkedEntityId`, THE OdometerRepository SHALL update the existing entry's odometer value and recorded date without changing the entry ID

### Requirement 5: Link Field Consistency

**User Story:** As a developer, I want the linked entity fields to always be consistent, so that entries are unambiguously classified as manual or linked.

#### Acceptance Criteria

1. THE OdometerRepository SHALL ensure that for every odometer entry, either both `linkedEntityType` and `linkedEntityId` are null, or both are non-null
2. WHEN a request provides only one of `linkedEntityType` or `linkedEntityId`, THE Validation_Layer SHALL reject the request with a descriptive error message

### Requirement 6: Odometer Entry Listing

**User Story:** As a vehicle owner, I want to view all odometer readings for my vehicle in chronological order, so that I can track my mileage history over time.

#### Acceptance Criteria

1. WHEN a user requests odometer entries for a vehicle they own, THE Odometer_API SHALL return a paginated response with entries sorted by `recordedAt` in descending order, including `totalCount`, `limit`, `offset`, and `hasMore` fields
2. WHEN a user requests odometer entries for a vehicle they do not own, THE Odometer_API SHALL reject the request with a 404 status
3. WHEN a vehicle has no odometer entries, THE Odometer_API SHALL return `{ data: [], totalCount: 0, hasMore: false }`
4. WHEN `limit` is not provided, THE Odometer_API SHALL default to `CONFIG.pagination.defaultPageSize`
5. WHEN `limit` exceeds `CONFIG.pagination.maxPageSize`, THE Odometer_API SHALL clamp it to `CONFIG.pagination.maxPageSize`
6. THE `hasMore` field SHALL be `true` when `offset + data.length < totalCount`

### Requirement 7: Vehicle Cascade Deletion

**User Story:** As a developer, I want vehicle deletion to cascade to odometer entries and their photos, so that no orphaned data remains.

#### Acceptance Criteria

1. WHEN a vehicle is deleted, THE database SHALL cascade-delete all odometer entries with `vehicleId` matching the deleted vehicle via the foreign key constraint
2. WHEN odometer entries are deleted due to vehicle cascade, THE system SHALL clean up all photos with `entityType` set to `'odometer_entry'` for those entry IDs

### Requirement 8: Photo Attachment Support

**User Story:** As a vehicle owner, I want to attach photos to my odometer readings, so that I can document the odometer display as proof of mileage.

#### Acceptance Criteria

1. WHEN a user uploads a photo for an odometer entry, THE system SHALL store the photo via the existing photo infrastructure with `entityType` set to `'odometer_entry'` and `entityId` set to the odometer entry ID
2. WHEN an odometer entry is deleted, THE system SHALL delete all associated photos from Google Drive and the photos table
3. THE `PhotoEntityType` union in the schema SHALL include `'odometer_entry'` as a valid entity type

### Requirement 9: Backup and Restore Pipeline Integration

**User Story:** As a user, I want my odometer data included in backups and restores, so that I do not lose mileage history when migrating or recovering data.

#### Acceptance Criteria

1. WHEN a backup is created, THE Backup_Pipeline SHALL include all odometer entries for the user in the backup archive as `odometer_entries.csv`
2. WHEN a backup is restored, THE Backup_Pipeline SHALL import odometer entries from the archive, inserting them after expenses to preserve linked entity references
3. WHEN restoring a backup that does not contain `odometer_entries.csv`, THE Backup_Pipeline SHALL treat the file as optional and skip odometer import without error
4. WHEN validating backup referential integrity, THE Backup_Pipeline SHALL verify that each odometer entry's `vehicleId` references a valid vehicle in the backup
5. WHEN validating backup photos, THE Backup_Pipeline SHALL include `'odometer_entry'` in the set of valid photo entity types
6. WHEN user data is deleted during restore, THE Backup_Pipeline SHALL delete odometer-entry photos and odometer entries before deleting vehicles to respect foreign key ordering

### Requirement 10: Google Sheets Sync Integration

**User Story:** As a user, I want my odometer data synced to Google Sheets, so that I can view and analyze my mileage history in a spreadsheet.

#### Acceptance Criteria

1. WHEN a Google Sheets spreadsheet is created, THE Backup_Pipeline SHALL include an `Odometer` sheet in the spreadsheet
2. WHEN syncing data to Google Sheets, THE Backup_Pipeline SHALL write all odometer entries with columns: id, vehicle_id, user_id, odometer, recorded_at, note, linked_entity_type, linked_entity_id, created_at, updated_at
3. WHEN reading data from Google Sheets, THE Backup_Pipeline SHALL parse the `Odometer` sheet and include the data in the returned backup structure

### Requirement 11: Database Migration

**User Story:** As a developer, I want the odometer entries table created via a consolidated migration, so that the schema is clean and production-ready.

#### Acceptance Criteria

1. THE consolidated migration 0004 SHALL create the `odometer_entries` table with columns: id, vehicle_id, user_id, odometer, recorded_at, note, linked_entity_type, linked_entity_id, created_at, updated_at
2. THE consolidated migration 0004 SHALL create an index `odometer_vehicle_date_idx` on `(vehicle_id, recorded_at)` and an index `odometer_linked_entity_idx` on `(linked_entity_type, linked_entity_id)`
3. THE consolidated migration 0004 SHALL include the `track_fuel` and `track_charging` vehicle columns and the `google_drive_custom_folder_name` user settings column from the previous migrations 0004 and 0005
4. THE consolidated migration 0004 SHALL apply cleanly on a fresh database with seed data from migrations 0000–0003 intact
5. THE `odometer_entries` table SHALL have a foreign key on `vehicle_id` referencing `vehicles(id)` with `ON DELETE CASCADE`
6. THE `odometer_entries` table SHALL have a foreign key on `user_id` referencing `users(id)` with `ON DELETE CASCADE`

### Requirement 12: Odometer Tab Display

**User Story:** As a vehicle owner, I want a dedicated tab on my vehicle page showing all odometer readings and a mileage chart, so that I can visualize my vehicle's mileage history.

#### Acceptance Criteria

1. WHEN a user navigates to the vehicle detail page, THE OdometerTab SHALL appear as the 4th tab displaying a chronological list of odometer entries (newest first)
2. WHEN displaying entries, THE OdometerTab SHALL visually distinguish Manual_Entry items from Linked_Entry items
3. WHEN displaying a Linked_Entry with `linkedEntityType` set to `'expense'`, THE OdometerTab SHALL show a navigable link to the source expense
4. THE OdometerTab SHALL display a mileage-over-time line chart using layerchart with entries plotted by recorded date and odometer value
5. WHEN a vehicle has no odometer entries, THE OdometerTab SHALL display an empty state with guidance on how to add readings
6. WHEN an entry has attached photos, THE OdometerTab SHALL display photo thumbnails on that entry

### Requirement 13: Add Odometer Reading Page

**User Story:** As a vehicle owner, I want a dedicated page to add manual odometer readings with optional photos, so that logging mileage follows the same pattern as adding expenses or vehicles.

#### Acceptance Criteria

1. WHEN the user navigates to `/vehicles/:id/odometer/new`, THE AddOdometerReading_Page SHALL display fields for odometer reading (required), date (required, defaulting to today), note (optional), and photo upload (optional)
2. WHEN the user submits a valid reading, THE AddOdometerReading_Page SHALL call the Odometer_API_Service to create the entry and navigate back to the vehicle detail page
3. WHEN the submitted odometer value is lower than the most recent entry's odometer value for that vehicle, THE AddOdometerReading_Page SHALL display a soft warning without preventing submission
4. THE AddOdometerReading_Page SHALL validate the form using Zod before submission

### Requirement 14: Authentication and Authorization

**User Story:** As a developer, I want all odometer operations protected by authentication and ownership checks, so that users can only access their own data.

#### Acceptance Criteria

1. THE Odometer_API SHALL require authentication via the `requireAuth` middleware on all endpoints
2. WHEN listing or creating entries, THE Odometer_API SHALL verify that the authenticated user owns the target vehicle before proceeding
3. WHEN updating or deleting entries, THE Odometer_API SHALL verify that the entry's `userId` matches the authenticated user
