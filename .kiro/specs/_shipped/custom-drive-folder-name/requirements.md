# Requirements Document

## Introduction

This document defines the requirements for the Custom Drive Folder Name feature. Currently, the VROOM application hardcodes the Google Drive backup folder name as `VROOM Car Tracker - {userName}`. This feature allows users to customize that folder name via a setting in the application, with validation, fallback to the default name, and best-effort renaming of existing folders.

## Glossary

- **Settings_API**: The backend HTTP API layer handling user settings CRUD operations at `/api/v1/settings`
- **Folder_Name_Resolver**: The `resolveVroomFolderName()` utility function that determines the effective folder name from user preferences
- **GoogleDriveService**: The backend service responsible for interacting with the Google Drive API for folder creation, renaming, and file operations
- **BackupSyncCard**: The frontend Svelte component within the settings page that displays Google Drive backup configuration options
- **Custom_Folder_Name**: The user-provided string stored in `user_settings.googleDriveCustomFolderName` representing the preferred Drive folder name
- **Default_Folder_Name**: The system-generated folder name following the pattern `VROOM Car Tracker - {displayName}`
- **Validation_Layer**: The Zod-based schema validation applied to incoming settings data on the backend

## Requirements

### Requirement 1: Folder Name Resolution

**User Story:** As a user, I want the system to use my custom folder name when creating Google Drive folders, so that I can organize my Drive files according to my preferences.

#### Acceptance Criteria

1. WHEN a Custom_Folder_Name is non-null and non-empty after trimming, THE Folder_Name_Resolver SHALL return the trimmed Custom_Folder_Name as the effective folder name
2. WHEN a Custom_Folder_Name is null, undefined, or empty after trimming, THE Folder_Name_Resolver SHALL return the Default_Folder_Name using the pattern `VROOM Car Tracker - {displayName}`
3. WHEN a Custom_Folder_Name consists entirely of whitespace characters, THE Folder_Name_Resolver SHALL treat the value as empty and return the Default_Folder_Name
4. THE Folder_Name_Resolver SHALL trim leading and trailing whitespace from the Custom_Folder_Name before returning the result

### Requirement 2: Folder Name Validation

**User Story:** As a user, I want clear feedback when I enter an invalid folder name, so that I can correct it before saving.

#### Acceptance Criteria

1. WHEN a Custom_Folder_Name contains a forward slash (`/`) or backslash (`\`) character, THE Validation_Layer SHALL reject the input with a descriptive error message
2. WHEN a Custom_Folder_Name exceeds 255 characters in length, THE Validation_Layer SHALL reject the input with a descriptive error message
3. WHEN a Custom_Folder_Name passes all validation rules, THE Validation_Layer SHALL accept the input and allow persistence
4. THE Settings_API SHALL validate the Custom_Folder_Name using the Validation_Layer before persisting changes to the database

### Requirement 3: Settings Persistence

**User Story:** As a user, I want my custom folder name preference to be saved, so that it persists across sessions and is used for future backup operations.

#### Acceptance Criteria

1. WHEN a user saves a valid Custom_Folder_Name via the Settings_API, THE Settings_API SHALL persist the value in the `googleDriveCustomFolderName` column of the `user_settings` table
2. WHEN a user saves an empty string as the Custom_Folder_Name, THE Settings_API SHALL store null in the database to indicate use of the Default_Folder_Name
3. WHEN settings are loaded, THE Settings_API SHALL return the stored Custom_Folder_Name value to the frontend

### Requirement 4: Folder Creation with Custom Name

**User Story:** As a user, I want new Google Drive backup folders to use my custom name, so that the folder structure reflects my preference.

#### Acceptance Criteria

1. WHEN creating a new folder structure and a Custom_Folder_Name is configured, THE GoogleDriveService SHALL use the resolved folder name from the Folder_Name_Resolver as the root folder name
2. WHEN creating a new folder structure and no Custom_Folder_Name is configured, THE GoogleDriveService SHALL use the Default_Folder_Name as the root folder name
3. THE GoogleDriveService SHALL accept a pre-resolved folder name parameter instead of computing the name internally

### Requirement 5: Existing Folder Continuity

**User Story:** As a user, I want my existing backups to remain accessible when I change the folder name, so that I do not lose any data.

#### Acceptance Criteria

1. WHEN a user changes the Custom_Folder_Name and a stored `googleDriveBackupFolderId` exists, THE GoogleDriveService SHALL continue using the stored folder ID for backup operations
2. WHEN a user changes the Custom_Folder_Name and a stored `googleDriveBackupFolderId` exists, THE GoogleDriveService SHALL attempt a best-effort rename of the existing Drive folder to match the new resolved name
3. IF the Drive folder rename fails due to network errors or permission issues, THEN THE Settings_API SHALL still persist the updated Custom_Folder_Name and log a warning

### Requirement 6: Frontend Folder Name Input

**User Story:** As a user, I want a text input in the backup settings to enter my preferred folder name, so that I can easily customize it.

#### Acceptance Criteria

1. WHILE Google Drive backup is enabled, THE BackupSyncCard SHALL display a text input field for the Custom_Folder_Name
2. WHEN the Custom_Folder_Name input is empty, THE BackupSyncCard SHALL display a placeholder showing the Default_Folder_Name pattern
3. WHEN a user enters a folder name containing `/` or `\`, THE BackupSyncCard SHALL display an inline validation error message
4. THE BackupSyncCard SHALL display helper text indicating that leaving the field empty uses the default name

### Requirement 7: Caller Resolution Consistency

**User Story:** As a developer, I want all code paths that create Drive folders to use the centralized name resolution, so that folder naming is consistent and maintainable.

#### Acceptance Criteria

1. THE GoogleDriveService.createVroomFolderStructure method SHALL accept a resolved folder name string as its parameter instead of a raw user name
2. WHEN any caller needs to create a Drive folder structure, THE caller SHALL resolve the folder name through the Folder_Name_Resolver before invoking createVroomFolderStructure
