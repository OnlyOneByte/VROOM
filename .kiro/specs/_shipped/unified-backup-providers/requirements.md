# Requirements Document

## Introduction

This document defines the requirements for unifying the backup system so that any configured storage provider (Google Drive, S3-compatible) can serve as a backup target. The feature replaces the hardcoded Google Drive backup logic with a provider-agnostic approach using a new `BackupConfig` JSON column, extends the `StorageProvider` interface with a `list()` method, and introduces a unified restore dialog on the frontend.

## Glossary

- **BackupService**: The backend service responsible for creating, listing, downloading, deleting, and restoring backup ZIP files across storage providers.
- **StorageProvider**: The generic interface implemented by Google Drive and S3-compatible providers for file upload, download, delete, list, and health check operations.
- **StorageProviderRegistry**: The singleton that instantiates and caches provider instances, enforcing user ownership.
- **BackupConfig**: A JSON structure stored in `user_settings.backup_config` that tracks per-provider backup settings (enabled, folderPath, retentionCount, lastBackupAt, sheetsSyncEnabled, sheetsSpreadsheetId).
- **ProviderBackupSettings**: The per-provider entry within BackupConfig containing backup-specific configuration.
- **UnifiedRestoreDialog**: The frontend dialog component that replaces three separate restore flows with a single stepped interface.
- **BackupFileInfo**: The API response type representing a single backup file with provider metadata.
- **ProviderBackupList**: The API response type grouping backup files by provider.
- **SettingsRepository**: The data access layer for reading and writing user settings including backup configuration.
- **Retention_Policy**: The per-provider rule that limits the number of stored backup files by deleting the oldest when the count exceeds `retentionCount`.

## Requirements

### Requirement 1: Multi-Provider Backup Creation

**User Story:** As a user with multiple storage providers, I want my backups to be uploaded to all backup-enabled providers, so that I have redundant copies of my data.

#### Acceptance Criteria

1. WHEN a backup sync is triggered, THE BackupService SHALL generate a single ZIP file and upload it to every provider where `BackupConfig.providers[id].enabled` is `true`
2. WHEN uploading to multiple providers, THE BackupService SHALL execute uploads in parallel using `Promise.allSettled()` so that a slow provider does not block others
3. IF a provider fails during backup upload, THEN THE BackupService SHALL record `{ success: false, message }` for that provider and continue uploading to remaining providers
4. WHEN all uploads complete, THE BackupService SHALL return a `BackupSyncResult` containing one entry per enabled provider with success status, fileRef, fileName, and deletedOldBackups count
5. WHEN at least one provider upload succeeds, THE BackupService SHALL update `backupConfig.providers[id].lastBackupAt` for each successful provider
6. WHEN no providers have backup enabled, THE BackupService SHALL return an empty results object without generating a ZIP file

### Requirement 2: Retention Policy Enforcement

**User Story:** As a user, I want old backups to be automatically deleted based on my retention settings, so that my storage does not fill up with stale backups.

#### Acceptance Criteria

1. WHEN a backup upload succeeds for a provider, THE BackupService SHALL enforce the retention policy for that provider immediately after upload
2. WHILE enforcing retention, THE BackupService SHALL list files matching the `vroom-backup-*.zip` pattern, sort them newest-first by `lastModified`, and delete files beyond the `retentionCount` threshold
3. WHEN retention enforcement completes, THE BackupService SHALL return the count of actually deleted files (not attempted deletions)
4. IF a file deletion fails during retention enforcement, THEN THE BackupService SHALL log a warning and continue deleting remaining files

### Requirement 3: StorageProvider List Method

**User Story:** As a developer, I want a generic `list()` method on the StorageProvider interface, so that backup file enumeration works across all provider types.

#### Acceptance Criteria

1. THE StorageProvider interface SHALL expose a `list(folderPath: string)` method returning `Promise<StorageFileInfo[]>`
2. WHEN `list()` is called on GoogleDriveProvider, THE GoogleDriveProvider SHALL resolve the folder path to a folder ID and return files with `key` set to the Drive `fileId`, `size` coerced via `Number(file.size) || 0`, `createdTime` coalesced from `file.createdTime ?? file.modifiedTime ?? epoch`, and `lastModified` coalesced from `file.modifiedTime ?? file.createdTime ?? epoch`
3. WHEN `list()` is called on S3CompatProvider, THE S3CompatProvider SHALL use `ListObjectsV2Command` with prefix filtering and handle pagination internally via `IsTruncated` and `ContinuationToken`
4. WHEN the folder does not exist or is empty, THE StorageProvider SHALL return an empty array without throwing an error
5. THE StorageProvider `list()` method SHALL return all files by handling provider-specific pagination internally

### Requirement 4: Backup Listing

**User Story:** As a user, I want to see a list of my backups from any provider, so that I can choose which backup to restore.

#### Acceptance Criteria

