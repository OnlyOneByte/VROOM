# Implementation Tasks: Photo Provider Abstraction

## Phase 1 — Introduce Abstraction (Google Drive Only)

### Task 1: Credential encryption utility
- [x] Create `backend/src/utils/encryption.ts` with `encrypt(plaintext: string): string` and `decrypt(ciphertext: string): string` using AES-256-GCM.
- [x] Read encryption key from `process.env.PROVIDER_ENCRYPTION_KEY`.
- [x] Add `PROVIDER_ENCRYPTION_KEY` to `backend/.env.example` with a placeholder value and generation instructions (e.g., `openssl rand -hex 32`).
- [x] Add `PROVIDER_ENCRYPTION_KEY` to `backend/.env` with a generated value for local dev.
- [x] Write unit tests: encrypt/decrypt round-trip, wrong key throws, tampered ciphertext throws, empty string handling.

### Task 2: Database schema — `user_providers` table and `storage_config` column
- [x] Define `StorageConfig`, `CategorySetting`, `PhotoCategory`, and `DEFAULT_STORAGE_CONFIG` types in `backend/src/types.ts` (or new `backend/src/api/providers/types.ts`).
- [x] Add `userProviders` table to `backend/src/db/schema.ts` with columns: `id` (text PK, cuid), `userId` (text FK → users, cascade), `domain` (text NOT NULL), `providerType` (text NOT NULL), `displayName` (text NOT NULL), `credentials` (text NOT NULL), `config` (text, JSON mode), `status` (text NOT NULL, default 'active'), `lastSyncAt` (integer timestamp), `createdAt` (integer timestamp), `updatedAt` (integer timestamp). Composite index on `(userId, domain)`.
- [x] Add `storageConfig` JSON column to `userSettings` table: `text('storage_config', { mode: 'json' }).$type<StorageConfig>().default(DEFAULT_STORAGE_CONFIG)`.
- [x] Export `UserProvider`, `NewUserProvider` types from schema.
- [x] Run `bun run db:generate` to create migration.
- [x] Write migration test (`migration-0006.test.ts`): verify `user_providers` table created with correct columns, `storage_config` column exists on `user_settings` with default value, seed data survives.
- [x] Update `migration-general.test.ts` expected tables list to include `user_providers`.

### Task 3: Database schema — `photo_refs` table and `photos` table migration
- [x] Add `photoRefs` table to `backend/src/db/schema.ts`: `id` (text PK, cuid), `photoId` (text FK → photos, cascade), `providerId` (text FK → userProviders, cascade), `storageRef` (text NOT NULL), `externalUrl` (text), `status` (text NOT NULL, default 'pending'), `errorMessage` (text), `retryCount` (integer NOT NULL, default 0), `syncedAt` (integer timestamp), `createdAt` (integer timestamp). Unique index on `(photoId, providerId)`, partial index on `status` WHERE `IN ('pending', 'failed')`.
- [x] Remove `driveFileId` and `webViewLink` columns from `photos` table in schema.
- [x] Export `PhotoRef`, `NewPhotoRef` types from schema.
- [x] Run `bun run db:generate`. Review the generated SQL carefully — SQLite doesn't support `DROP COLUMN` natively so Drizzle will recreate the `photos` table. Verify the migration: (1) creates `photo_refs`, (2) recreates `photos` without the removed columns, (3) preserves all existing photo data.
- [x] Note: `photo_refs` rows are NOT populated in this migration — that happens in Task 4 (data migration) because `user_providers` rows must exist first for the FK.
- [x] Write migration test: verify `photo_refs` table exists with correct columns/indexes, `photos` table no longer has `drive_file_id`/`web_view_link`, existing photo metadata (id, entity_type, entity_id, file_name, etc.) survives the table recreation.
- [x] Update backup/restore/sync pipeline per DatabaseMigrations SOP:
  - `backend/src/config.ts`: add `photo_refs` to `TABLE_SCHEMA_MAP` and `TABLE_FILENAME_MAP`. Add to `OPTIONAL_BACKUP_FILES` (absent in older backups).
  - `backend/src/types.ts`: add `photoRefs` field to `BackupData` and `ParsedBackupData`.
  - `backend/src/api/sync/backup.ts`: export `photo_refs` in `createBackup()`, add CSV columns in `exportAsZip()`, add to `validateReferentialIntegrity()` (photoId → photos, providerId → user_providers).
  - `backend/src/api/sync/restore.ts`: insert `photo_refs` in `insertBackupData()`, delete in `deleteUserData()`, update `ImportSummary`.
  - `backend/src/api/sync/google-sheets.ts`: add headers, sheet, export, and read for `photo_refs`.
  - Remove `drive_file_id` and `web_view_link` from the `photos` backup/restore/sheets columns.

