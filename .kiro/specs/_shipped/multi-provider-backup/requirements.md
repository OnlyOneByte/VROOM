# Requirements Document

## Introduction

This feature removes the current constraint that limits users to one provider per type per domain, enabling multiple Google Drive providers (each connected to a different Google account). It introduces a provider-driven backup architecture where each provider type implements a backup strategy interface. The backup orchestrator is provider-agnostic — it iterates all providers with backups enabled and delegates to each provider's strategy. For Google Drive, the strategy may include ZIP upload, Sheets sync, or both. The restore flow lets users choose which provider to restore from, and then which source type (ZIP or Sheets) to restore from.

**Breaking Change:** This is a breaking change. No backward compatibility with existing single-provider setups. Users must re-configure backup settings after update.

## Glossary

- **Provider**: A `user_providers` row representing a connected external service (e.g., Google Drive) with encrypted credentials and configuration.
- **Provider_Routes**: The backend Hono route handler at `api/providers/routes.ts` responsible for CRUD operations on providers.
- **Backup_Strategy**: An interface that each provider type implements, defining how that provider performs backups. A strategy receives the provider's credentials and config, and executes the provider's enabled backup capabilities. The interface exposes a single `execute` method.
- **Backup_Orchestrator**: The backend service that triggers backups by iterating all providers with backups enabled and invoking each provider's Backup_Strategy. Providers without a registered strategy are skipped.
- **Google_Drive_Strategy**: The Backup_Strategy implementation for Google Drive providers. It supports two sub-capabilities: ZIP backup upload and Sheets sync, each independently toggleable per provider. Sheets sync (formerly the standalone `performSheetsSync`) is folded into this strategy — `createSheetsServiceForProvider(providerId)` creates a provider-aware Sheets service using that provider's credentials.
- **Restore_Service**: The backend service (`restore.ts`) that reads data from a backup source and imports it into the database. Supports two source types per provider: ZIP restore and Sheets restore.
- **Sync_Routes**: The backend Hono route handler at `api/sync/routes.ts` that exposes backup and restore endpoints. There is no standalone `/restore/from-sheets` endpoint — all restore goes through the unified provider-based restore flow.
- **Backup_Config**: The JSON object stored in `user_settings.backupConfig` that tracks per-provider backup settings at `backupConfig.providers[providerId]`.
- **Provider_Picker**: A frontend UI component that lets the user select a specific provider from a list, and then a restore source type (ZIP, Sheets, or both if available).
- **Settings_Page**: The frontend settings page that displays provider configuration, including multiple providers of the same type.

## Requirements

### Requirement 1: Allow Multiple Providers of the Same Type

**User Story:** As a user, I want to connect multiple Google Drive accounts, so that I can back up my data to different Google accounts simultaneously.

#### Acceptance Criteria

1. WHEN a user creates a provider with the same domain and providerType as an existing provider, THE Provider_Routes SHALL allow the creation and return a 201 response with the new provider.
2. THE Provider_Routes SHALL distinguish multiple providers of the same type by their unique provider ID and the `config.accountEmail` field.
3. WHEN a user lists providers, THE Provider_Routes SHALL return all providers for the user, including multiple providers of the same type.
4. WHEN a user deletes one provider of a given type, THE Provider_Routes SHALL retain all other providers of the same type unchanged.
5. WHEN a user updates a specific provider, THE Provider_Routes SHALL apply changes only to the targeted provider identified by its ID.
6. THE Provider_Routes SHALL reject creation of a provider with the same `config.accountEmail` + `domain` + `providerType` as an existing provider, returning a 409 Conflict response.

### Requirement 2: Provider-Driven Backup Orchestration

**User Story:** As a user, I want backups to automatically fan out to all my enabled providers, so that each provider runs its own backup strategy without me managing them individually.

#### Acceptance Criteria

1. WHEN a backup is triggered (manual or automatic), THE Backup_Orchestrator SHALL retrieve all storage providers for the user that have backups enabled in the Backup_Config.
2. FOR EACH enabled provider, THE Backup_Orchestrator SHALL invoke that provider type's Backup_Strategy, passing the provider's credentials and per-provider config.
3. THE Backup_Orchestrator SHALL remain provider-agnostic and SHALL NOT contain logic specific to any provider type's backup capabilities.
4. IF a provider's Backup_Strategy fails, THEN THE Backup_Orchestrator SHALL continue executing the remaining providers' strategies and report per-provider success or failure.
5. THE Backup_Orchestrator SHALL return a response containing the backup result for each provider, keyed by provider ID.
6. WHEN no providers have backups enabled, THE Backup_Orchestrator SHALL return a response indicating that no backup providers are configured.
7. IF a backup is already in progress for a user, THE Backup_Orchestrator SHALL reject the trigger and return a "backup already in progress" response.
8. WHEN a provider has no registered Backup_Strategy, THE Backup_Orchestrator SHALL skip that provider.

### Requirement 3: Backup Strategy Interface

**User Story:** As a developer, I want each provider type to implement a standard backup strategy interface, so that new provider types can be added without modifying the orchestrator.

#### Acceptance Criteria

1. THE Backup_Strategy SHALL define an `execute` method that accepts the provider's credentials, per-provider Backup_Config entry, and the backup payload.
2. THE Backup_Strategy SHALL return a result object indicating success or failure and any provider-specific metadata (e.g., file IDs, spreadsheet IDs).
3. WHEN a new provider type is added, THE Backup_Orchestrator SHALL support the new type by registering its Backup_Strategy without changes to orchestration logic.

**Note:** The S3 strategy is a placeholder — no implementation is needed now. The orchestrator skips providers without a registered strategy.

