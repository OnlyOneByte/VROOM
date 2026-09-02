# Multi-Provider Backup — Tasks

## Phase 1: Folder Reorganization

- [x] 1. Reorganize provider folder structure
  - [x] 1.1 Create `providers/domains/storage/` directory and move `storage-provider.ts`, `google-drive-provider.ts`, `s3-compat-provider.ts`, `registry.ts` into it (Req 3)
  - [x] 1.2 Create `providers/services/` directory and move `google-drive-service.ts`, `google-sheets-service.ts` into it (Req 3, 4)
  - [x] 1.3 Create `providers/backup-strategies/` directory (Req 3, 4)
  - [x] 1.4 Update all import paths in `providers/routes.ts`, `providers/sync-worker.ts`, `providers/__tests__/*.ts`, and any other files referencing moved modules (Req 3)

## Phase 2: Backend Strategy Pattern

- [x] 2. Create backup strategy interface, registry, and init
  - [x] 2.1 Create `sync/backup-strategy.ts` — define `BackupStrategyContext`, `BackupCapabilityResult`, `BackupStrategyResult`, `BackupStrategy` interface, and `BackupOrchestratorResult` type (Req 3)
  - [x] 2.2 Create `sync/backup-strategy-registry.ts` — registry with `register(providerType, strategy)` and `get(providerType)` methods (Req 2.8, 3.3)
  - [x] 2.3 Create `sync/init.ts` — imports `GoogleDriveStrategy`, registers it in the registry for `'google-drive'` provider type (Req 3.3)
  - [x] 2.4 Import `sync/init.ts` in `index.ts` to trigger strategy registration at startup (Req 3.3)

## Phase 3: Google Drive Strategy