### Task 4: Data migration — auto-create Google Drive providers and backfill `photo_refs`
- [x] This should be a separate migration (or startup hook) that runs after Tasks 2 and 3 migrations.
- [x] For each user with a non-null `googleRefreshToken`:
  1. Create a `user_providers` row: domain `'storage'`, providerType `'google-drive'`, displayName `'Google Drive'`, credentials = `encrypt({ refreshToken })`, config = `'{"rootPath":"/VROOM"}'`, status `'active'`.
  2. Update the user's `user_settings.storage_config`: set `defaults.vehicle_photos`, `defaults.expense_receipts`, `defaults.insurance_docs` all to the new provider ID. Add `providerCategories[providerId]` with `{ vehicle_photos: { enabled: true, folderPath: "/Vehicle Photos" }, expense_receipts: { enabled: true, folderPath: "/Receipts" }, insurance_docs: { enabled: true, folderPath: "/Insurance" } }`.
- [x] For each existing photo (from the old `photos` data), create a `photo_refs` row: `photoId` = photo ID, `providerId` = the auto-created provider for that photo's owner (join through entity ownership), `storageRef` = the old `drive_file_id` value (preserved in a temp column or read from backup), `externalUrl` = old `web_view_link`, status = `'active'`, `syncedAt` = now.
- [x] Important: the old `drive_file_id` values need to be available for this migration. Options: (a) run Task 4 migration before Task 3 migration drops the columns (reorder), (b) Task 3 migration copies data to a temp table before dropping, (c) combine Tasks 3+4 into a single migration. Decide based on what Drizzle generates.
- [x] Write migration test: verify provider rows created for users with tokens, `storage_config` populated correctly, `photo_refs` rows created with correct `storage_ref` values matching old `drive_file_id`.

### Task 5: `StorageProvider` interface and `GoogleDriveProvider`
- [x] Create `backend/src/api/providers/storage-provider.ts` with:
  - `StorageProvider` interface: `type` (readonly string), `upload(params)`, `download(ref)`, `delete(ref)`, `getExternalUrl(ref)`, `healthCheck()`.
  - `StorageRef` interface: `providerType`, `externalId`, `externalUrl?`.
  - `PhotoCategory` type: `'vehicle_photos' | 'expense_receipts' | 'insurance_docs'`.
  - `ENTITY_TO_CATEGORY` mapping: `{ vehicle: 'vehicle_photos', expense: 'expense_receipts', insurance_policy: 'insurance_docs' }`.
- [x] Create `backend/src/api/providers/google-drive-provider.ts` implementing `StorageProvider`:
  - Constructor takes decrypted `refreshToken` and creates a `GoogleDriveService` instance.
  - `upload()`: resolve folder from `pathHint` using existing `resolveEntityDriveFolder` logic (moved here from `helpers.ts`), then call `driveService.uploadFile()`. Return `StorageRef` with `externalId = driveFile.id`, `externalUrl = driveFile.webViewLink`.
  - `download()`: call `driveService.downloadFile(ref.externalId)`.
  - `delete()`: call `driveService.deleteFile(ref.externalId)`.
  - `getExternalUrl()`: return `ref.externalUrl` or null.
  - `healthCheck()`: attempt `driveService.findFolder('test-health-check')` or similar lightweight call, return true/false.
