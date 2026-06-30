# Photos → Auto-Add Expenses — Design

> DRAFT (2026-06-30), paired with `requirements.md`. Backend-first per CLAUDE.md (provider read-capability
> → stage endpoint → frontend review tail). **Nothing that depends on a fork (D1–D5) or the ARCC-gated
> OAuth scope builds until ruled;** the SPEC + the fork-free read-capability plumbing is greenlit-to-spec.
>
> Grounded against the live code (2026-06-30, scout-verified):
> - `backend/src/api/providers/services/google-photos-service.ts` — `PhotosClient` has `uploadBytes`,
>   `batchCreate`, `getMediaItem`, `downloadMediaItem`, `listAlbums`, `createAlbum`. `GooglePhotosService`
>   exposes `uploadImage` / `getFreshUrl(mediaItemId)` / `download(mediaItemId)` / `resolveAlbumId()` /
>   `healthCheck()`. **GAP: no `searchMediaItems` yet** — R1 adds it (the `mediaItems:search` Library API).
> - `backend/src/api/providers/domains/storage/google-photos-provider.ts` — `capabilities = { delete:false,
>   list:false, arbitraryFiles:false }`; `list()` is stubbed `[]` (D3b — not a backup target). The new
>   read is a SEPARATE capability (`searchMediaItems`), not the backup-`list`.
> - `backend/src/api/providers/domains/vlm/{registry,prompt,vlm-provider}.ts` — `getVlmProvider(row)
>   .extractReceipt({data: Buffer, mimeType})` → raw; `parseExtraction(raw)` → fail-closed `ReceiptDraft`
>   `{ amount?, date?, odometer?, category?, vendor? }` (dollars). The SHIPPED seam — reused verbatim.
> - `backend/src/api/expenses/repository.ts` — `createIdempotent(data, overwrite)` keyed on the
>   `(userId, clientId)` unique partial index (race-safe). The dedup mechanism — reused verbatim.
> - `backend/src/api/photos/photo-ref-repository.ts` + `expense_receipts` — the existing expense↔photo
>   link; the "already imported" cross-ref (a media item whose externalId backs an expense's receipt).
> - `auth/routes.ts:726` — the provider-connect OAuth scope list (Drive + openid/profile/email today). D2
>   adds the Photos read scope here (ARCC-gated, the google-photos-provider spec's pending Stage-6 step).

## §0 — The one-line architecture
Reuse, don't reinvent: add ONE read capability to the existing Photos provider (`searchMediaItems` over
app-created data), then a stage endpoint that walks those media items, downloads each (existing seam),
parses it through the user's VLM (the shipped fail-closed seam), and returns a LIST of drafts —
PERSISTING NOTHING. The FE reviews + confirms each; confirmed drafts ride the UNCHANGED `POST /expenses`
with a photo-id-derived `clientId` (the shipped idempotency). **No new table. No auto-write. App-created
photos only.**

## §1 — The Photos read capability (R1, fork-free once the scope exists)
Add to `PhotosClient` + `GooglePhotosService`:
```ts
// PhotosClient (the injectable seam — a zero-network fake in tests):
searchMediaItems(pageToken?: string): Promise<{ items: PhotosMediaItem[]; nextPageToken?: string }>;
// GooglePhotosService:
async listReceiptPhotos(maxItems: number): Promise<PhotosMediaItem[]>  // paginates search, bounded by D4 cap
```
- Calls `POST /v1/mediaItems:search` scoped to VROOM's app-created data (the album from `resolveAlbumId`).
  The `photoslibrary.readonly.appcreateddata` scope returns ONLY VROOM-uploaded items — the platform
  guarantee that backs the R7 "narrowest scope" claim.
- `GooglePhotosProvider` gains a `searchMediaItems` capability flag (distinct from the backup-`list:false`).
- Pure transport; bounded paging (stop at the D4 cap). Tested via the `PhotosClient` fake (no network).

## §2 — The stage endpoint (R2, PERSISTS NOTHING)
```
GET /api/v1/photos/receipt-drafts   (or POST — read-only either way; GET keeps it cacheable-free)
  → requireAuth + rate-limit
  → resolve the user's enabled domain:'storage' google-photos provider (none/no-scope → actionable 400)
  → resolve the user's enabled domain:'vlm' provider (none → the same 400 the parse route returns)
  → service.listReceiptPhotos(MAX_ITEMS)                          // R1, bounded D4
  → filter OUT media items already linked to an expense (the photo-ref cross-ref, D3/R5)
  → for each remaining item (bounded): download bytes → getVlmProvider().extractReceipt → parseExtraction
  → return { drafts: [{ photoId, draft, thumbnailUrl }] }          // PERSIST NOTHING
```
- Errors honest (the #43/#44/#144 lesson): a Photos transport failure → 502; a VLM failure on ONE item →
  that item gets an empty draft (the user fills it) rather than failing the whole batch; no provider → 400.
- `thumbnailUrl` via the existing `getFreshUrl` (Photos baseUrls expire ~60min — fetched fresh for the UI).
- Each parse is the SHIPPED fail-closed path — the untrusted-output discipline already lives in prompt.ts.

## §3 — Confirm → idempotent create (R4/R5, reuses the shipped path)
The FE confirms each reviewed draft via the UNCHANGED `POST /expenses` (per draft), with:
```ts
{ ...draftMappedToCreateBody, vehicleId: <user-picked>, clientId: `photos:${mediaItemId}` }
```
- `createIdempotent` makes a re-import a no-op on the `(userId, clientId)` unique index — re-running the
  sweep + re-confirming the same photo never doubles an expense (R5).
- The photo links to the created expense via the EXISTING `expense_receipts` flow (the same mechanism the
  VLM "Scan receipt" confirm uses) — so a Photos-imported expense is indistinguishable from a scanned one.
- Money stays DOLLARS through the draft; cents convert only at the create boundary (money-cents-migration).

## §4 — Frontend (eyes-on tail, R9 — live-Photos/VLM + Playwright-blocked → "code-complete, eyes-on pending")
- `photos-import-api.ts` client: `getReceiptDrafts() → [{ photoId, draft, thumbnailUrl }]` + reuses
  `expenseApi.createExpense` per confirmed draft (with the `clientId`).
- An "Import from Photos" entry (settings storage card OR the expenses page header). On click → the sweep
  (loading) → a review CHECKLIST: each row = the photo thumbnail + the editable draft fields + a vehicle
  picker + a checkbox. Already-imported photos are greyed/excluded (R5). A batch "Add N expenses" action
  fires N idempotent creates + reports the count. Four-states: loading / error (retry) / empty ("no new
  receipts in your VROOM Photos album") / data (the checklist).
- Disclosure (R7/D1): the entry states plainly it reads only the receipts VROOM uploaded to Photos, not
  the camera roll.
- e2e: with a MOCKED Photos provider (the `PhotosClient` fake) + a MOCKED VLM (stubbed adapter fetch),
  drive sweep → review → confirm → assert N expenses + their photo links; the live legs stay eyes-on-pending.

## §5 — OAuth scope expansion (D2, ARCC-GATED — does not ship until §7 clears)
Add `https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata` to the provider-connect scope
list (`auth/routes.ts:726`, the google-photos-provider spec's pending Stage-6 step). Additive: existing
Drive/Photos-append users re-consent on next connect. The credential path is UNCHANGED (encrypted
`{refreshToken}`). **This is the one slice that must wait on a fresh ARCC review (§7) AND Angelo's D2 ACK.**

## §6 — Backup / restore / sync (R8)
No new table in v1 (D3 reuses the idempotency index + the photo-ref join). The created expenses + their
`expense_receipts` photo refs are already covered tables with round-trip guards. `validateReferentialIntegrity`
is unchanged. If a future "imported_photos ledger" is ruled in, it is its own additive-migration slice.

## §7 — ARCC governance mapping (a fresh search_arcc is a T0 PRECONDITION before §1/§5 build)
This feature READS the user's photos from Google (a scope expansion) + feeds them to an LLM. The standing
google-photos-provider ARCC note ("query ARCC before the connect/credential path") applies, plus:
1. **SAX-03 — secrets.** The Google refresh token + VLM key reuse the EXISTING encrypted `user_providers`
   seam — no new secret store. (Already audited for storage + vlm + the assistant.)
2. **SAX-06 — PII + third-party scope.** The narrowest possible read scope (`appcreateddata` — only
   VROOM-uploaded items, never the camera roll); each image goes only to the user's own VLM; no VROOM-side
   retention beyond the in-memory draft; a connect-time disclosure of exactly what is read.
3. **The OAuth scope expansion itself** — the explicit ARCC trigger from the google-photos-provider spec.
   The §1 read-capability + §5 scope slices build ONLY after a fresh `search_arcc` on
   "expanding an OAuth read scope to a third party's photo library (app-created data)" is run + recorded.
4. **GenAI untrusted output** — inherited from the VLM feature: the parse is fail-closed + never
   auto-written (R3/R4). No new GenAI surface beyond reusing `extractReceipt` + `parseExtraction`.

## §8 — Risk register
1. **The app-created-only limit misread as "scans my camera roll."** Mitigation: D1 ships it AS the honest
   scoped feature with explicit copy; the spec names the broad-library scope as unavailable, not deferred.
2. **OAuth scope over-reach.** Mitigation: the NARROWEST read scope (`appcreateddata`); ARCC-gated (§7);
   additive re-consent; disclosed at connect.
3. **Double-import.** Mitigation: `clientId = photos:<mediaItemId>` + the shipped `createIdempotent` unique
   index + the "already imported" photo-ref cross-ref (D3/R5). No double expense possible.
4. **Untrusted model output → bad write.** Mitigation: the SHIPPED fail-closed `parseExtraction` + per-draft
   human confirm + the unchanged server-side create validation (R3/R4). Identical to the VLM guarantee.
5. **Cost/abuse (N VLM calls).** Mitigation: the D4 per-run cap + rate limit; cost is on the user's own key.
6. **A Photos baseUrl expiring mid-review.** Mitigation: `getFreshUrl` on render; the import keys off the
   stable mediaItemId, not the ephemeral baseUrl.
7. **Fail-open dishonesty.** Mitigation: a Photos transport failure → 502; a per-item VLM failure → that
   item's empty draft (not a faked parse); never a fabricated import.