- [x] 3. Implement GoogleDriveStrategy
  - [x] 3.1 Create `providers/backup-strategies/google-drive-strategy.ts` implementing `BackupStrategy` interface (Req 4.1)
  - [x] 3.2 Implement ZIP upload sub-capability: create `GoogleDriveProvider` directly from `decryptedCredentials.refreshToken`, upload ZIP, call `backupService.enforceRetention(userId, providerId)` after successful upload. Return `fileRef`, `fileName`, `deletedOldBackups` in metadata (Req 4.3)
  - [x] 3.3 Implement Sheets sync sub-capability: create `GoogleSheetsService` directly from `decryptedCredentials.refreshToken` (do NOT use `createSheetsServiceForProvider` — that's restore-path only), sync data, return `spreadsheetId` and `webViewLink` in metadata (Req 4.4, 4.6)
  - [x] 3.4 Handle independent sub-capability execution: check `providerConfig.enabled` for ZIP, `providerConfig.sheetsSyncEnabled` for Sheets. One failure doesn't block the other (Req 4.2, 4.5, 4.7)

## Phase 4: Backup Orchestrator

- [x] 4. Implement BackupOrchestrator
  - [x] 4.1 Create `sync/backup-orchestrator.ts` with `execute(userId, displayName, force)` method (Req 2)
  - [x] 4.2 Implement mutex with `Map<string, number>` and 5-min TTL. Return `{ status: 'in_progress' }` instead of throwing (Req 2.7)
  - [x] 4.3 Implement change detection: call `hasChangesSinceLastSync` when `force=false`, return `{ skipped: true }` if no changes (Req 2)
  - [x] 4.4 Load `backupConfig.providers`, filter where `enabled OR sheetsSyncEnabled` (own filter, not `loadBackupConfig` from backup.ts) (Req 2.1)
  - [x] 4.5 Implement conditional ZIP generation: generate once if any provider has `enabled=true`. If `exportAsZip` throws, set `zipBuffer=null` and continue (Req 2)
  - [x] 4.6 Decrypt each provider's credentials and pass in context (Req 7.1, 7.2)
  - [x] 4.7 Implement parallel fan-out via `Promise.allSettled` with per-strategy `withTimeout(OPERATION_TIMEOUTS.BACKUP)`. Skip providers without registered strategy (Req 2.2, 2.3, 2.4, 2.8)
  - [x] 4.8 Collect results: update `lastBackupAt`, persist `sheetsSpreadsheetId` from `capabilities.sheets.metadata.spreadsheetId` to `backupConfig` (Req 2.5)
  - [x] 4.9 Call `settingsRepository.updateSyncDate(userId)` if any provider succeeded (Req 2)
  - [x] 4.10 Return `BackupOrchestratorResult` with per-provider results keyed by provider ID. Handle empty providers case (Req 2.5, 2.6)

## Phase 5: Sync Routes Rewiring

- [x] 5. Update sync routes
  - [x] 5.1 Remove `sheets` from `validateSyncTypes` — only `backup` accepted (Req 2)
  - [x] 5.2 Remove `performSheetsSync` function and `executeSyncType` function entirely. Wire sync route handler to call `BackupOrchestrator.execute()` directly (Req 2)
  - [x] 5.3 Check orchestrator result for `status === 'in_progress'` and return 409 with `{ success: false, error: { code: 'BACKUP_IN_PROGRESS', message: 'A backup is already in progress' } }` (Req 2.7)
  - [x] 5.4 Remove `POST /restore/from-sheets` endpoint (Req 5)
  - [x] 5.5 Add `GET /restore/providers` endpoint with `syncRateLimiter` — returns `RestoreProviderInfo[]` with source type availability based on enabled flags + metadata (Req 5.6)

## Phase 5b: Dead Code Removal

- [x] 5b. Remove old backup and sync code paths
  - [x] 5b.1 Remove `performProviderBackup` method from `backup.ts` — the orchestrator replaces it. Keep `exportAsZip` and `enforceRetention` (Req 2)
  - [x] 5b.2 Remove `createSheetsServiceForUser` function from `google-sheets-service.ts` — replaced by `createSheetsServiceForProvider` (Req 7)
  - [x] 5b.3 Remove `getUserWithToken` method from `restore.ts` — replaced by `createSheetsServiceForProvider` in the new `restoreFromSheets(userId, providerId, mode)` (Req 5, 7)
  - [x] 5b.4 Remove unused imports: `createSheetsServiceForUser` from `sync/routes.ts`, `BackupSyncResult` type references where replaced by `BackupOrchestratorResult` (Req 2)

## Phase 6: Activity Tracker Changes

- [x] 6. Update activity tracker
  - [x] 6.1 Change `performAutoBackup()` to call `BackupOrchestrator.execute(userId, displayName, false)` (Req 2)
  - [x] 6.2 Remove `performAutoSheetsSync()` and `deriveSyncTypes()` (Req 2)
  - [x] 6.3 Simplify `performAutoSync()` to only call `performAutoBackup()` (Req 2)

## Phase 7: Provider Routes Duplicate Check

- [x] 7. Update provider routes duplicate prevention
  - [x] 7.1 Remove the existing `domain + providerType` uniqueness check that blocks ANY second provider of the same type (Req 1.1)
  - [x] 7.2 Implement new check: load all providers for user with same `domain + providerType`, filter for matching `config.accountEmail`. Return 409 Conflict if match found. Use transaction to narrow TOCTOU window (Req 1.6)

## Phase 8: Restore Service Changes

- [x] 8. Update restore service for unified restore
  - [x] 8.1 Add `createSheetsServiceForProvider(providerId, userId)` to `google-sheets-service.ts` — queries DB by `providerId + userId` (ownership check), decrypts credentials, returns `GoogleSheetsService` (Req 5.3, 7.2, 7.4)
  - [x] 8.2 Update `restoreFromProvider` endpoint to accept discriminated union Zod schema with `sourceType` ('zip' | 'sheets') (Req 5.1)
  - [x] 8.3 Implement ZIP restore path: route handler calls `backupService.downloadBackup(userId, providerId, fileRef)`, then `restoreService.restoreFromBackup(userId, zipBuffer, mode)` (Req 5.2)
  - [x] 8.4 Implement Sheets restore path: `restoreFromSheets(userId, providerId, mode)` — loads `backupConfig`, reads `sheetsSpreadsheetId` from `backupConfig.providers[providerId]`, calls `createSheetsServiceForProvider`, reads spreadsheet data. All in one method (Req 5.3, 5.5)
  - [x] 8.5 Add error handling for missing provider, inactive provider, and missing backup metadata for requested source type (Req 5.4, 5.5)

## Phase 9: Frontend Type Changes

- [x] 9. Update frontend types
  - [x] 9.1 Add `RestoreProviderInfo` type to `types/settings.ts` with `providerId`, `providerType`, `displayName`, `accountEmail`, `sourceTypes` (Req 5.6, 6)
  - [x] 9.2 Add `BackupOrchestratorResult`, `BackupStrategyResult`, `BackupCapabilityResult` types to `types/settings.ts` (Req 2.5)
  - [x] 9.3 Remove `'sheets'` from `executeSync` type union (Req 2)
  - [x] 9.4 Replace `BackupSyncResult` / `SyncResult` types with new `BackupOrchestratorResult` shape — per-provider results with nested capability metadata. Remove old types (Req 2.5)

## Phase 10: Frontend API + Store Changes

- [x] 10. Update frontend API layer and store
  - [x] 10.1 Update `settings-api.ts`: remove `restoreFromSheets()`, update `restoreFromProvider` with two overloads (ZIP with `fileRef`, Sheets without), add `getRestoreProviders()`, update `executeSync` type (Req 5, 6)
  - [x] 10.2 Update `settings.svelte.ts`: remove `restoreFromSheets()` store method, update `restoreFromProvider()` to accept `sourceType`, add `restoreProviders` state and `loadRestoreProviders()`, update sync result types (Req 5, 6)

## Phase 11: Frontend Component Changes

- [x] 11. Update frontend components
  - [x] 11.1 Update `ProviderCard.svelte` — show `accountEmail`, independent ZIP/Sheets toggles, per-provider backup status (Req 8.1, 8.2, 8.3, 8.5)
  - [x] 11.2 Update `StorageProviderSettings.svelte` — support multiple same-type providers, keep "Add Provider" always visible (Req 1.1, 8.1)
  - [ ] 11.3 Update `UnifiedRestoreDialog.svelte` — refactor for provider-based restore flow:
    - [x] 11.3a Refactor step state machine to support 5-step provider flow alongside existing file upload flow (Req 6)
    - [x] 11.3b Integrate `ProviderPicker` component for step 1 (pick provider) (Req 6.1)
    - [x] 11.3c Add source type selection step (step 2) — auto-advance if only one source type (Req 6.3, 6.4)
    - [x] 11.3d Wire new restore API calls with `sourceType` parameter and `idempotencyKey` (Req 5.1)
    - [x] 11.3e Implement auto-select: skip steps 1-2 when one provider + one source type (Req 6.4)
    - [ ] 11.3f Handle 409 backup-in-progress error from sync API — show appropriate toast (Req 2.7)
  - [x] 11.4 Create `ProviderPicker.svelte` — displays providers with `accountEmail`, provider type, available source types. Shows "no backups available" when empty (Req 6.1, 6.2, 6.3, 6.6)
  - [x] 11.5 Update provider settings toggle handlers to update only the targeted provider's `backupConfig` entry (Req 8.4)
  - [x] 11.6 Remove or refactor `GoogleSheetsSyncSettings.svelte` — Sheets sync config is now per-provider in `ProviderCard`, not a standalone component (Req 4, 8.3)
  - [x] 11.7 Update `BackupNowDialog.svelte` — update response handling for new `BackupOrchestratorResult` shape with nested capability metadata (Req 2.5)

## Phase 12: Update Existing Tests

- [x] 12. Update existing tests for new structure
  - [x] 12.1 Update `sync/__tests__/backup-service.property.test.ts` — update for new `BackupOrchestratorResult` types and orchestrator interface (Req 2)
  - [x] 12.2 Update `sync/__tests__/backup-api-validation.property.test.ts` — update for discriminated union `restoreFromProvider` schema with `sourceType` (Req 5)

## Phase 13: Write New Tests

- [x] 13. Write new tests
  - [x] 13.1 Test `BackupStrategyRegistry` — register, retrieve, undefined for unregistered type, overwrite (Req 3.3)
  - [x] 13.2 Test `GoogleDriveStrategy` — ZIP only, Sheets only, both enabled, partial failure, null zipBuffer, retention enforcement, direct provider instantiation (Req 4)
  - [x] 13.3 Test `BackupOrchestrator` — fan-out to multiple providers, mutex returns status not throw, TTL eviction, change detection skip, conditional ZIP, parallel with timeout, `lastBackupAt` + `sheetsSpreadsheetId` persistence, `updateSyncDate` call, empty providers, skip unregistered strategy (Req 2)
  - [x] 13.4 Test `createSheetsServiceForProvider` — correct token extraction, provider not found, missing token, ownership rejection (Req 7)
  - [x] 13.5 Test duplicate prevention — different `accountEmail` allowed, same `accountEmail` returns 409, different provider types allowed (Req 1.6)
  - [x] 13.6 Test unified restore — ZIP download+restore, Sheets via provider credentials, missing `sheetsSpreadsheetId` error, invalid provider error (Req 5)
  - [x] 13.7 Test restore provider list — `sourceTypes` derived from enabled flags + metadata, rate limited (Req 5.6)
  - [x] 13.8 Test activity tracker — calls orchestrator, no `performAutoSheetsSync` (Req 2)

## Phase 14: Validation Checkpoint

- [x] 14. Final validation
  - [x] 14.1 Run `bun run all:fix && bun run validate` in `backend/` — fix all errors and warnings
  - [x] 14.2 Run `npm run all:fix && npm run validate` in `frontend/` — fix all errors and warnings
  - [x] 14.3 Verify no broken imports, no type errors, all tests pass
