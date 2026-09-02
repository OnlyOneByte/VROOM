# Implementation Plan: Unified Backup Providers

## Overview

Unify the backup system so any configured storage provider (Google Drive, S3-compatible) can serve as a backup target. Replace hardcoded Google Drive backup logic with a provider-agnostic approach using a `BackupConfig` JSON column, extend `StorageProvider` with a `list()` method, and introduce a unified restore dialog on the frontend. This is a hard migration — legacy columns are dropped.

## Tasks

- [x] 1. Backend schema, types, and data model
  - [x] 1.1 Add `StorageFileInfo` interface and `list()` method to `StorageProvider` interface
    - Add `StorageFileInfo` interface (`key`, `name`, `size`, `createdTime`, `lastModified`) to `backend/src/api/providers/storage-provider.ts`
    - Add `list(folderPath: string): Promise<StorageFileInfo[]>` to the `StorageProvider` interface
    - Add optional `rawPath?: string` field to `UploadParams` interface
    - _Requirements: 3.1, 9.1_

  - [x] 1.2 Add `backup_config` column to Drizzle schema and generate migration
    - Add `backupConfig` text column with JSON mode and `$type<BackupConfig>()` to `user_settings` in `backend/src/db/schema.ts`, default `'{}'`
    - Define `BackupConfig`, `ProviderBackupSettings`, `BackupFileInfo`, `ProviderBackupList`, `BackupSyncResult` types in `backend/src/types.ts`
    - Generate Drizzle migration with `bun run db:generate`
    - _Requirements: 6.1, 6.4_

  - [x] 1.3 Write data migration in `backend/src/db/data-migration.ts`
    - Add a migration function using raw SQL (not ORM/registry) that populates `backup_config` for users with `googleDriveBackupEnabled = true` or `googleSheetsSyncEnabled = true`
    - Join `user_providers` to find the first active `google-drive` provider per user
    - Migrate `retentionCount`, `sheetsSyncEnabled`, `sheetsSpreadsheetId` into the provider entry
    - Skip users with no Google Drive provider or already-migrated `backup_config`
    - Handle `googleDriveBackupEnabled = false` but `googleSheetsSyncEnabled = true` case (create entry with `enabled: false`, `sheetsSyncEnabled: true`)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x] 1.4 Write property tests for data migration
    - **Property 9: Migration transformation correctness** — verify migrated `BackupConfig` matches legacy field values
    - **Property 10: Migration idempotency** — verify running migration twice produces same result
    - **Validates: Requirements 7.1, 7.3**

  - [x] 1.5 Drop legacy columns from schema and update migration
    - Remove `googleDriveBackupEnabled`, `googleDriveBackupFolderId`, `googleDriveBackupRetentionCount`, `googleDriveCustomFolderName`, `googleSheetsSyncEnabled`, `googleSheetsSpreadsheetId` from `backend/src/db/schema.ts`
    - Generate migration to drop these columns
    - _Requirements: 7.5_

- [x] 2. Checkpoint — Ensure schema migration and data migration work
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Backend provider implementations (`list()` and `rawPath`)
  - [x] 3.1 Implement `GoogleDriveProvider.list()` and `rawPath` support
    - In `backend/src/api/providers/google-drive-provider.ts`, implement `list(folderPath)`: resolve folder path to ID via `driveService.resolveFolderPath()`, call `listFilesInFolder()`, map to `StorageFileInfo[]` with field coalescing (size via `Number(file.size) || 0`, timestamps coalesced with epoch fallback)
    - Return empty array if folder doesn't exist
    - Update `upload()` to use `rawPath` as folder path when set, falling back to `pathHint`
    - _Requirements: 3.2, 3.4, 9.3_

  - [x] 3.2 Implement `S3CompatProvider.list()` and `rawPath` support
    - In `backend/src/api/providers/s3-compat-provider.ts`, implement `list(folderPath)`: use `ListObjectsV2Command` with prefix, handle pagination via `IsTruncated`/`ContinuationToken`, map to `StorageFileInfo[]`
    - Return empty array if prefix has no objects
    - Update `upload()` to use `rawPath/fileName` as key when `rawPath` is set, bypassing `buildKey()`
    - _Requirements: 3.3, 3.4, 3.5, 9.2_

  - [x] 3.3 Write property tests for StorageFileInfo coalescing and list behavior
    - **Property 3: StorageFileInfo field coalescing** — verify non-undefined fields for all null/undefined input combinations
    - **Property 11: rawPath key routing** — verify rawPath bypasses buildKey for both providers
    - **Validates: Requirements 3.2, 9.2, 9.3, 9.4**

