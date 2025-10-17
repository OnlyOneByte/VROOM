# Implementation Plan

## Overview
This implementation plan follows an incremental approach, starting with cleanup and manual backup/restore, then building up to automated sync capabilities.

## Tasks

- [x] 1. Cleanup old endpoints and prepare foundation
  - [x] 1.1 Delete old route files
    - Delete backend/src/routes/sheets.ts
    - Delete backend/src/routes/backup.ts
    - Delete backend/src/routes/drive.ts (if exists)
    - Remove route registrations from backend/src/index.ts
    - Verify application compiles without errors
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_
  
  - [x] 1.2 Create sync-service.ts with base structure
    - Create backend/src/lib/sync-service.ts
    - Define SyncService class with method signatures
    - Define TypeScript interfaces (SyncRequest, SyncResponse, RestoreRequest, RestoreResponse, BackupData, BackupMetadata)
    - Add error handling types (SyncError, SyncErrorCode enum)
    - _Requirements: 2.1, 2.2, 2.3, 9.1, 9.2_
  
  - [x] 1.3 Refactor backup-service.ts for ZIP-only support
    - Remove exportAsJson method
    - Remove individual CSV export methods
    - Update createBackup to include vehicle_financing and vehicle_financing_payments tables
    - Add parseZipBackup method for reading and validating ZIP files
    - Update convertToCSV to handle all table types
    - _Requirements: 2.2, 2.3, 5.1, 5.2, 5.3_

- [x] 2. Implement manual backup and restore
  - [x] 2.1 Create sync routes with download endpoint
    - Create backend/src/routes/sync.ts
    - Implement GET /api/sync/download endpoint
    - Use backup-service.exportAsZip to generate file
    - Set headers: Content-Type (application/zip), Content-Disposition, Content-Length
    - Add route registration in backend/src/index.ts
    - _Requirements: 2.4, 2.12, 1.4_
  
  - [x] 2.2 Implement upload and validation
    - Add POST /api/sync/upload endpoint with multipart/form-data support
    - Add file size validation (max 50MB)
    - Parse uploaded ZIP using backup-service.parseZipBackup
    - Validate ZIP structure (all required CSV files present)
    - Validate metadata.json (version compatibility, userId match)
    - Validate CSV data formats and required columns
    - Return validation errors without modifying data
    - _Requirements: 2.5, 2.6, 2.10, 2.13, 9.3, 9.4, 9.5_
  
  - [x] 2.3 Implement restore modes in sync-service
    - Add restoreFromBackup method with mode parameter (preview, replace, merge)
    - Implement preview mode: parse data and return import summary without changes
    - Implement replace mode: delete all user data, import backup data in transaction
    - Implement merge mode: detect conflicts (matching IDs with different data), require resolution
    - Add detectConflicts helper method
    - Use database transactions for atomicity
    - Rollback on any error
    - _Requirements: 2.7, 2.8, 2.9, 2.11, 9.6, 9.7_

- [x] 3. Refactor and implement Google Sheets sync
  - [x] 3.1 Refactor google-sheets.ts to match database schema
    - Remove updateDashboardSheet method
    - Remove updateMonthlySummarySheet method
    - Remove updateExpenseCategoriesSheet method
    - Update createOrUpdateVroomSpreadsheet to create only 5 sheets: Vehicles, Expenses, Insurance Policies, Vehicle Financing, Vehicle Financing Payments
    - Update sheet methods to include all database columns
    - Replace vehicle_loans with vehicle_financing (include financingType, provider, residualValue, mileageLimit, excessMileageFee, endDate)
    - Replace loan_payments with vehicle_financing_payments (update column names)
    - _Requirements: 10.2, 4.2, 4.3_
  
  - [x] 3.2 Add readSpreadsheetData method
    - Implement method to read all 5 sheets from spreadsheet
    - Parse sheet data into BackupData structure
    - Handle empty sheets gracefully
    - Validate data types during parsing
    - _Requirements: 4.6_
  
  - [x] 3.3 Implement sheets sync in sync-service
    - Add syncToSheets method
    - Get user settings to verify googleSheetsSyncEnabled
    - Create GoogleSheetsService instance with user tokens
    - Call createOrUpdateVroomSpreadsheet
    - Update lastSyncDate in user settings
    - Return spreadsheet info (id, webViewLink)
    - Handle authentication errors (401)
    - _Requirements: 4.1, 4.4, 4.5, 4.9, 4.10_
  
  - [x] 3.4 Add sheets restore functionality
    - Add restoreFromSheets method in sync-service
    - Read data using readSpreadsheetData
    - Validate data types and formats
    - Support preview, replace, and merge modes (reuse restore logic)
    - Detect conflicts in merge mode
    - Use database transactions
    - Add POST /api/sync/restore-from-sheets endpoint
    - _Requirements: 4.6, 4.7, 6.10, 9.3, 9.4, 9.5, 9.6, 9.7_

