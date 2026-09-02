# Implementation Plan: Custom Drive Folder Name

## Overview

Add a user setting for customizing the Google Drive backup folder name. This involves a DB schema change, a centralized folder name resolver, updates to GoogleDriveService and all its callers, backend validation, and a frontend input in BackupSyncCard. The implementation is incremental: schema first, then backend logic, then frontend wiring.

## Tasks

- [x] 1. Database schema and migration
  - [x] 1.1 Add `googleDriveCustomFolderName` column to `userSettings` in `backend/src/db/schema.ts`
    - Add `googleDriveCustomFolderName: text('google_drive_custom_folder_name')` after `googleDriveBackupRetentionCount`
    - _Requirements: 3.1_

  - [x] 1.2 Generate the Drizzle migration
    - Run `bun run db:generate` from `backend/` to create migration `0005`
    - Review the generated SQL to confirm it's an `ALTER TABLE ADD COLUMN`
    - _Requirements: 3.1_

  - [x] 1.3 Write migration test for migration 0005
    - Create `backend/src/db/__tests__/migration-0005.test.ts`
    - Test that `google_drive_custom_folder_name` column exists in `user_settings` after migration
    - Test that seed data survives the migration
    - Update expected tables list in `migration-general.test.ts` if needed
    - _Requirements: 3.1_

- [x] 2. Folder name resolution utility and core backend logic
  - [x] 2.1 Create `resolveVroomFolderName()` utility
    - Create `backend/src/api/sync/folder-name.ts`
    - Implement: return `customName.trim()` if non-null and non-empty after trim, else return `VROOM Car Tracker - ${displayName}`
    - Export the function for use by all callers
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 2.2 Write property test: custom name passthrough with trimming
    - **Property 1: Custom name passthrough with trimming**
    - For any non-empty-after-trim string `s` and any display name, `resolveVroomFolderName(s, displayName)` returns `s.trim()`
    - Use fast-check arbitrary strings, filter to non-empty-after-trim
    - **Validates: Requirements 1.1, 1.4**

  - [x] 2.3 Write property test: empty input fallback to default name
    - **Property 2: Empty input fallback to default name**
    - For null, undefined, empty string, or whitespace-only input, and any non-empty display name, returns `VROOM Car Tracker - {displayName}`
    - Use fast-check `oneof(constant(null), constant(undefined), constant(''), stringOf(constant(' ')))`
    - **Validates: Requirements 1.2, 1.3**

- [x] 3. GoogleDriveService updates
  - [x] 3.1 Change `createVroomFolderStructure` parameter from `userName` to `folderName`
    - In `backend/src/api/sync/google-drive.ts`, rename the parameter and remove the internal name construction
    - The method should use `folderName` directly in `findFolder()` and `createFolder()` calls instead of `VROOM Car Tracker - ${userName}`
    - _Requirements: 4.3, 7.1_

  - [x] 3.2 Add `renameFolder()` method to `GoogleDriveService`
    - Implement `async renameFolder(folderId: string, newName: string): Promise<void>` using `drive.files.update` with `name` in requestBody
    - _Requirements: 5.2_

- [x] 4. Update all callers to use resolved folder name
  - [x] 4.1 Update sync routes (`backend/src/api/sync/routes.ts`)
    - Import `resolveVroomFolderName` from `./folder-name`
    - At each call site, read `settings.googleDriveCustomFolderName` and resolve the name before passing to `createVroomFolderStructure()`
    - Replace `displayName` / `user.displayName` arguments with the resolved folder name
    - _Requirements: 4.1, 4.2, 7.2_

  - [x] 4.2 Update photo helpers (`backend/src/api/photos/helpers.ts`)
    - Import `resolveVroomFolderName` and resolve the folder name before each `createVroomFolderStructure()` call
    - Load user settings to get `googleDriveCustomFolderName` where not already available
    - _Requirements: 4.1, 7.2_

  - [x] 4.3 Update Google Sheets service (`backend/src/api/sync/google-sheets.ts`)
    - Import `resolveVroomFolderName` and resolve the folder name before `createVroomFolderStructure()` call in `createOrUpdateVroomSpreadsheet()`
    - _Requirements: 4.1, 7.2_

- [x] 5. Checkpoint
  - Ensure all backend changes compile and existing tests pass. Run `bun run all:fix && bun run validate` from `backend/`. Ask the user if questions arise.

- [x] 6. Backend validation and rename on save
  - [x] 6.1 Add Zod validation for `googleDriveCustomFolderName` in settings routes
    - In `backend/src/api/settings/routes.ts`, add validation to `updateSettingsSchema`: max 255 chars, no `/` or `\`, trim whitespace, coerce empty string to null
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.2_

  - [x] 6.2 Add best-effort folder rename in the PUT `/settings` handler
    - After persisting the updated setting, if `googleDriveBackupFolderId` exists, resolve the new folder name and attempt `driveService.renameFolder()` on the parent folder
    - Use `getFileMetadata` to find the parent of the backup folder, then rename it
    - Wrap in try/catch — log warning on failure, don't fail the save
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 6.3 Write property test: folder name validation correctness
    - **Property 3: Folder name validation correctness**
    - For any string, the validation accepts iff it contains no `/` or `\` and length ≤ 255
    - Use fast-check arbitrary strings, test the Zod schema's `safeParse`
    - **Validates: Requirements 2.1, 2.2, 2.3**

- [x] 7. Frontend type and UI updates
  - [x] 7.1 Add `googleDriveCustomFolderName` to frontend `UserSettings` type
    - In `frontend/src/lib/types.ts`, add `googleDriveCustomFolderName?: string` to the `UserSettings` interface
    - _Requirements: 3.3_

  - [x] 7.2 Add folder name input to `BackupSyncCard`
    - In `frontend/src/lib/components/settings/BackupSyncCard.svelte`:
    - Add a bindable `googleDriveCustomFolderName` prop
    - Show a text `Input` (from shadcn-svelte) when Google Drive backup is enabled
    - Add `Label` with "Google Drive folder name"
    - Set placeholder to show the default name pattern
    - Add inline validation: show error with `border-destructive` if value contains `/` or `\`
    - Add helper text: "Leave empty to use the default name"
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 7.3 Wire the new prop in the settings page
    - In the settings page that renders `BackupSyncCard`, bind `googleDriveCustomFolderName` from the settings store/data and include it in the save payload
    - _Requirements: 3.1, 3.3, 6.1_

- [x] 8. Final checkpoint
  - Ensure all tests pass in both `backend/` and `frontend/`. Run `bun run all:fix && bun run validate` in `backend/` and `npm run all:fix && npm run validate` in `frontend/`. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests use fast-check and validate universal correctness properties from the design document
- The next migration number is `0005` (after existing `0000`–`0004`)
- Backup/restore/sync pipeline files (`config.ts`, `types.ts`, `backup.ts`, `restore.ts`, `google-sheets.ts`) do not need updates since this is a settings-only column, not a new data table