- [x] 4. Backend BackupService extensions
  - [x] 4.1 Add `resolveBackupFolderPath` helper and `loadBackupConfig` to `BackupService`
    - In `backend/src/api/sync/backup.ts`, add `resolveBackupFolderPath(providerRow, settings)` that combines `rootPath + folderPath`
    - Add method to load `BackupConfig` from `settingsRepository` and filter to enabled providers
    - Add `deriveLastBackupDate(backupConfig)` utility function
    - _Requirements: 1.6, 6.4_

  - [x] 4.2 Implement `performProviderBackup()` on `BackupService`
    - Generate ZIP once via existing `exportAsZip()`
    - Upload to all enabled providers in parallel via `Promise.allSettled()` using `rawPath`
    - Accept `force` parameter; skip if `!force` and no changes since last sync
    - Record per-provider success/failure in `BackupSyncResult`
    - Update `backupConfig.providers[id].lastBackupAt` for each successful provider via `settingsRepository.updateBackupConfig()`
    - Return empty results if no providers enabled (no ZIP generated)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 15.1, 15.2_

  - [x] 4.3 Implement `enforceRetention()` on `BackupService`
    - List files via `provider.list(folderPath)`, filter to `vroom-backup-*.zip`, sort newest-first
    - Delete files beyond `retentionCount`, return actual deleted count (not attempted)
    - Log warnings on individual deletion failures, continue with remaining
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 4.4 Implement `listBackups()`, `listAllBackups()`, `downloadBackup()`, `deleteBackup()` on `BackupService`
    - `listBackups(userId, providerId)`: query `user_providers` for metadata, call `provider.list()`, filter/sort, mark `isLatest`
    - `listAllBackups(userId)`: iterate backup-enabled providers, return `ProviderBackupList[]` with per-provider error handling
    - `downloadBackup(userId, providerId, fileRef)`: verify ownership, call `provider.download()`
    - `deleteBackup(userId, providerId, fileRef)`: verify ownership, call `provider.delete()`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.1, 5.4, 14.1_

  - [x] 4.5 Write property tests for BackupService
    - **Property 1: Provider isolation during backup** — verify mixed success/failure results are independent
    - **Property 2: Retention enforcement correctness** — verify correct files deleted, newest preserved
    - **Property 4: Backup listing filter, sort, and badge** — verify filtering, sorting, and isLatest marking
    - **Property 16: Backup skip logic** — verify skip when no changes and force=false
    - **Property 17: lastBackupAt per-provider update** — verify only successful providers updated
    - **Validates: Requirements 1.1, 1.3, 1.4, 1.5, 2.2, 2.3, 2.4, 4.1, 4.2, 15.1, 15.2**