### Requirement 4: Google Drive Backup Strategy

**User Story:** As a user, I want my Google Drive provider to support both ZIP backups and Sheets sync as independently toggleable sub-capabilities, so that I can choose which backup methods each account uses.

#### Acceptance Criteria

1. THE Google_Drive_Strategy SHALL implement the Backup_Strategy interface for Google Drive providers.
2. WHEN the Google_Drive_Strategy executes, THE Google_Drive_Strategy SHALL check the provider's Backup_Config entry for which sub-capabilities are enabled.
3. WHEN ZIP backup is enabled for a provider, THE Google_Drive_Strategy SHALL generate a ZIP backup and upload it to the configured path in that provider's Google Drive.
4. WHEN Sheets sync is enabled for a provider, THE Google_Drive_Strategy SHALL create or update a separate VROOM spreadsheet in that specific provider's Google Drive, using that provider's credentials via `createSheetsServiceForProvider(providerId)`. Each Google Drive provider with Sheets sync enabled gets its own dedicated spreadsheet in its own Drive.
5. WHEN both ZIP backup and Sheets sync are enabled, THE Google_Drive_Strategy SHALL execute both sub-capabilities for that provider.
6. WHEN Sheets sync completes for a provider, THE Google_Drive_Strategy SHALL store the `sheetsSpreadsheetId` in that provider's Backup_Config entry.
7. IF one sub-capability fails, THEN THE Google_Drive_Strategy SHALL continue executing the remaining sub-capabilities and report per-capability success or failure.

**Note:** The standalone `performSheetsSync` function is folded into this strategy. Sheets sync is a sub-capability of the Google Drive strategy, not a standalone operation. The strategy uses `createSheetsServiceForProvider(providerId)` to create a provider-aware Sheets service with that provider's credentials.

### Requirement 5: Provider-Specific Restore

**User Story:** As a user, I want to choose which provider and source type to restore from, so that I can pick the correct data source when I have multiple accounts and backup methods.

#### Acceptance Criteria

1. WHEN a user initiates a restore, THE Restore_Service SHALL accept a provider ID parameter and a source type parameter (ZIP or Sheets) identifying which provider and backup source to restore from.
2. WHEN the source type is ZIP, THE Restore_Service SHALL use that provider's credentials to download and extract the ZIP backup from that provider's storage.
3. WHEN the source type is Sheets, THE Restore_Service SHALL use that provider's credentials and `sheetsSpreadsheetId` from the provider's Backup_Config entry to read data from that provider's spreadsheet.
4. IF the specified provider ID does not exist or is not active, THEN THE Restore_Service SHALL return a descriptive error indicating the provider is invalid.
5. IF the specified provider has no backup metadata for the requested source type in its Backup_Config entry, THEN THE Restore_Service SHALL return an error indicating no backup of that type is available for that provider.
6. WHEN a user requests a list of providers available for restore, THE Sync_Routes SHALL return all active providers that have backup metadata in their Backup_Config entry, including which source types (ZIP, Sheets, or both) are available per provider.

**Note:** There is no standalone `/restore/from-sheets` endpoint. All restore operations go through the unified provider-based restore flow where the user picks a provider, then a source type.

### Requirement 6: Frontend Provider Selection for Restore

**User Story:** As a user, I want a UI that shows me which providers are available for restore and what source types each supports, so that I can pick the right one.

#### Acceptance Criteria

1. WHEN a user opens the restore dialog, THE Provider_Picker SHALL display a list of providers that have backup metadata available.
2. THE Provider_Picker SHALL display each provider's `accountEmail` and provider type so the user can distinguish between accounts.
3. THE Provider_Picker SHALL display the available restore source types (ZIP, Sheets, or both) for each provider.
4. WHEN only one provider is available for restore with only one source type, THE Provider_Picker SHALL auto-select that provider and source type without requiring user interaction.
5. WHEN the user selects a provider and source type and confirms, THE Provider_Picker SHALL pass the selected provider ID and source type to the restore API call.
6. IF no providers have backup metadata, THEN THE Provider_Picker SHALL display a message indicating no backups are available.

### Requirement 7: Provider Credential Isolation During Backup

**User Story:** As a user, I want each provider's backup to use its own credentials, so that my accounts remain properly isolated.

#### Acceptance Criteria

1. WHEN performing backup fan-out, THE Backup_Orchestrator SHALL pass each provider's own decrypted credentials to that provider's Backup_Strategy.
2. THE Backup_Strategy SHALL retrieve the refresh token from the specific provider's encrypted `credentials` column, not from a shared or first-found provider.
3. IF a provider's credentials are missing or invalid, THEN THE Backup_Orchestrator SHALL skip that provider, log a warning, and continue with the remaining providers.
4. THE Backup_Strategy SHALL accept a provider ID parameter instead of only a user ID, so the caller can target a specific provider's credentials.

### Requirement 8: Frontend Provider Settings Management

**User Story:** As a user, I want the settings page to show all my connected providers including multiple accounts of the same type, so that I can configure backup settings for each provider independently.

#### Acceptance Criteria

1. THE Settings_Page SHALL display all connected providers, including multiple providers of the same type.
2. THE Settings_Page SHALL display each provider's `accountEmail` to distinguish between providers of the same type.
3. THE Settings_Page SHALL allow the user to independently configure backup settings (ZIP backup enabled, Sheets sync enabled) for each provider.
4. WHEN a user toggles a backup capability for one provider, THE Settings_Page SHALL update only that provider's Backup_Config entry without affecting other providers.
5. THE Settings_Page SHALL display the current backup status (last backup time, success or failure) per provider.
