# Google Photos Storage Provider — Requirements

> Ranked-queue item #10. Picked over #9 Sharing (which is a 10–15 day greenfield,
> cross-cutting, human-design-sign-off feature — not a single tractable increment per
> the autopilot Definition of Done). Google Photos is the most tractable next item:
> the photo infrastructure is ~80% reusable and the injectable-client + fake-provider
> test seam (TestingExternalAPIs.md) is freshly in place.

## Goal

Let a user store/back up their VROOM photos (vehicle photos, expense receipts,
insurance docs, odometer readings) in **Google Photos**, as an alternative or
secondary target to the existing Google Drive and S3 providers — selectable through
the same Settings → Storage Providers UI, with zero new UX surface.

## Context: what already exists (reuse, don't rebuild)

- `StorageProvider` interface + `StorageProviderRegistry` factory
  (`backend/src/api/providers/domains/storage/`).
- `user_providers` table with a domain-agnostic `domain`/`providerType`/`credentials`
  (encrypted) shape (`schema.ts:238`).
- Photo upload flow: `POST /photos/:entityType/:entityId` →
  `photo-service.ts` → provider `.upload()` → `photos` + `photo_refs` rows; async
  backup to secondary providers via the provider-agnostic **sync worker**.
- Google OAuth provider-connect flow (arctic) already used for Google Drive.
- The fake-provider seam (`providerType:'fake'`, `ALLOW_FAKE_STORAGE`) + the
  injectable-SDK-client pattern from `TestingExternalAPIs.md` for zero-network tests.

## The hard constraint (drives the open decisions below)

The **Google Photos Library API** is materially different from a Drive/S3 file store:

1. **Append-only for app-created media.** An app can upload media items, but as of
   the 2025 API changes an app can generally only **list/read the media items it
   itself created** (the `mediaItems.list` scope was removed; apps use
   `mediaItems.search` scoped to app-created content or the picker). Crucially, the
   API provides **no delete** of library media items.
2. **Photos/videos only.** No arbitrary file types — so **PDFs cannot be stored**
   (insurance-doc PDFs and receipt PDFs are common in VROOM today).
3. **Albums, not folders.** There is no folder hierarchy; organization is via
   albums. `list(folderPath)` has no direct analogue.
4. **`baseUrl` is short-lived.** Media `baseUrl`s expire (~60 min) and must be
   re-fetched via `mediaItems.get`, unlike a stable Drive `webViewLink`.

These collide with the current `StorageProvider` contract, which assumes full CRUD:
`delete(ref)`, `getExternalUrl(ref)`, `list(folderPath)`.

## Requirements

### R1 — Connect a Google Photos provider
A user can connect Google Photos from Settings → Storage Providers → Add Provider,
authorizing with the Google Photos OAuth scope. A `user_providers` row is created
with `domain:'storage'`, `providerType:'google-photos'`. (Reuses the existing
provider-connect OAuth flow; new scope + new `providerType`.)

### R2 — Upload photos to Google Photos
When Google Photos is the default (or a backup) provider for a photo category, an
uploaded **image** is stored in Google Photos (in a VROOM album), and a `photo_refs`
row records the created `mediaItem` id + (refreshable) URL.

### R3 — Display stored photos
VROOM can display a Google-Photos-backed image (fetch a fresh `baseUrl` on demand,
since it expires). The existing photo-display path must tolerate a provider whose
URL must be refreshed rather than stored once.

### R4 — Respect the API's capability limits gracefully
Operations the API cannot perform must fail **predictably and visibly**, not crash:
- **Delete**: see Decision D1.
- **Non-image types (PDF)**: see Decision D2.
- **list()**: see Decision D3.

### R5 — No new network in tests
All behavior is covered by tests against an in-memory fake Google Photos client
(injected via the constructor seam, per `TestingExternalAPIs.md`), plus one
explicitly-gated optional live smoke (`LIVE_GPHOTOS=1`). The default `regress.sh` /
`bun test` run hits zero real Google APIs.

### R6 — No regressions
Drive + S3 providers, the sync worker, and the Settings UI keep working unchanged;
the registry/interface change is additive.

## Open product decisions (need Angelo's sign-off before Stage 6 build)

**D1 — How should `delete()` behave?** Google Photos has no library-delete.
- (a) **No-op + mark orphaned** — `delete()` removes the VROOM `photo_refs`/`photos`
  row so it disappears from VROOM, but the media item remains in the user's Google
  Photos library (we surface a one-time notice: "Removing here won't delete it from
  Google Photos"). *Most honest to the API; recommended.*
- (b) **Throw `UnsupportedOperationError`** — refuse deletion for Photos-backed media
  (the UI hides/disables delete for those). Stricter, but worse UX.

**D2 — How to handle non-image files (PDFs)?** Photos can't store PDFs.
- (a) **Capability-gate at upload** — Google Photos only serves the image categories
  (`vehicle_photos`, `expense_receipts`, `odometer_readings`); `insurance_docs`
  (often PDF) can't select Photos as a provider. Per-file: a PDF receipt routed to a
  Photos provider falls back to error/secondary. *Recommended.*
- (b) Allow selection but **fail individual PDF uploads** with a clear message.

**D3 — What does `list(folderPath)` return?** Used by backup/restore listing.
- (a) **Search the VROOM album** (app-created items) and map to `StorageFileInfo`.
- (b) **Return `[]`** (Photos isn't a backup-ZIP target; it's a photo destination
  only) and document that ZIP backup isn't supported on Photos. *Simplest; backup
  ZIP stays Drive/S3-only — matches today's reality.*

**D4 — Interface evolution.** To keep Drive/S3 untouched while admitting a
limited-capability provider, evolve `StorageProvider` by ONE of:
- (a) **Optional capability flags** — add `readonly capabilities: { delete: boolean;
  list: boolean; arbitraryFiles: boolean }` to the interface; callers check before
  invoking. Additive, explicit, testable. *Recommended.*
- (b) A separate `PhotoSourceProvider` interface (more isolation, more plumbing).

## Out of scope (defer)
- Pulling EXISTING Google Photos in to auto-create expenses (that's ranked item #16).
- Video support.
- Album management UI (one fixed "VROOM" album is enough for v1).
