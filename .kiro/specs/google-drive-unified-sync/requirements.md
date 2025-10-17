# Requirements Document

## Introduction

This feature consolidates the existing fragmented Google Drive integration (sheets, backup, and drive routes) into a unified sync system. The goal is to provide users with a clean, flexible way to sync their VROOM data to Google Drive in two distinct formats:

1. **Google Sheets Sync** - Human-readable spreadsheet format for viewing/editing data in Google Sheets (two-way sync capability)
2. **File Backup Sync** - Machine-readable file dumps (JSON, CSV, ZIP) for data portability and programmatic access

Users can enable one or both sync methods, with all data stored in a configurable Google Drive folder (defaulting to "VROOM Car Tracker"). This ensures data ownership and accessibility even if the service becomes unavailable.

## Requirements

### Requirement 1: Cleanup Old Endpoints (Priority: Critical - Do First)

**User Story:** As a developer, I want to remove old fragmented endpoints immediately, so that the codebase is clean before implementing new features.

#### Acceptance Criteria

1. WHEN starting implementation THEN the system SHALL delete backend/src/routes/sheets.ts
2. WHEN starting implementation THEN the system SHALL delete backend/src/routes/backup.ts
3. WHEN starting implementation THEN the system SHALL delete backend/src/routes/drive.ts if it exists
4. WHEN deleting old routes THEN the system SHALL remove route registrations from the main app file
5. WHEN deleting old routes THEN the system SHALL identify and list all frontend references to old endpoints
6. WHEN old routes are removed THEN the system SHALL ensure the application still compiles without errors

### Requirement 2: Manual Backup and Restore (Priority: High - Implement First)

**User Story:** As a user, I want to manually download and upload backup files, so that I can have direct control over my data without relying on cloud sync.

#### Acceptance Criteria

1. WHEN a user requests a manual backup THEN the system SHALL generate a ZIP file containing all user data
2. WHEN generating a manual backup THEN the system SHALL include CSV files for: vehicles, expenses, insurance_policies, vehicle_financing, and vehicle_financing_payments
3. WHEN generating a manual backup THEN the system SHALL include a metadata.json file with version, timestamp, and userId
4. WHEN a user downloads a backup THEN the system SHALL return the ZIP file with filename "vroom-backup-{ISO-timestamp}.zip"
5. WHEN a user uploads a backup file THEN the system SHALL validate the file format and structure
6. WHEN a user uploads a backup file THEN the system SHALL validate the metadata version for compatibility
7. WHEN restoring from a backup THEN the system SHALL provide options: replace all data, merge with existing data, or preview changes
8. WHEN restoring with replace option THEN the system SHALL delete existing user data and import backup data
9. WHEN restoring with merge option THEN the system SHALL detect conflicts and require user resolution
10. WHEN restore validation fails THEN the system SHALL return specific error messages without modifying data
11. WHEN restore completes successfully THEN the system SHALL return a summary of imported records
12. WHEN implementing manual backup/restore THEN the system SHALL provide GET /api/sync/download endpoint
13. WHEN implementing manual backup/restore THEN the system SHALL provide POST /api/sync/upload endpoint accepting multipart/form-data

### Requirement 3: Unified Sync Configuration (Priority: Medium)

**User Story:** As a user, I want to configure my sync preferences in one place, so that I can easily control how my data is backed up to Google Drive.

#### Acceptance Criteria

1. WHEN a user accesses sync settings THEN the system SHALL display options to enable/disable Google Sheets sync independently
2. WHEN a user accesses sync settings THEN the system SHALL display options to enable/disable file backup sync independently
3. WHEN a user enables either sync method THEN the system SHALL validate Google Drive authentication
4. WHEN a user saves sync configuration THEN the system SHALL persist settings to the database
5. WHEN a user enables auto-sync THEN the system SHALL allow configuration of inactivity timeout in minutes (e.g., 5 minutes)
6. WHEN the backend detects user inactivity for the configured duration THEN the system SHALL automatically trigger sync for enabled sync methods
7. WHEN a user is actively using the application THEN the system SHALL reset the inactivity timer
8. WHEN sync is enabled THEN the system SHALL use "VROOM Car Tracker - {userName}" as the default Google Drive folder

