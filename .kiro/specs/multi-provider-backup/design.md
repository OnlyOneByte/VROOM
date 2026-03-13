# Multi-Provider Backup — Design Document

## Overview

This feature transforms the backup system from a single-provider-per-type model to a multi-provider architecture. Each provider independently runs its own backup strategy. The orchestrator is provider-agnostic — it iterates enabled providers and delegates to each type's registered `BackupStrategy`. For Google Drive, the strategy supports ZIP upload and Sheets sync as independently toggleable sub-capabilities. The restore flow is provider-aware with unified ZIP + Sheets source type selection.

**Breaking change.** No backward compatibility. Existing `backupConfig.providers` entries are structurally compatible but may have `sheetsSpreadsheetId` on the wrong provider entry (old code picked first `sheetsSyncEnabled` provider). Users must reconfigure backup settings and re-run Sheets sync to populate the correct provider's entry. The `restoreFromProvider` API adds `sourceType`. The `sheets` sync type is removed from `POST /api/v1/sync`. The standalone `/restore/from-sheets` endpoint is removed.

### Key Architectural Decisions

1. **Strategy pattern** — single `execute` method per provider type.
2. **Sheets sync folded into Google Drive strategy** — `performSheetsSync` removed.
3. **`createSheetsServiceForProvider(providerId, userId)`** — replaces `createSheetsServiceForUser`. Ownership validated. Used by restore path only.
4. **Duplicate prevention** — 409 on same `accountEmail + domain + providerType`. Application-level check in transaction.
5. **Backup mutex with TTL** — `Map<string, number>`. 5-minute TTL. Returns `status: 'in_progress'` (not throw) so route handler can return 409 explicitly.
6. **Unified restore** — provider ID + source type in one endpoint. Route handler downloads ZIP; RestoreService handles parsing/import. For Sheets, RestoreService calls `createSheetsServiceForProvider`.
7. **S3 placeholder** — orchestrator skips providers without registered strategy. No fallback.
8. **Conditional ZIP** — generated only if any provider has `enabled === true`. `zipBuffer: Buffer | null`.
9. **`sheets` sync type removed** — only `backup` accepted. Sheets is a sub-capability.
10. **Partial failure → 200** — `success: true` if any provider succeeded.
11. **Change detection** — `hasChangesSinceLastSync` when `force` is false. **New behavior**: orchestrator calls `updateSyncDate` after success (current `performProviderBackup` does NOT do this).
12. **Parallel fan-out** — `Promise.allSettled` with per-strategy `withTimeout`.
13. **Retention in strategy** — `GoogleDriveStrategy.executeZipUpload` enforces retention.
14. **Orchestrator decrypts** — passes `decryptedCredentials` in context. Strategies never touch encrypted data.
15. **Strategy registration at startup** — `sync/init.ts` imported in `index.ts`.
16. **Strategy instantiates provider directly** — `GoogleDriveStrategy` creates `new GoogleDriveProvider(refreshToken)` from `decryptedCredentials`. Does NOT use registry.
17. **Orchestrator persists sheetsSpreadsheetId** — extracts from strategy result metadata and writes to `backupConfig`.

---

## Folder Organization

```
backend/src/api/
  providers/
    __tests__/                        # Update import paths
    domains/storage/                  # domain: 'storage'
      storage-provider.ts            # Interface
      google-drive-provider.ts       # GoogleDriveProvider
      s3-compat-provider.ts          # S3CompatProvider
      registry.ts                    # StorageProviderRegistry
    services/                        # Google API wrappers
      google-drive-service.ts
      google-sheets-service.ts       # + createSheetsServiceForProvider(id, userId)
    backup-strategies/
      google-drive-strategy.ts       # ZIP + Sheets + retention
    routes.ts
    sync-worker.ts                   # Update import paths
  sync/
    __tests__/                       # Update existing tests
    init.ts                          # Strategy registration
    backup-strategy.ts               # Interface + types
    backup-strategy-registry.ts      # Registry
    backup-orchestrator.ts           # Fan-out, mutex, change detection
    activity-tracker.ts              # Updated to call orchestrator
    backup.ts                        # ZIP generation, export, retention
    restore.ts                       # Unified ZIP + Sheets restore
    routes.ts                        # Sync API routes
```

## Request Flows

### Backup Trigger