1. WHEN listing backups for a specific provider, THE BackupService SHALL filter results to files matching the `vroom-backup-*.zip` pattern and sort them newest-first by `lastModified`
2. WHEN listing backups, THE BackupService SHALL mark exactly one file as `isLatest: true` — the most recent backup
3. WHEN listing backups from all providers, THE BackupService SHALL return a `ProviderBackupList[]` with one entry per backup-enabled provider, including an `error` field if listing failed for that provider
4. WHEN a provider has no backup files, THE BackupService SHALL return an empty `backups` array for that provider without an error

### Requirement 5: Backup Download and Restore from Provider

**User Story:** As a user, I want to restore my data from a backup stored on any provider, so that I am not locked into a single restore source.

#### Acceptance Criteria

1. WHEN a restore is requested from a provider, THE BackupService SHALL download the ZIP file using `provider.download()` and pass the buffer to `RestoreService.restoreFromBackup()`
2. WHEN the `POST /sync/restore/from-provider` endpoint receives a request, THE Sync_Routes SHALL validate the body with Zod: `providerId` (string, 1-64 chars), `fileRef` (string, 1-1024 chars), `mode` (enum: preview, replace, merge)
3. IF the downloaded file is not a valid ZIP, THEN THE RestoreService SHALL throw a `SyncError(VALIDATION_ERROR)` with a descriptive message
4. THE BackupService SHALL verify that the requesting user owns the specified provider before downloading

### Requirement 6: BackupConfig Data Model and Validation

**User Story:** As a user, I want per-provider backup settings stored reliably, so that my backup preferences persist and are validated.

#### Acceptance Criteria

1. THE Database_Schema SHALL include a `backup_config` JSON column on `user_settings` with a default value of `'{}'`
2. WHEN `backupConfig` is submitted via `PUT /settings`, THE Settings_Routes SHALL validate it with Zod: `folderPath` (1-255 chars, no `..` segments), `retentionCount` (integer, 1-100), provider count max 20
3. WHEN `backupConfig` is submitted, THE Settings_Routes SHALL verify that every provider ID in `backupConfig.providers` exists in `user_providers` and belongs to the authenticated user
4. THE SettingsRepository SHALL expose an `updateBackupConfig(userId, config)` method that writes the `backupConfig` JSON column

### Requirement 7: Data Migration from Legacy Columns

**User Story:** As an existing user with Google Drive backup settings, I want my settings automatically migrated to the new BackupConfig format, so that I do not lose my backup configuration.

#### Acceptance Criteria

1. WHEN the data migration runs, THE Migration_Script SHALL populate `backup_config` for users where `googleDriveBackupEnabled = true` or `googleSheetsSyncEnabled = true`, using their existing retention count and Sheets settings
2. WHEN a user has `googleDriveBackupEnabled = true` but no Google Drive provider in `user_providers`, THE Migration_Script SHALL skip that user without error
3. WHEN a user already has a non-empty `backup_config`, THE Migration_Script SHALL skip that user (idempotent)
4. WHEN multiple Google Drive providers exist for a user, THE Migration_Script SHALL use the first active one
5. WHEN the migration completes, THE Database_Schema SHALL drop the legacy columns: `google_drive_backup_enabled`, `google_drive_backup_folder_id`, `google_drive_backup_retention_count`, `google_drive_custom_folder_name`, `google_sheets_sync_enabled`, `google_sheets_spreadsheet_id`
6. THE Migration_Script SHALL use raw SQL queries (not ORM or registry) since it runs before those systems are initialized

### Requirement 8: API Endpoint Changes

**User Story:** As a frontend developer, I want provider-agnostic backup API endpoints, so that the UI can work with any storage provider.

#### Acceptance Criteria

1. THE Sync_Routes SHALL expose `GET /sync/backups/providers` returning `ProviderBackupList[]`, with optional `?providerId=xxx` query parameter to filter to a single provider
2. THE Sync_Routes SHALL expose `POST /sync/restore/from-provider` accepting `{ providerId, fileRef, mode }` for restoring from any provider
3. THE Sync_Routes SHALL remove the following legacy endpoints: `GET /sync/backups` (Drive-only listing), `POST /sync/restore/auto`, `POST /sync/configure`, `POST /sync/backups/initialize-drive`
4. THE Sync_Routes SHALL retain these existing endpoints unchanged: `GET /sync/backups/download` (local ZIP download), `POST /sync/restore/from-backup` (file upload restore), `POST /sync/restore/from-sheets` (Sheets restore)

### Requirement 9: Upload Path Handling for Backups

**User Story:** As a developer, I want backup uploads to use an explicit folder path that bypasses the default key-building logic, so that backups land in the correct provider folder.

#### Acceptance Criteria

1. THE UploadParams interface SHALL include an optional `rawPath` field
2. WHEN `rawPath` is set on an upload, THE S3CompatProvider SHALL use `rawPath/fileName` as the object key, bypassing the default `buildKey()` logic
3. WHEN `rawPath` is set on an upload, THE GoogleDriveProvider SHALL use `rawPath` as the folder path for `resolveFolderPath()`
4. WHEN `rawPath` is not set, THE StorageProvider SHALL use the existing `buildKey()` / `pathHint` logic unchanged