- [x] 5. Checkpoint — Ensure BackupService tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Backend API route changes
  - [x] 6.1 Add `backupConfig` validation to settings routes
    - In `backend/src/api/settings/routes.ts`, add Zod schemas for `ProviderBackupSettings` and `BackupConfig` with validation: `folderPath` (1-255 chars, no `..`), `retentionCount` (int 1-100), provider count max 20
    - Add `backupConfig` to `updateSettingsSchema` as optional
    - Add ownership verification: all provider IDs in `backupConfig.providers` must exist in `user_providers` for the authenticated user
    - _Requirements: 6.2, 6.3, 14.2, 14.3_

  - [x] 6.2 Add `updateBackupConfig()` to `SettingsRepository`
    - In `backend/src/api/settings/repository.ts`, add method to write `backupConfig` JSON column
    - Remove legacy methods: `updateBackupDate()`, `updateBackupFolderId()`, `updateSyncConfig()`
    - _Requirements: 6.4_

  - [x] 6.3 Update sync routes — new provider-agnostic endpoints
    - In `backend/src/api/sync/routes.ts`:
    - Add `GET /sync/backups/providers` returning `ProviderBackupList[]`, with optional `?providerId=xxx` filter
    - Add `POST /sync/restore/from-provider` with Zod validation (`providerId` 1-64 chars, `fileRef` 1-1024 chars, `mode` enum)
    - Update `POST /sync` to use `backupService.performProviderBackup()` for backup and read `sheetsSyncEnabled` from `backupConfig`
    - _Requirements: 8.1, 8.2, 5.2_

  - [x] 6.4 Remove legacy sync routes and Google Drive-specific backup logic
    - Remove `GET /sync/backups` (Drive-only listing), `POST /sync/restore/auto`, `POST /sync/configure`, `POST /sync/backups/initialize-drive`
    - Remove `ensureBackupFolder()`, `performBackupSync()`, `enforceBackupRetention()` from `sync/routes.ts`
    - Remove `autoRestoreFromLatestBackup()` from `RestoreService`
    - Keep: `GET /sync/backups/download`, `POST /sync/restore/from-backup`, `POST /sync/restore/from-sheets`
    - _Requirements: 8.3, 8.4_

  - [x] 6.5 Update Sheets sync to read from `backupConfig`
    - Update `executeSyncType()` in `sync/routes.ts` to find the Google Drive provider entry with `sheetsSyncEnabled: true` in `backupConfig`
    - Update `restoreFromSheets()` in `sync/restore.ts` to accept `spreadsheetId` as a parameter instead of reading from legacy settings
    - Update `sheetsSpreadsheetId` storage to write to `backupConfig` via `settingsRepository.updateBackupConfig()`
    - _Requirements: 10.2, 10.3_

  - [x] 6.6 Add provider deletion cleanup for `backupConfig`
    - In `backend/src/api/providers/routes.ts`, add `cleanupBackupConfig(userId, providerId)` that removes the provider's entry from `backupConfig.providers` on deletion
    - Skip silently if no entry exists
    - _Requirements: 11.1, 11.2_

  - [x] 6.7 Write property tests for API validation and security
    - **Property 6: Restore endpoint input validation** — verify accept/reject behavior for valid/invalid inputs
    - **Property 7: BackupConfig validation** — verify folderPath, retentionCount, and provider count constraints
    - **Property 8: Ownership enforcement** — verify provider ownership checks on all operations
    - **Property 12: Provider deletion cleans up BackupConfig** — verify cleanup on delete, no-op when no entry
    - **Property 13: Stale provider resilience** — verify BackupService skips missing providers
    - **Validates: Requirements 5.2, 5.4, 6.2, 6.3, 11.1, 11.2, 11.3, 14.1, 14.2, 14.3**

- [x] 7. Checkpoint — Ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Backend legacy code cleanup
  - [x] 8.1 Remove all legacy Google Drive backup references from backend
    - Remove legacy column references from `backend/src/db/schema.ts` (if not already done in 1.5)
    - Clean up `backend/src/api/settings/routes.ts` — remove `googleDriveBackup*` and `googleSheets*` from validation schemas and merge logic
    - Clean up `backend/src/api/settings/repository.ts` — remove `updateSyncConfig`, `updateBackupFolderId`, `updateBackupDate` methods
    - Remove `backend/src/api/sync/google-drive.ts` if fully replaced (or clean up unused exports)
    - _Requirements: 7.5_

- [x] 9. Frontend types and API service updates
  - [x] 9.1 Add frontend types for unified backup system
    - In `frontend/src/lib/types/settings.ts`, add `BackupConfig`, `ProviderBackupSettings`, `BackupFileInfo`, `ProviderBackupList`, `BackupSyncResult` types
    - Add `backupConfig?: BackupConfig` to `UserSettings` interface
    - Remove legacy fields: `googleDriveBackupEnabled`, `googleDriveBackupFolderId`, `googleDriveBackupRetentionCount`, `googleDriveCustomFolderName`, `googleSheetsSyncEnabled`, `googleSheetsSpreadsheetId`
    - Update `RestoreResult` to match backend `RestoreResponse` (no recursive `data?` field)
    - _Requirements: 13.1_

  - [x] 9.2 Update `settings-api.ts` with provider-agnostic methods
    - In `frontend/src/lib/services/settings-api.ts`:
    - Add `listBackupsFromProvider(providerId)`, `listAllBackups()`, `restoreFromProvider(providerId, fileRef, mode)`, `deleteBackupFromProvider(providerId, fileRef)`
    - Remove legacy methods: `listBackups()`, `downloadBackupFromDrive()`, `restoreFromDriveBackup()`, `deleteBackup()`, `initializeDrive()`, `configureSyncSettings()`
    - _Requirements: 13.2, 13.3_

  - [x] 9.3 Update `settings.svelte.ts` store with provider-agnostic methods
    - In `frontend/src/lib/stores/settings.svelte.ts`:
    - Add store methods wrapping the new API calls: `listBackupsFromProvider()`, `listAllBackups()`, `restoreFromProvider()`, `deleteBackupFromProvider()`
    - Remove legacy store methods: `listBackups()`, `downloadBackupFromDrive()`, `restoreFromDriveBackup()`, `deleteBackup()`, `initializeDrive()`, `configureSyncSettings()`
    - _Requirements: 13.2, 13.3_