1. `POST /api/v1/sync` with `syncTypes: ['backup']`, optionally `force: true`
2. Route delegates to `BackupOrchestrator.execute(userId, displayName, force)`
3. Mutex check: evict stale (>5min), if in progress return `{ status: 'in_progress' }` (route handler returns 409)
4. Change detection: if `force=false`, check `hasChangesSinceLastSync`. If no changes, return `{ skipped: true }`
5. Load `backupConfig.providers`, filter where `enabled OR sheetsSyncEnabled`
6. Note: the existing `loadBackupConfig` in `backup.ts` only filters by `enabled`. The orchestrator implements its own filter that includes `sheetsSyncEnabled` providers.
6. Conditional ZIP: if any provider has `enabled=true`, generate once. If `exportAsZip` throws, set `zipBuffer=null`, log, continue Sheets-only
7. Decrypt each provider's credentials
8. Parallel fan-out via `Promise.allSettled` with per-strategy `withTimeout(OPERATION_TIMEOUTS.BACKUP)`:
   - Look up strategy in registry. Found -> `strategy.execute(context)`. Not found -> skip
9. Collect results. For each successful provider:
   - Update `lastBackupAt`
   - If `capabilities.sheets.metadata.spreadsheetId` exists, persist to `backupConfig.providers[id].sheetsSpreadsheetId`
10. Call `settingsRepository.updateSyncDate(userId)` if any succeeded
11. Release mutex
12. Return 200 with `BackupOrchestratorResult`

### Restore

1. `POST /api/v1/sync/restore/from-provider` with `{ providerId, sourceType, mode, fileRef? }`
2. Validate via discriminated union Zod schema
3. ZIP: route handler calls `backupService.downloadBackup(userId, providerId, fileRef)`, then `restoreService.restoreFromBackup(userId, zipBuffer, mode)`
4. Sheets: route handler calls `restoreService.restoreFromSheets(userId, providerId, mode)` which internally calls `createSheetsServiceForProvider(providerId, userId)` and reads `sheetsSpreadsheetId` from `backupConfig.providers[providerId]`
5. Return restore result

## Components and Interfaces

### BackupStrategy Interface (`sync/backup-strategy.ts`)

```typescript
interface BackupStrategyContext {
  userId: string;
  displayName: string;
  providerId: string;
  providerRow: UserProvider;                        // metadata only
  decryptedCredentials: Record<string, unknown>;    // orchestrator decrypts
  providerConfig: ProviderBackupSettings;
  zipBuffer: Buffer | null;
}

interface BackupCapabilityResult {
  success: boolean;
  message?: string;
  metadata?: Record<string, unknown>;  // provider-specific: fileRef, fileName, deletedOldBackups, spreadsheetId, webViewLink, etc.
}

interface BackupStrategyResult {
  success: boolean;
  message?: string;
  capabilities: Record<string, BackupCapabilityResult>;
}

interface BackupStrategy {
  execute(context: BackupStrategyContext): Promise<BackupStrategyResult>;
}
```

### BackupOrchestratorResult (`sync/backup-strategy.ts`)

```typescript
interface BackupOrchestratorResult {
  timestamp: string;
  status?: 'in_progress';   // set when mutex rejects
  skipped?: boolean;         // set when no changes detected
  results: Record<string, BackupStrategyResult>;
}
```

Replaces `BackupSyncResult`. HTTP response: `{ success: true, data: BackupOrchestratorResult }`. Route handler checks `status === 'in_progress'` and returns 409.

The 409 response uses `{ success: false, error: { code: 'BACKUP_IN_PROGRESS', message: 'A backup is already in progress' } }` — matching the standard error response format.

The frontend extracts per-provider fields from `capabilities.zip.metadata.fileRef`, `capabilities.zip.metadata.deletedOldBackups`, `capabilities.sheets.metadata.spreadsheetId`, etc. The old flat `BackupSyncResult` fields are now nested under capability metadata.

### BackupOrchestrator (`sync/backup-orchestrator.ts`)

- Mutex: `Map<string, number>` with 5-min TTL. Returns result with `status: 'in_progress'` instead of throwing
- Change detection: `hasChangesSinceLastSync` when not forced
- Conditional ZIP generation
- Parallel fan-out with `withTimeout` per strategy
- Persists `lastBackupAt` and `sheetsSpreadsheetId` from results
- Calls `updateSyncDate` after success (new behavior vs current code)

### GoogleDriveStrategy (`providers/backup-strategies/google-drive-strategy.ts`)

- ZIP upload: creates `new GoogleDriveProvider(decryptedCredentials.refreshToken)` directly (not via registry). Enforces retention after upload
- Sheets sync: creates `new GoogleSheetsService(decryptedCredentials.refreshToken)` directly. Returns `spreadsheetId` in metadata
- Each sub-capability independent: one failure doesn't block the other

### createSheetsServiceForProvider (`providers/services/google-sheets-service.ts`)