- [x] Remove `resolveEntityDriveFolder` from `backend/src/api/photos/helpers.ts` (moved into provider). Keep `validateEntityOwnership` — it's still used.
- [x] Write unit tests mocking `GoogleDriveService`.

### Task 6: `StorageProviderRegistry`
- [x] Create `backend/src/api/providers/registry.ts` with `StorageProviderRegistry` class.
- [x] `getDefaultProvider(userId, category)`:
  1. Load `user_settings` for user → parse `storageConfig.defaults[category]` → get provider ID.
  2. If null, throw `ValidationError('No storage provider configured for this photo category')`.
  3. Load `user_providers` row by ID → verify it belongs to user and status is `'active'`.
  4. Resolve folder path: `provider.config.rootPath + storageConfig.providerCategories[providerId][category].folderPath`.
  5. Return `{ provider: instance, providerId, folderPath }`.
- [x] `getBackupProviders(userId, category)`:
  1. Load `storageConfig.providerCategories` → filter entries where `[category].enabled === true`.
  2. Exclude the default provider ID for this category.
  3. Load each `user_providers` row, instantiate, resolve folder path.
  4. Return array of `ResolvedProvider`.
- [x] `getProvider(providerId)`: load row, decrypt, instantiate. Used for reads from `photo_refs`.
- [x] `getProvidersByDomain(userId, domain)`: `SELECT * FROM user_providers WHERE user_id = ? AND domain = ?`. For settings UI.
- [x] `createProviderInstance(row)`: decrypt `row.credentials`, switch on `row.providerType` to instantiate `GoogleDriveProvider` (Phase 1), `S3CompatProvider` (Phase 2), etc. Throw `ValidationError` for unknown types.
- [x] Export singleton created with `getDb()`.
- [x] Write unit tests with mocked DB and encryption.

### Task 7: `PhotoRefRepository`
- [x] Create `backend/src/api/photos/photo-ref-repository.ts` with `PhotoRefRepository` class.
- [x] `findActiveByPhotoAndProvider(photoId, providerId)`: SELECT WHERE photo_id AND provider_id AND status = 'active'. Returns `PhotoRef | null`.
- [x] `findActiveByPhoto(photoId)`: SELECT WHERE photo_id AND status = 'active' ORDER BY synced_at DESC LIMIT 1. Returns `PhotoRef | null`. (Fallback — any active ref.)
- [x] `create(data: NewPhotoRef)`: INSERT RETURNING.
- [x] `updateStatus(id, status, storageRef?, externalUrl?, errorMessage?)`: UPDATE with optional fields.
- [x] `findPendingOrFailed(limit)`: SELECT WHERE status IN ('pending', 'failed') AND retry_count < 3 ORDER BY created_at ASC LIMIT ?. For sync worker.
- [x] `countByProviderAndCategory(providerId, entityTypes[])`: COUNT of active refs joined with photos on entityType. For sync progress display.
- [x] `deleteByProvider(providerId)`: DELETE WHERE provider_id = ?. For provider deletion cleanup.
- [x] `deleteByPhoto(photoId)`: DELETE WHERE photo_id = ?. For photo deletion.
- [x] Export singleton created with `getDb()`.
- [x] Write unit tests.

### Task 8: Refactor `photo-service.ts` — upload path
- [x] Import `StorageProviderRegistry` and `PhotoRefRepository`.
- [x] In `uploadPhotoForEntity()`:
  1. Remove `folderName` parameter from signature.
  2. Replace `getDriveServiceForUser()` + `resolveEntityDriveFolder()` + `driveService.uploadFile()` with: `const category = ENTITY_TO_CATEGORY[entityType]` → `registry.getDefaultProvider(userId, category)` → `provider.upload({ fileName, buffer, mimeType, entityType, entityId, pathHint: folderPath })`.
  3. Insert `photos` row with metadata only (no `driveFileId`, no `webViewLink`).
  4. Insert `photo_refs` row: `{ photoId, providerId, storageRef: ref.externalId, externalUrl: ref.externalUrl, status: 'active', syncedAt: new Date() }`.
  5. Auto-set cover logic stays the same (operates on `photos` table only).