- [x] 10. Frontend component updates — Settings page
  - [x] 10.1 Update `ProviderCard.svelte` with backup toggle
    - Add a "Backup target" switch to each provider card showing whether backup is enabled for that provider
    - Toggle updates `backupConfig.providers[id].enabled` via `PUT /settings`
    - _Requirements: 13.1_

  - [x] 10.2 Update `ProviderForm.svelte` with backup settings section
    - Add "Backup Settings" section: enabled toggle, folder path input, retention count selector
    - For Google Drive providers only: add Sheets sync toggle and spreadsheet ID display
    - Validate folder path (no `..`, max 255 chars) and retention count (1-100) client-side
    - _Requirements: 6.2, 10.1, 10.4_

  - [x] 10.3 Replace `BackupSyncCard.svelte` with provider-agnostic backup card
    - Remove Google Drive-specific toggle, Sheets toggle, retention selector, and Drive initialization
    - Show summary: number of backup-enabled providers, last backup date (derived from `backupConfig`), backup-enabled provider list
    - Derive `googleSheetsSyncEnabled` from `backupConfig.providers` entries with `sheetsSyncEnabled: true`
    - Derive `lastBackupDate` from most recent `lastBackupAt` across all providers
    - _Requirements: 13.4, 13.5_

  - [x] 10.4 Update `BackupNowDialog.svelte` for multi-provider results
    - Update props: replace Drive-specific state with `backupProvidersEnabled` boolean and `syncResults: BackupSyncResult`
    - Show per-provider success/failure in results view
    - Show "Backup to providers" checkbox (replaces "Google Drive") and "Sync to Google Sheets" checkbox
    - _Requirements: 1.4_

  - [x] 10.5 Write property test for frontend derivation logic
    - **Property 15: Frontend derivation correctness** — verify `googleSheetsSyncEnabled` and `lastBackupDate` derivation from `backupConfig`
    - **Validates: Requirements 13.4, 13.5**

- [ ] 11. Frontend component updates — Unified Restore Dialog
  - [ ] 11.1 Create `UnifiedRestoreDialog.svelte` component
    - Step 1: Source selection — "Upload file", each backup-enabled provider by name, "Google Sheets" (if enabled)
    - Step 2 (provider source): Fetch and display backups sorted newest-first with date, size, "latest" badge
    - Step 3: Preview with table counts and conflicts
    - Step 4: Mode selection (replace/merge) and execute via appropriate API endpoint
    - Use `{#if step === N}` blocks for step state machine (no Stepper component)
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

  - [ ] 11.2 Write property test for restore dialog source options
    - **Property 14: Restore dialog source options** — verify correct source options based on providers and Sheets state
    - **Validates: Requirement 12.1**

  - [ ] 11.3 Write property test for restore source equivalence
    - **Property 5: Restore source equivalence** — verify same ZIP produces same RestoreResponse regardless of source
    - **Validates: Requirement 5.1**

- [ ] 12. Frontend wiring — Settings page integration
  - [ ] 12.1 Update `frontend/src/routes/settings/+page.svelte`
    - Remove all `googleDriveBackup*` and `googleSheets*` state variables
    - Derive backup state from `settings.backupConfig`
    - Wire new `BackupSyncCard`, `BackupNowDialog`, and `UnifiedRestoreDialog` components
    - Replace three separate `RestoreDialog` instances with single `UnifiedRestoreDialog`
    - Pass `backupProviders` derived from providers list + `backupConfig`
    - _Requirements: 13.4, 13.5_

  - [ ] 12.2 Remove legacy `RestoreDialog.svelte` and clean up unused components
    - Delete `frontend/src/lib/components/settings/RestoreDialog.svelte` (replaced by `UnifiedRestoreDialog`)
    - Remove any unused imports and dead code from settings components
    - _Requirements: 12.1_

- [ ] 13. Final checkpoint — Ensure all tests pass
  - Run `bun run all:fix && bun run validate` in backend and `npm run all:fix && npm run validate` in frontend
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- This is a hard migration — legacy columns are dropped, no backward compatibility period
- The data migration (task 1.3) must run before the column drop (task 1.5) in the same Drizzle migration sequence
- Backend tasks (1-8) must complete before frontend tasks (9-12) since the API contracts change