Restore-path only. Queries DB by `providerId + userId` (ownership check), decrypts credentials, returns `GoogleSheetsService`. The backup strategy does NOT use this.

### Provider Routes Duplicate Prevention

**Remove** the existing `domain + providerType` uniqueness check entirely. Replace with: load all providers for user with same `domain + providerType`, filter in code for matching `config.accountEmail`. 409 if match found. Transaction narrows TOCTOU window. The old check that blocks ANY second provider of the same type must be deleted.

**backupConfig initialization**: When a new provider is created, no `backupConfig.providers[id]` entry is created automatically. The entry is created when the user first enables backup or Sheets sync for that provider via the settings UI (which calls `PUT /api/v1/settings` with the updated `backupConfig`).

### Unified Restore Endpoint

```typescript
const restoreFromProviderSchema = z.discriminatedUnion('sourceType', [
  z.object({ sourceType: z.literal('zip'), providerId: z.string().min(1).max(64),
    fileRef: z.string().min(1).max(1024), mode: z.enum(['preview', 'replace', 'merge']) }),
  z.object({ sourceType: z.literal('sheets'), providerId: z.string().min(1).max(64),
    mode: z.enum(['preview', 'replace', 'merge']) }),
]);
```

`RestoreService.restoreFromSheets(userId, providerId, mode)` reads `backupConfig.providers[providerId].sheetsSpreadsheetId`, calls `createSheetsServiceForProvider(providerId, userId)`.

The `restoreFromSheets(userId, providerId, mode)` method: (1) loads `backupConfig` from settings, (2) reads `sheetsSpreadsheetId` from `backupConfig.providers[providerId]`, (3) calls `createSheetsServiceForProvider(providerId, userId)` to get the Sheets service with credentials, (4) reads spreadsheet data. All in one method — no split responsibility.

Remove standalone `POST /restore/from-sheets`.

### Restore Provider List (`GET /sync/restore/providers`)

Rate limited with `syncRateLimiter`.

```typescript
interface RestoreProviderInfo {
  providerId: string; providerType: string; displayName: string;
  accountEmail: string; sourceTypes: ('zip' | 'sheets')[];
}
```

Source type availability:
- `zip`: `enabled === true` AND `lastBackupAt` exists
- `sheets`: `sheetsSyncEnabled === true` AND `sheetsSpreadsheetId` exists

### Sync Routes Changes

- Remove `sheets` from `validateSyncTypes`
- Remove `performSheetsSync` function
- Wire backup to `BackupOrchestrator.execute()` — replace `executeSyncType` function entirely. It only handled 'backup' and 'sheets', and 'sheets' is removed. The sync route handler calls `BackupOrchestrator.execute()` directly.
- Check orchestrator result for `status === 'in_progress'` -> return 409
- Remove `POST /restore/from-sheets`
- Add `GET /restore/providers` with `syncRateLimiter`
- Import `sync/init.ts`

### Activity Tracker Changes

- `performAutoBackup()` -> `BackupOrchestrator.execute(userId, displayName, false)`
- Remove `performAutoSheetsSync()`, `deriveSyncTypes()`
- `performAutoSync()` only calls `performAutoBackup()`


## Frontend Changes

### API Layer

**`settings-api.ts`:**
- Remove `restoreFromSheets()`
- Update `restoreFromProvider` — now two overloads: `restoreFromProvider(providerId, 'zip', fileRef, mode, idempotencyKey)` and `restoreFromProvider(providerId, 'sheets', mode, idempotencyKey)`. The `fileRef` parameter is required for ZIP, absent for Sheets.
- Add `getRestoreProviders(): Promise<RestoreProviderInfo[]>`
- Update `executeSync` type: `(syncTypes: ('backup')[], force?) => Promise<SyncResult>` — remove `'sheets'`

**`settings.svelte.ts`:**
- Remove `restoreFromSheets()` store method
- Update `restoreFromProvider()` to accept `sourceType`
- Add `restoreProviders` state and `loadRestoreProviders()`
- Update `SyncResult` / `BackupSyncResult` types to match `BackupOrchestratorResult`

### Components

**ProviderCard** — Show `accountEmail`, independent ZIP/Sheets toggles, per-provider backup status.

**StorageProviderSettings** — Multiple same-type providers. "Add Provider" always visible.

**UnifiedRestoreDialog** — Two entry points:
- File upload (existing): upload ZIP from disk -> preview -> confirm
- Provider-based (new 5-step flow):
  1. Pick provider (ProviderPicker)
  2. Pick source type (if multiple, else auto-advance)
  3. Pick file (ZIP only)
  4. Preview
  5. Confirm