### Requirement 4: Google Sheets Sync (Two-Way) (Priority: Medium)

**User Story:** As a user, I want my data synced to Google Sheets, so that I can view and edit my vehicle data in a familiar spreadsheet interface.

#### Acceptance Criteria

1. WHEN Google Sheets sync is enabled THEN the system SHALL create or update a spreadsheet named "VROOM Data - {userName}" in the configured folder
2. WHEN syncing to Google Sheets THEN the system SHALL create separate sheets matching the database structure: Vehicles, Expenses, Insurance Policies, Vehicle Financing, and Vehicle Financing Payments
3. WHEN syncing to Google Sheets THEN the system SHALL include all columns from the database tables with appropriate headers
4. WHEN syncing to Google Sheets THEN the system SHALL push all current user data to the spreadsheet
5. WHEN a user manually triggers sync THEN the system SHALL update the Google Sheet with latest data within 5 seconds
6. WHEN data is modified in Google Sheets THEN the system SHALL provide an endpoint to pull changes back to the local database (two-way sync)
7. WHEN pulling data from Google Sheets THEN the system SHALL detect and report conflicts between local and remote data
8. WHEN syncing fails due to authentication THEN the system SHALL return a 401 error with clear re-authentication instructions
9. WHEN sync completes successfully THEN the system SHALL update the lastSyncDate timestamp in user settings
10. WHEN sync completes successfully THEN the system SHALL return the spreadsheet ID and web view link

### Requirement 5: File Backup Sync to Google Drive (Priority: Medium)

**User Story:** As a user, I want to automatically backup my data to Google Drive, so that I have cloud-stored copies without manual intervention.

#### Acceptance Criteria

1. WHEN file backup sync is enabled THEN the system SHALL support ZIP format containing CSV files for each data table
2. WHEN creating a ZIP backup THEN the system SHALL include separate CSV files for: vehicles, expenses, insurance_policies, vehicle_financing, and vehicle_financing_payments
3. WHEN creating a ZIP backup THEN the system SHALL include a metadata.json file with version, timestamp, and userId
4. WHEN a user triggers file backup THEN the system SHALL upload the file to the "Backups" subfolder in the configured Google Drive folder
5. WHEN uploading a backup THEN the system SHALL name files with timestamp: "vroom-backup-{ISO-timestamp}.zip"
6. WHEN a backup is uploaded THEN the system SHALL automatically cleanup old backups keeping only the last 10 files
7. WHEN backup completes successfully THEN the system SHALL update the lastBackupDate timestamp in user settings

### Requirement 6: Sync Endpoint Consolidation (Priority: Medium)

**User Story:** As a developer, I want a clean API surface for sync operations, so that the frontend has a simple interface to work with.

#### Acceptance Criteria

1. WHEN implementing the sync API THEN the system SHALL provide a POST /api/sync endpoint for triggering sync operations
2. WHEN calling POST /api/sync THEN the system SHALL accept parameter: syncTypes as an array of strings (e.g., ["sheets"], ["backup"], or ["sheets", "backup"])
3. WHEN calling POST /api/sync with syncTypes containing "sheets" THEN the system SHALL execute Google Sheets sync
4. WHEN calling POST /api/sync with syncTypes containing "backup" THEN the system SHALL execute file backup sync
5. WHEN calling POST /api/sync with multiple syncTypes THEN the system SHALL execute all specified sync operations in parallel
6. WHEN calling POST /api/sync with an empty or invalid syncTypes array THEN the system SHALL return a 400 error with validation message
7. WHEN implementing the sync API THEN the system SHALL provide a GET /api/sync/status endpoint returning sync configuration and last sync timestamps
8. WHEN implementing the sync API THEN the system SHALL provide a POST /api/sync/configure endpoint for updating sync settings including inactivity timeout
9. WHEN implementing the sync API THEN the system SHALL provide a GET /api/sync/backups endpoint for listing available backups in Drive
10. WHEN implementing the sync API THEN the system SHALL provide a DELETE /api/sync/backups/:fileId endpoint for deleting specific backups
11. WHEN implementing the sync API THEN the system SHALL provide a POST /api/sync/restore-from-sheets endpoint for pulling data from Google Sheets back to local database