- [x] Update callers:
  - `backend/src/api/vehicles/photo-routes.ts`: remove `settingsRepository.getOrCreate()` and `resolveVroomFolderName()` calls, just pass `entityType, entityId, userId, file` to `uploadPhotoForEntity()`.
  - `backend/src/api/photos/routes.ts`: same simplification.
- [x] Remove unused imports (`getDriveServiceForUser`, `resolveEntityDriveFolder`, `resolveVroomFolderName`, `settingsRepository` from photo routes).

### Task 9: Refactor `photo-service.ts` — read path (fallback chain)
- [x] In `getPhotoThumbnailForEntity()`:
  1. After ownership validation and photo lookup, resolve `category = ENTITY_TO_CATEGORY[entityType]`.
  2. Get default provider ID: `registry.getDefaultProvider(userId, category).providerId`.
  3. Try: `photoRefRepo.findActiveByPhotoAndProvider(photoId, defaultProviderId)`.
  4. If null (not on default), fallback: `photoRefRepo.findActiveByPhoto(photoId)`.
  5. If still null, throw `NotFoundError('Photo')`.
  6. Get provider instance: `registry.getProvider(ref.providerId)`.
  7. Download: `provider.download({ providerType: provider.type, externalId: ref.storageRef })`.
  8. Return `{ buffer, mimeType: photo.mimeType }`.
- [x] In `listPhotosForEntity()`: no change needed — it returns `Photo[]` which is now purely metadata. The frontend builds thumbnail URLs from photo IDs, not from `driveFileId`.
- [x] Verify `setCoverPhotoForEntity()` needs no changes — it only updates `photos.isCover`, no provider interaction.

### Task 10: Refactor `photo-service.ts` — delete path
- [x] In `deletePhotoForEntity()`:
  1. After ownership validation and photo lookup, find all `photo_refs` for this photo.
  2. For each ref with status `'active'`: get provider via `registry.getProvider(ref.providerId)`, call `provider.delete({ providerType, externalId: ref.storageRef })` — wrap in try/catch, log warning on failure (best-effort, same as current behavior).
  3. Delete all `photo_refs` rows: `photoRefRepo.deleteByPhoto(photoId)`.
  4. Delete the `photos` row.
  5. Cover photo promotion logic stays the same.
- [x] In `deleteAllPhotosForEntity()`:
  1. Find all photos for entity.
  2. For each photo, find all active `photo_refs`, attempt provider-side delete (best-effort).
  3. Bulk delete `photo_refs` by photo IDs, then bulk delete `photos`.

### Task 11: Provider CRUD API routes
- [x] Create `backend/src/api/providers/routes.ts` with Hono router.
- [x] Apply `requireAuth` and `changeTracker` middleware via `routes.use('*', ...)`.
- [x] Define Zod schemas:
  - `createProviderSchema`: `{ domain: z.string(), providerType: z.string(), displayName: z.string().min(1).max(100), credentials: z.record(z.unknown()), config: z.record(z.unknown()).optional() }`.
  - `updateProviderSchema`: `{ displayName: z.string().min(1).max(100).optional(), credentials: z.record(z.unknown()).optional(), config: z.record(z.unknown()).optional() }`.