Auto-select: one provider + one source type -> skip steps 1-2.

**ProviderPicker** (new: `settings/ProviderPicker.svelte`):
```typescript
interface ProviderPickerProps {
  providers: RestoreProviderInfo[];
  onSelect: (providerId: string, sourceType: 'zip' | 'sheets') => void;
}
```

## Data Models

No new tables. No schema changes.

### TypeScript Types

**New backend** (`sync/backup-strategy.ts`):
- `BackupStrategyContext`, `BackupCapabilityResult`, `BackupStrategyResult`, `BackupStrategy`, `BackupOrchestratorResult`

**Modified restore:**
- `RestoreFromProviderRequest` — discriminated union with `sourceType`
- `RestoreProviderInfo` — includes `sourceTypes`

**Frontend** (`types/settings.ts`):
- `RestoreProviderInfo`, `BackupOrchestratorResult`, `BackupStrategyResult`, `BackupCapabilityResult`
- Remove `'sheets'` from `executeSync` type union

## Files Changed

| File | Change |
|---|---|
| `providers/routes.ts` | accountEmail-based duplicate check |
| `providers/domains/storage/` | Move storage-provider, google-drive-provider, s3-compat-provider, registry |
| `providers/services/` | Move google-drive-service, google-sheets-service; add createSheetsServiceForProvider |
| `providers/backup-strategies/google-drive-strategy.ts` | New |
| `providers/sync-worker.ts` | Update imports |
| `providers/__tests__/*.ts` | Update imports |
| `sync/init.ts` | New — strategy registration |
| `sync/backup-strategy.ts` | New — interface + types |
| `sync/backup-strategy-registry.ts` | New |
| `sync/backup-orchestrator.ts` | New |
| `sync/backup.ts` | Remove performProviderBackup; keep exportAsZip + enforceRetention |
| `sync/restore.ts` | Add sourceType; restoreFromSheets(userId, providerId, mode); remove getUserWithToken |
| `sync/routes.ts` | Wire orchestrator; remove sheets; remove /restore/from-sheets; add GET /restore/providers; import init |
| `sync/activity-tracker.ts` | Call orchestrator; remove performAutoSheetsSync, deriveSyncTypes |
| `sync/__tests__/backup-service.property.test.ts` | Update for new types/orchestrator |
| `sync/__tests__/backup-api-validation.property.test.ts` | Update for discriminated union schema |
| `index.ts` | Import sync/init.ts |
| `frontend/types/settings.ts` | Add RestoreProviderInfo, BackupOrchestratorResult, etc. |
| `frontend/services/settings-api.ts` | Remove restoreFromSheets; add sourceType; add getRestoreProviders; update executeSync type |
| `frontend/stores/settings.svelte.ts` | Remove restoreFromSheets; update types |
| `frontend/components/settings/ProviderCard.svelte` | accountEmail, toggles, status |
| `frontend/components/settings/StorageProviderSettings.svelte` | Multiple same-type |
| `frontend/components/settings/UnifiedRestoreDialog.svelte` | New restore flow |
| `frontend/components/settings/ProviderPicker.svelte` | New |

## Testing Strategy

### Unit Tests

- BackupStrategyRegistry: register, retrieve, undefined, overwrite
- GoogleDriveStrategy: ZIP only, Sheets only, both, partial failure, null zipBuffer, retention, direct provider instantiation
- BackupOrchestrator: fan-out, mutex (return status not throw), TTL eviction, change detection, conditional ZIP, parallel with timeout, lastBackupAt + sheetsSpreadsheetId persistence, updateSyncDate, empty results
- createSheetsServiceForProvider: correct token, not found, missing token, ownership rejection
- Duplicate prevention: different accountEmail OK, same accountEmail 409, different types OK
- Unified restore: ZIP download+restore, Sheets via provider credentials, missing sheetsSpreadsheetId, invalid provider
- Restore provider list: sourceTypes from enabled flags + metadata, rate limited
- Activity tracker: calls orchestrator, no performAutoSheetsSync

### Property-Based Tests

- For all (N providers, enabled/disabled, ZIP/Sheets toggles): one result per enabled provider, ZIP at most once
- For all configs: duplicate check correct
- For all Sheets restore: correct provider credentials used

### Integration Tests

- Full fan-out: 2 providers, both enabled
- Sheets-only: enabled=false, sheetsSyncEnabled=true -> no ZIP
- Restore from specific provider
- Concurrent backup -> 409 via status field
- Mutex TTL recovery
- Change detection: skip vs force
- Retention enforcement
- exportAsZip failure -> Sheets-only continues
- sheetsSpreadsheetId persisted after Sheets sync