- [x] 4. Implement unified sync endpoint and Drive backup
  - [x] 4.1 Create executeSync method in sync-service
    - Accept userId and syncTypes array
    - Validate syncTypes array (not empty, valid values: 'sheets', 'backup')
    - Execute sync operations in parallel using Promise.allSettled
    - For 'sheets': call syncToSheets
    - For 'backup': call uploadToGoogleDrive
    - Collect results and errors for each type
    - Return combined results
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_
  
  - [x] 4.2 Implement Drive backup upload
    - Add uploadToGoogleDrive method in sync-service
    - Get user settings to verify googleDriveBackupEnabled
    - Create GoogleDriveService instance
    - Call createVroomFolderStructure to get/create folders
    - Generate ZIP using backup-service.exportAsZip
    - Upload to Backups subfolder with timestamp filename
    - Call cleanupOldBackups (keep last 10)
    - Update lastBackupDate in user settings
    - Return file info (fileId, fileName, webViewLink)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_
  
  - [x] 4.3 Add sync management endpoints
    - Add POST /api/sync endpoint (calls executeSync)
    - Add GET /api/sync/status endpoint (return settings, timestamps, enabled types)
    - Add POST /api/sync/configure endpoint (update settings, validate params, update activity tracker)
    - Add GET /api/sync/backups endpoint (list Drive backups)
    - Add DELETE /api/sync/backups/:fileId endpoint (delete specific backup)
    - Add comprehensive error handling with appropriate status codes
    - Add sync-in-progress check (return 409 if already syncing)
    - _Requirements: 6.7, 6.8, 6.9, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

- [x] 5. Update activity tracker and auto-sync
  - [x] 5.1 Refactor activity tracker to use new sync service
    - Update performAutoSync method in activity-tracker.ts
    - Get user settings to determine enabled sync types
    - Build syncTypes array (add 'sheets' if googleSheetsSyncEnabled, add 'backup' if googleDriveBackupEnabled)
    - Call SyncService.executeSync with syncTypes array
    - Handle errors gracefully (log but don't crash)
    - _Requirements: 3.8_
  
  - [x] 5.2 Verify activity tracking middleware
    - Ensure activity is recorded on all relevant endpoints
    - Verify inactivity timer resets on user activity
    - Test auto-sync triggers after configured inactivity period
    - _Requirements: 3.9_

- [x] 6. Update frontend for new sync system
  - [x] 6.1 Update settings page
    - Add toggle for Google Sheets sync (googleSheetsSyncEnabled)
    - Add toggle for Google Drive backup (googleDriveBackupEnabled)
    - Add input for inactivity timeout (syncInactivityMinutes)
    - Call POST /api/sync/configure on save
    - Display last sync/backup timestamps from GET /api/sync/status
    - _Requirements: 3.1, 3.2, 3.5, 3.6, 3.7_
  
  - [x] 6.2 Add backup/restore UI
    - Add "Download Backup" button (calls GET /api/sync/download)
    - Add file upload input for restore
    - Add restore mode selector (preview, replace, merge)
    - Show import summary for preview mode
    - Show conflicts for merge mode with resolution UI
    - Call POST /api/sync/upload with selected mode
    - _Requirements: 2.4, 2.7, 2.11_
  
  - [x] 6.3 Add manual sync UI
    - Add "Sync Now" button
    - Allow selection of sync types (sheets, backup, both)
    - Call POST /api/sync with selected types
    - Show sync progress and results
    - Display errors if sync fails
    - _Requirements: 4.5_
  
  - [x] 6.4 Remove old endpoint references
    - Search codebase for /api/sheets, /api/backup, /api/drive
    - Replace all references with /api/sync endpoints
    - Update API client/service files
    - Remove unused frontend code
    - _Requirements: 10.1, 10.5_

- [ ] 7. Testing and final validation
  - [ ] 7.1 Test manual backup/restore flows
    - Test download backup
    - Test upload and restore in preview mode
    - Test upload and restore in replace mode
    - Test upload and restore in merge mode with conflicts
    - Verify data integrity after restore
    - Test validation errors (invalid file, version mismatch, wrong user)
    - _Requirements: 2.1-2.13, 9.1-9.7_
  
  - [ ] 7.2 Test Google Sheets sync flows
    - Test sync to sheets (verify all 5 sheets created with correct data)
    - Modify data in sheets manually
    - Test restore from sheets in preview mode
    - Test restore from sheets in replace mode
    - Test conflict detection in merge mode
    - _Requirements: 4.1-4.10_
  
  - [ ] 7.3 Test Google Drive backup and auto-sync
    - Test manual Drive backup upload
    - Verify file appears in Drive Backups folder
    - Test list backups endpoint
    - Test delete backup endpoint
    - Verify cleanup keeps only last 10 backups
    - Test auto-sync after inactivity period
    - Verify activity reset on user action
    - _Requirements: 5.1-5.7, 6.8, 6.9, 3.8, 3.9_
  
  - [ ] 7.4 Run validation and cleanup
    - Run `bun run validate` in backend folder
    - Fix any errors or warnings
    - Remove unused code from google-sheets.ts and backup-service.ts
    - Verify no references to old endpoints remain
    - Update API documentation
    - _Requirements: All, 10.2, 10.3, 10.4_