### Requirement 7: Google Drive Folder Management (Priority: Medium)

**User Story:** As a user, I want my data organized in Google Drive, so that I can easily find and manage my VROOM files.

#### Acceptance Criteria

1. WHEN sync is first enabled THEN the system SHALL create a main folder structure: "VROOM Car Tracker - {userName}"
2. WHEN creating the folder structure THEN the system SHALL create subfolders: Backups, Receipts, Maintenance Records, Vehicle Photos
3. WHEN checking for existing folders THEN the system SHALL reuse existing folders rather than creating duplicates
4. WHEN the Google Sheet is created THEN the system SHALL place it in the main VROOM folder (not in Backups subfolder)
5. WHEN file backups are created THEN the system SHALL place them in the Backups subfolder
6. WHEN folder creation fails THEN the system SHALL return a clear error message with troubleshooting steps

### Requirement 8: Error Handling and Recovery (Priority: Low)

**User Story:** As a user, I want clear error messages when sync fails, so that I can understand and resolve issues.

#### Acceptance Criteria

1. WHEN Google authentication is invalid or expired THEN the system SHALL return a 401 error with message "Google Drive access not available. Please re-authenticate with Google."
2. WHEN sync fails due to network issues THEN the system SHALL return a 500 error with a retry suggestion
3. WHEN sync fails due to quota limits THEN the system SHALL return a 429 error with information about Google Drive limits
4. WHEN sync fails due to permission issues THEN the system SHALL return a 403 error with instructions to check folder permissions
5. WHEN a conflict is detected during restore THEN the system SHALL return conflict details and require user resolution
6. WHEN an error occurs THEN the system SHALL log detailed error information for debugging
7. WHEN sync is in progress and another sync is triggered THEN the system SHALL return a 409 error indicating sync already in progress

### Requirement 9: Data Integrity and Validation (Priority: High)

**User Story:** As a user, I want my data to remain accurate during sync operations, so that I don't lose or corrupt information.

#### Acceptance Criteria

1. WHEN syncing data THEN the system SHALL validate all data before uploading
2. WHEN creating backups THEN the system SHALL include version information for compatibility checking
3. WHEN restoring from backup or Google Sheets THEN the system SHALL validate data types and formats
4. WHEN restoring from backup or Google Sheets THEN the system SHALL perform a dry-run validation before applying changes
5. WHEN data validation fails THEN the system SHALL return specific validation errors without modifying data
6. WHEN syncing THEN the system SHALL use database transactions to ensure atomicity
7. WHEN a sync operation fails mid-process THEN the system SHALL rollback any partial changes

### Requirement 10: Service Refactoring (Priority: Medium)

**User Story:** As a developer, I want to refactor existing services to support the new unified sync system, so that code is reusable and maintainable.

#### Acceptance Criteria

1. WHEN refactoring services THEN the system SHALL update all frontend code to use new /api/sync endpoints
2. WHEN refactoring services THEN the system SHALL refactor google-sheets.ts to remove dashboard/summary generation logic
3. WHEN refactoring services THEN the system SHALL refactor backup-service.ts to only support ZIP format
4. WHEN refactoring services THEN the system SHALL consolidate shared logic into a unified sync-service.ts
5. WHEN refactoring is complete THEN the system SHALL ensure no references to old endpoints remain in the codebase