- [x] `GET /api/v1/providers` — query param `domain` (optional). List providers for authenticated user filtered by domain. Map rows to response shape: strip `credentials`, include `config`, `status`, `displayName`, etc. Return `{ success: true, data: [...] }`.
- [x] `POST /api/v1/providers` — validate body with `createProviderSchema`. Encrypt `credentials` via `encrypt()`. Insert `user_providers` row. If `domain === 'storage'`, auto-populate `storage_config.providerCategories[newId]` in user settings with default folder paths for all categories (enabled, default paths per provider type). Return 201.
- [x] `PUT /api/v1/providers/:id` — validate body with `updateProviderSchema`. Ownership check: verify provider belongs to `user.id`. If `credentials` provided, encrypt. Update row. Return 200.
- [x] `DELETE /api/v1/providers/:id` — ownership check. If `domain === 'storage'`: remove from `storage_config.providerCategories`, null out any `defaults` pointing to this ID, delete `photo_refs` for this provider (best-effort provider-side deletes for active refs). Delete `user_providers` row. Return 204.
- [x] `POST /api/v1/providers/:id/test` — ownership check. Instantiate provider via registry, call `healthCheck()`. Return `{ success: true, data: { healthy: boolean } }`.
- [x] Add rate limiting config in `CONFIG.rateLimit` for provider routes.
- [x] Mount at `/api/v1/providers` in `backend/src/index.ts`.

### Task 12: Update settings API for `storageConfig`
- [x] In the settings Zod update schema, add `storageConfig` as an optional field with nested validation:
  - `defaults`: record of `PhotoCategory` → `string | null`.
  - `providerCategories`: record of string → record of `PhotoCategory` → `{ enabled: boolean, folderPath: string }`.
- [x] In the PUT handler, when `storageConfig` is provided:
  - Validate that all provider IDs in `defaults` (non-null values) exist in `user_providers` and belong to the user.
  - Validate that all provider IDs in `providerCategories` keys exist and belong to the user.
  - Validate that a provider set as default for a category has that category enabled in `providerCategories`.
- [x] Ensure `GET /api/v1/settings` returns `storageConfig` in the response (it will automatically if the column is in the schema).

### Task 13: Frontend types and API service
- [x] Update `Photo` interface in `frontend/src/lib/types.ts`: remove `driveFileId` and `webViewLink` fields.
- [x] Add new types to `frontend/src/lib/types.ts`:
  - `PhotoRef`: `{ id, photoId, providerId, storageRef, externalUrl?, status, syncedAt? }`.
  - `UserProviderInfo`: `{ id, domain, providerType, displayName, status, config: Record<string, unknown>, lastSyncAt?, createdAt }`.
  - `StorageConfig`: `{ defaults: Record<PhotoCategory, string | null>, providerCategories: Record<string, Record<PhotoCategory, CategorySetting>> }`.
  - `CategorySetting`: `{ enabled: boolean, folderPath: string }`.
  - `PhotoCategory`: `'vehicle_photos' | 'expense_receipts' | 'insurance_docs'`.
- [x] Create `frontend/src/lib/services/provider-api.ts`:
  - `getProviders(domain?: string)`: GET `/api/v1/providers?domain=X`.
  - `createProvider(data)`: POST `/api/v1/providers`.
  - `updateProvider(id, data)`: PUT `/api/v1/providers/:id`.
  - `deleteProvider(id)`: DELETE `/api/v1/providers/:id`.
  - `testProvider(id)`: POST `/api/v1/providers/:id/test`.
- [x] Update `settingsApi` (or settings store) to handle `storageConfig` in get/update responses.
- [x] Audit and fix all frontend files referencing `photo.driveFileId` or `photo.webViewLink`:
  - `frontend/src/lib/components/vehicles/VehiclePhotoCarousel.svelte` — check if it uses `webViewLink` for "open in Drive" links.
  - `frontend/src/lib/services/vehicle-api.ts` — photo methods (should be fine, they use URL patterns not photo fields).
  - `frontend/src/lib/services/expense-api.ts` — photo methods (same).
  - Any component that renders a direct Drive link from `photo.webViewLink`.

### Task 14: Settings UI — Default Photo Sources
- [x] Create `frontend/src/lib/components/settings/DefaultPhotoSources.svelte`.
- [x] Props: `storageConfig: StorageConfig`, `providers: UserProviderInfo[]`, `onUpdate: (config: StorageConfig) => void`.
- [x] Render one `Select` dropdown per photo category with human-readable labels ("Vehicle Photos", "Expense Receipts", "Insurance Docs").
- [x] Each dropdown lists providers where `storageConfig.providerCategories[providerId][category].enabled === true`. Show provider `displayName` + `providerType` icon.
- [x] "Not configured" option when no providers have the category enabled, or as a way to clear the default.
- [x] On change: before updating, check sync gap — call an API to count photos in that category without an active `photo_refs` on the new provider. If gap > 0, show confirmation dialog: "{N} of {total} photos haven't synced to {name} yet. Switch anyway?"
- [x] On confirm, call `onUpdate` with the modified `storageConfig.defaults`.
- [x] Use shadcn `Select`, `Card`, and `AlertDialog` components.