### Requirement 10: Google Sheets Sync Migration to Provider Config

**User Story:** As a user with Google Sheets sync enabled, I want the sync toggle to be part of my Google Drive provider settings, so that all Google-related backup features are configured in one place.

#### Acceptance Criteria

1. THE ProviderBackupSettings interface SHALL include optional `sheetsSyncEnabled` and `sheetsSpreadsheetId` fields
2. WHEN executing a Sheets sync via `POST /sync`, THE Sync_Routes SHALL read `sheetsSyncEnabled` from the Google Drive provider's entry in `backupConfig` instead of the legacy `googleSheetsSyncEnabled` column
3. WHEN restoring from Sheets via `POST /sync/restore/from-sheets`, THE RestoreService SHALL accept the `spreadsheetId` as a parameter read from `backupConfig` instead of reading it from the legacy settings column
4. THE Frontend SHALL show the Sheets sync toggle only when editing a Google Drive provider, not for S3-compatible providers

### Requirement 11: Provider Deletion Cleanup

**User Story:** As a user, I want my backup configuration cleaned up when I delete a storage provider, so that stale provider entries do not cause errors.

#### Acceptance Criteria

1. WHEN a storage provider is deleted, THE Provider_Routes SHALL remove that provider's entry from `backupConfig.providers`
2. WHEN a provider is deleted but has no entry in `backupConfig.providers`, THE Provider_Routes SHALL skip cleanup without error
3. WHEN a provider referenced in `backupConfig` no longer exists in `user_providers`, THE BackupService SHALL skip that provider during backup operations without crashing

### Requirement 12: Unified Restore Dialog

**User Story:** As a user, I want a single restore dialog that lets me choose from file upload, any backup-enabled provider, or Google Sheets, so that I have one consistent restore experience.

#### Acceptance Criteria

1. WHEN the restore dialog opens, THE UnifiedRestoreDialog SHALL display source options: "Upload file", each backup-enabled provider by name, and "Google Sheets" (if Sheets sync is enabled)
2. WHEN a provider source is selected, THE UnifiedRestoreDialog SHALL fetch and display available backups sorted newest-first with date, size, and a "latest" badge on the most recent
3. WHEN a backup is selected, THE UnifiedRestoreDialog SHALL show a preview with table counts and conflicts before executing
4. WHEN the user confirms restore, THE UnifiedRestoreDialog SHALL offer mode selection (replace or merge) and execute the restore via the appropriate API endpoint

### Requirement 13: Frontend Type and Store Updates

**User Story:** As a frontend developer, I want updated TypeScript types and store methods that reflect the new provider-agnostic backup system, so that the frontend code is consistent with the backend.

#### Acceptance Criteria

1. THE Frontend_Types SHALL include `BackupConfig`, `ProviderBackupSettings`, `BackupFileInfo`, `ProviderBackupList`, and `BackupSyncResult` type definitions
2. THE Settings_Store SHALL expose methods: `listBackupsFromProvider(providerId)`, `listAllBackups()`, `restoreFromProvider(providerId, fileRef, mode)`, `deleteBackupFromProvider(providerId, fileRef)`
3. THE Settings_Store SHALL remove legacy methods: `listBackups()`, `downloadBackupFromDrive(fileId)`, `restoreFromDriveBackup(fileId, mode)`, `deleteBackup(fileId)`, `initializeDrive()`, `configureSyncSettings()`
4. THE Frontend SHALL derive `googleSheetsSyncEnabled` from `backupConfig.providers` entries with `sheetsSyncEnabled: true`, not from a standalone settings field
5. THE Frontend SHALL derive `lastBackupDate` from the most recent `lastBackupAt` across all providers in `backupConfig`, not from a standalone settings column

### Requirement 14: Ownership and Security Enforcement

**User Story:** As a user, I want all backup operations to verify that I own the provider being accessed, so that my data is protected from unauthorized access.

#### Acceptance Criteria

1. THE BackupService SHALL call `storageProviderRegistry.getProvider(providerId, userId)` for every backup operation, which enforces user ownership
2. WHEN `backupConfig` is updated via `PUT /settings`, THE Settings_Routes SHALL verify that all provider IDs belong to the authenticated user
3. THE BackupConfig validation SHALL reject `folderPath` values containing `..` to prevent path traversal
4. THE Sync_Routes SHALL retain existing rate limiters on backup and restore endpoints

### Requirement 15: Backup Skip Logic

**User Story:** As a user, I want backups to be skipped when no data has changed since the last sync, so that unnecessary backup files are not created.

#### Acceptance Criteria

1. WHEN `performProviderBackup` is called without `force: true`, THE BackupService SHALL check `activityTracker.hasChangesSinceLastSync(userId)` and return `{ skipped: true }` if no changes exist
2. WHEN `force` is `true`, THE BackupService SHALL proceed with backup regardless of change status
