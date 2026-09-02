# Google Photos Storage Provider — Design

Implements `requirements.md`. This design assumes the **recommended** answers to the
open decisions (D1a no-op-delete, D2a image-categories-only, D3b list→[], D4a
capability flags). If Angelo picks alternates, the affected section is noted.

## Architecture (reuse the storage seam)

```
Settings UI ──connect──▶ provider OAuth (new google-photos scope)
                              │
                              ▼
   user_providers row { domain:'storage', providerType:'google-photos', credentials(enc) }
                              │
POST /photos/:type/:id ──▶ photo-service ──▶ StorageProviderRegistry.createProviderInstance(row)
                              │                         │
                              │                         └─▶ new GooglePhotosProvider(refreshToken[, client])
                              ▼
                       photos + photo_refs rows ──▶ sync worker (async backup, provider-agnostic)
```

Nothing in the photo-service or sync-worker changes except they consult the new
`capabilities` flags (D4a) before calling `delete`/`list`.

## 1. Interface evolution (D4a — capability flags)

`storage-provider.ts`: add an optional capability descriptor with a safe default so
existing providers need no edits unless they opt out.

```ts
export interface StorageCapabilities {
  delete: boolean;        // can remove a stored object from the backend
  list: boolean;          // can enumerate a folder/album
  arbitraryFiles: boolean; // can store non-image types (e.g. PDF)
}

export interface StorageProvider {
  readonly type: string;
  /** Defaults to full-CRUD when omitted (Drive/S3 don't need to declare it). */
  readonly capabilities?: StorageCapabilities;
  upload(params: UploadParams): Promise<StorageRef>;
  download(ref: StorageRef): Promise<Buffer>;
  delete(ref: StorageRef): Promise<void>;
  getExternalUrl(ref: StorageRef): Promise<string | null>;
  healthCheck(): Promise<boolean>;
  list(folderPath: string): Promise<StorageFileInfo[]>;
}

const FULL_CRUD: StorageCapabilities = { delete: true, list: true, arbitraryFiles: true };
export function capabilitiesOf(p: StorageProvider): StorageCapabilities {
  return p.capabilities ?? FULL_CRUD;
}
```

Callers that delete/list (photo-service delete path, backup-strategy listing) call
`capabilitiesOf(provider)` and branch. Drive/S3/fake stay untouched (undefined →
FULL_CRUD).

## 2. `GooglePhotosProvider` (new)

`backend/src/api/providers/domains/storage/google-photos-provider.ts`, implementing
`StorageProvider` with `capabilities = { delete: false, list: false, arbitraryFiles: false }`.

Backed by a `GooglePhotosService` (mirrors `GoogleDriveService`) that wraps the
Library API and **takes an injectable client** (`TestingExternalAPIs.md` pattern):

```ts
constructor(refreshToken: string, client?: PhotosClient) { ... }  // real OAuth2 client by default
```

Method mapping:
- **upload(params)** — 2-step Library API: (1) upload bytes → `uploadToken`;
  (2) `mediaItems:batchCreate` into the VROOM album → `mediaItem.id`. Returns
  `{ providerType:'google-photos', externalId: mediaItem.id, externalUrl: baseUrl }`.
  Resolve-or-create the "VROOM" album once (cache the album id in provider `config`).
- **download(ref)** — `mediaItems.get(id)` → fresh `baseUrl` → fetch `=d` bytes.
- **getExternalUrl(ref)** — `mediaItems.get(id)` → fresh `baseUrl` (NOT the stored
  one — it's expired). This is the key behavior R3 needs.
- **delete(ref)** — D1a: no-op (resolves). The capability flag tells callers not to
  expect backend deletion; photo-service still deletes the VROOM rows. (D1b alternate:
  `throw new UnsupportedOperationError(...)`.)
- **list()** — D3b: returns `[]`. (D3a alternate: `mediaItems.search` the album.)
- **healthCheck()** — cheap `albums.list({pageSize:1})` (true on success, false on throw).

## 3. Upload-time capability gate (D2a)

In `photo-service.ts`, before routing a file to a provider, if
`!capabilitiesOf(provider).arbitraryFiles && !isImage(mimeType)` → skip that provider
(don't create a `pending` ref for it) and, if it was the *default*, return a clear
4xx ("Google Photos stores images only — choose Drive/S3 for PDFs"). This keeps the
existing allowed-MIME set (JPEG/PNG/WebP/PDF) but prevents PDFs from being routed to
Photos. Storage-config UI can also hide Photos under `insurance_docs` (PDF-heavy).

## 4. Registry wiring

`registry.ts createProviderInstance`: add a `case 'google-photos'` that decrypts the
refresh token and returns `new GooglePhotosProvider(refreshToken)` — symmetric with
the existing `google-drive` case. No domain refactor needed (still storage domain).

## 5. OAuth scope + connect flow

Reuse the provider-connect path used for Drive; add the Photos scope
(`https://www.googleapis.com/auth/photoslibrary.appendonly` +
`...photoslibrary.readonly.appcreateddata` for reading app-created items). New
`providerType:'google-photos'` recognized by the connect handler. Credentials stored
identically (encrypted `{refreshToken}`). **ARCC note:** this touches OAuth tokens —
query ARCC before implementing the connect/credential path (Stage 6, step 1).

## 6. Frontend (compose from kit, minimal)

- `ProviderInfoCard.svelte`: add `'google-photos'` to the icon + label maps (e.g.
  `Image`/"Google Photos"). No Sheets-sync toggle (that's Drive-only). The ZIP-backup
  toggle is hidden/disabled for Photos (capabilities.list=false → not a ZIP target).
- Add-provider list includes Google Photos. Everything else (the provider card, the
  category routing) already renders generically.

## 7. Testing (per TestingExternalAPIs.md)

- `fake-google-photos-client.ts` — in-memory albums + mediaItems maps; `injectFault`
  for 401/403/429; deterministic ids; shaped like the Library API responses.
- `google-photos-service.test.ts` — upload (2-step), download (URL refresh),
  getExternalUrl returns FRESH url, healthCheck, album resolve-or-create, fault paths.
- `google-photos-provider.test.ts` — interface contract incl. `capabilities`,
  delete no-op, list → [], upload via injected service.
- `capabilities.test.ts` — `capabilitiesOf` default = FULL_CRUD; photo-service skips
  PDF routing to a no-arbitraryFiles provider.
- E2E (fake): seed a `providerType:'google-photos'`? — NOT directly (real OAuth).
  Instead the fake-provider seam already covers the photo round-trip; add a unit/HTTP
  test for the PDF-gate 4xx. One gated `LIVE_GPHOTOS=1` smoke for manual real-API check.

## 8. Migration

No schema migration required — `user_providers` already stores arbitrary
`providerType`/`credentials`/`config`. (The album-id cache lives in the existing
`config` JSON column.)

## Risk / sequencing
LOW–MEDIUM. The provider class + service + fake are the only substantial new code;
everything else is additive flags + a registry case + two icon-map entries. Build
order: interface flags → service+fake+tests → provider+tests → registry case →
OAuth scope (ARCC first) → FE icon/label → capability gate → verify.