### Task 15: Settings UI — Provider List and Cards
- [x] Create `frontend/src/lib/components/settings/PhotoStorageSettings.svelte` — main container. Loads providers via `providerApi.getProviders('storage')` and settings via `settingsApi`. Renders `DefaultPhotoSources` + provider list.
- [x] Create `frontend/src/lib/components/settings/ProviderCard.svelte`:
  - Props: `provider: UserProviderInfo`, `categorySettings: Record<PhotoCategory, CategorySetting>`, `onEdit`, `onDelete`.
  - Expandable card (shadcn `Collapsible` or `Accordion`) showing: provider icon (by type), display name, status badge (`Badge` component), last sync time, edit/delete buttons.
  - Expanded section shows: provider-specific info (account email for Google Drive, endpoint/bucket for S3) + `ProviderFolderSettings`.
- [x] Create `frontend/src/lib/components/settings/ProviderFolderSettings.svelte`:
  - Props: `provider: UserProviderInfo`, `categorySettings: Record<PhotoCategory, CategorySetting>`, `onUpdate`.
  - Root path input (reads/writes `provider.config.rootPath` via provider update API).
  - "Enable All / Disable All" toggle (convenience, updates all category `enabled` flags).
  - Per-category row: `Checkbox` (enabled) + `Input` (folder path). Three rows for the three categories.
  - On change, call `onUpdate` which saves to `storageConfig.providerCategories` via settings API.
- [x] Sync progress per category on each card: "{active refs}/{total photos} synced". Requires an API endpoint (see Task 23) or can be computed client-side if photo counts are available.

### Task 16: Settings UI — Add Provider Dialog
- [x] Create `frontend/src/lib/components/settings/AddProviderDialog.svelte`:
  - Uses shadcn `Dialog` or `Sheet`.
  - Step 1: Provider type selector — card-style radio group with icons for Google Drive, S3/B2/R2. (OneDrive/Dropbox shown as "Coming soon" disabled cards.)
  - Step 2: Display name input.
  - Step 3: Dynamic provider-specific form based on selected type.
  - Step 4: Folder settings (if provider type supports it).
  - "Test Connection" button: calls `providerApi.testProvider()` after creating (or use a temporary test endpoint).
  - "Cancel" / "Save" buttons.
- [x] Create `frontend/src/lib/components/settings/S3ProviderForm.svelte`:
  - Fields: endpoint, bucket, region, access key ID, secret access key.
  - Access key and secret key use `type="password"` inputs.
  - Zod validation on the form fields.
- [x] Create `frontend/src/lib/components/settings/GoogleDriveProviderForm.svelte`:
  - For Phase 1: "Connect Google Account" button that initiates OAuth flow (reuse existing Google auth redirect or create a separate one with Drive-only scopes).
  - Show connected account email after successful OAuth.
- [x] Folder settings section: reuse `ProviderFolderSettings.svelte` in create mode (with defaults pre-populated based on provider type).

### Task 17: Integrate Photo Storage Settings into settings page
- [x] Add `PhotoStorageSettings.svelte` as a new section/tab on the existing `/settings` page.
- [x] If no storage providers are configured, show a prominent setup prompt: "Set up photo storage to see photos in the app" with a CTA to add a provider.
- [x] Ensure the settings page loads provider data and storage config on mount.

### Task 18: Validate Phase 1
- [x] Run `bun run all:fix && bun run validate` in `backend/`.
- [x] Run `npm run all:fix && npm run validate` in `frontend/`.
- [x] Fix all errors and warnings.

## Phase 2 — S3-Compatible Provider

### Task 19: `S3CompatProvider` implementation
- [x] Install `@aws-sdk/client-s3` in `backend/`.
- [x] Create `backend/src/api/providers/s3-compat-provider.ts` implementing `StorageProvider`:
  - Constructor takes decrypted credentials (`accessKeyId`, `secretAccessKey`) and config (`endpoint`, `bucket`, `region`). Creates `S3Client` with custom endpoint.
  - `upload()`: `PutObjectCommand` with key = `{pathHint}/{entityType}/{entityId}/{fileName}`. Return `StorageRef` with `externalId` = the S3 key.
  - `download()`: `GetObjectCommand`, stream body to Buffer.
  - `delete()`: `DeleteObjectCommand`.
  - `getExternalUrl()`: generate presigned URL via `@aws-sdk/s3-request-presigner` (or return null).
  - `healthCheck()`: `HeadBucketCommand` — returns true if bucket accessible, false otherwise.
- [x] Register `'s3'` in `StorageProviderRegistry.createProviderInstance()` factory switch.
- [x] Write unit tests with mocked S3 client.

### Task 20: Validate Phase 2
- [x] Run validate in both `backend/` and `frontend/`.

## Phase 3 — Multi-Provider Fan-Out

### Task 21: Background sync worker
- [x] Create `backend/src/api/providers/sync-worker.ts`.
- [x] `startSyncWorker()`: `setInterval` at 30-second intervals, guarded by a config flag (`CONFIG.syncWorker.enabled`).
- [x] Each poll cycle:
  1. Query `photoRefRepo.findPendingOrFailed(batchSize)` — process one batch at a time (e.g., 10 refs per cycle) to avoid long-running cycles.
  2. For each ref: set status to `'pending'` (claim it — prevents duplicate processing if poll overlaps). Find any active `photo_refs` for the same `photo_id`. If none, skip (orphaned pending ref). Download buffer from the active ref's provider. Resolve target provider's folder path from `storage_config`. Upload to target provider. Update ref: `status = 'active'`, `storageRef = newRef`, `syncedAt = now`.
  3. On failure: increment `retry_count`, set `errorMessage`, keep status as `'failed'`. Skip if `retry_count >= 3`.
- [x] Exponential backoff: don't re-process failed refs until `lastAttemptAt + (30 * 2^retryCount)` seconds have passed.
- [x] `stopSyncWorker()`: `clearInterval` for graceful shutdown.
- [x] Call `startSyncWorker()` in app startup (after DB migrations).
- [x] Write unit tests with mocked providers and DB.

### Task 22: Fan-out on upload
- [x] In `photo-service.ts` `uploadPhotoForEntity()`, after inserting the active `photo_refs` row for the default provider:
  1. Call `registry.getBackupProviders(userId, category)`.
  2. For each backup provider, insert a `photo_refs` row with `status = 'pending'`, `storageRef = ''` (placeholder — will be filled by sync worker).
- [x] The sync worker (Task 21) picks these up automatically.

### Task 23: "Sync all existing photos" backfill + sync progress API
- [x] Add `POST /api/v1/providers/:id/backfill` endpoint:
  1. Ownership check.
  2. Load `storage_config` for user, get enabled categories for this provider.
  3. For each enabled category: find photos (by entityType) that don't have a `photo_refs` row for this provider → create `pending` rows.
  4. Return `{ success: true, data: { created: number } }`.
- [x] Add `GET /api/v1/providers/:id/sync-status` endpoint:
  1. Ownership check.
  2. For each photo category: count total photos in category (by entityType), count active `photo_refs` for this provider in that category, count failed refs.
  3. Return `{ success: true, data: { vehicle_photos: { total, synced, failed }, ... } }`.
- [x] Wire backfill to "Sync all existing photos" button on `ProviderCard.svelte`.
- [x] Wire sync-status to the per-category progress display on `ProviderCard.svelte`.

### Task 24: Validate Phase 3
- [ ] Run validate in both `backend/` and `frontend/`.
