# Photos → Auto-Add Expenses — Tasks

> Backend-first per CLAUDE.md (Photos read-capability → stage endpoint → frontend review tail). **The
> SPEC is greenlit-to-spec (Angelo decision 23).** This feature CONVERGES two shipped systems — the VLM
> receipt-parsing (image → fail-closed draft) and the Google Photos storage provider — so most slices
> REUSE existing seams (`extractReceipt`/`parseExtraction`, `createIdempotent`, `expense_receipts`). One
> task per `feature` cycle, each independently verified via `bun run validate:local`.
>
> KEY GROUNDING (do not re-derive): the Google Photos read is APP-CREATED-ONLY
> (`photoslibrary.readonly.appcreateddata`) — VROOM enumerates ONLY the receipts it uploaded to its own
> album, NOT the camera roll (the platform limit, design §0/§1). Dedup rides the SHIPPED
> `createIdempotent` (userId, clientId) index with `clientId = photos:<mediaItemId>` — NO new table.
> The model output is UNTRUSTED → the SHIPPED fail-closed `parseExtraction`, never auto-written.

## Phase 0 — sign-off (gates the dependent slices)
- [x] **T0 — Angelo ACK all recommended (2026-06-30).** D1 = ship the app-created-only framing honestly
      (draft the receipts in VROOM's own Photos album, not the camera roll); D2 = add the
      `photoslibrary.readonly.appcreateddata` OAuth read-scope to the provider-connect flow; D3 = dedup via the
      `createIdempotent` (userId, clientId=photos:mediaId) index + the photo-ref join (no new table); D4 = ≤25
      photos/run cap; D5 = the per-draft review checklist. Do NOT re-escalate (settled). **ARCC PRECONDITION
      STILL STANDS (separate from D2):** the OAuth read-scope expansion (the T1-live search + T5 scope) requires
      a fresh `search_arcc` on "expanding an OAuth read scope to a third party's photo library (app-created
      data)" + recording it in design §7 BEFORE those slices build — Angelo's product ACK does not substitute for
      the governance check (the standing google-photos-provider rule). **T2 (the stage-endpoint ORCHESTRATION) is
      fork-free + buildable now against the `PhotosClient` fake**; T1-live + T5 build after the ARCC check.
      **✅ ARCC CHECK RAN + CLEARED (2026-06-30, design §7).** search_arcc on the OAuth read-scope expansion
      returned the OAuth-least-privilege + Auth-Code-grant + SAX-03 token-encryption controls; the design
      satisfies each (narrowest `appcreateddata` read-only scope, additive to the unchanged Auth-Code flow,
      encrypted `user_providers` token seam, no new GenAI surface). No blocking finding → **T1-live + T5 are
      now UNBLOCKED on the ARCC axis.** **T2 SHIPPED (commit 3f162df, on the re-cut branch — pending the push).**

## Phase 1 — the Photos read capability + the stage endpoint
- [x] **T1 — `searchMediaItems` on the Photos provider (C544, live read; ARCC-cleared C543/§7).** The
      `PhotosClient` interface gained the OPTIONAL `searchMediaItems(albumId, pageToken?)` (added T2/C543);
      this slice implements it on the REAL `createRealPhotosClient` (POST `/v1/mediaItems:search` via the
      existing `authedFetch`, pageSize 100, maps `{mediaItems, nextPageToken}` → `{items, nextPageToken}`).
      `GooglePhotosService.listReceiptPhotos(maxItems)` (added C543) paginates it bounded by the D4 cap.
      The real read needs a Google token the in-process suite cannot mint, so the route HTTP guard injects a
      fake-PhotosClient-backed service (`setPhotosServiceBuilderForTest`) + the fake's `searchMediaItems`
      (scripted seeded photos + pagination) to exercise the live-read PATH zero-network — incl. a clean
      multi-photo sweep, the already-imported filter, and a transport-failure 502 via fault injection. The
      real transport method is itself uncovered by convention (the sibling real client methods are too).
      Backend validate:local GREEN (2295 pass).
- [ ] **T2 — The stage endpoint (FORK-FREE orchestration, buildable now against the fake).**
      `GET /api/v1/photos/receipt-drafts`: resolve the enabled google-photos + vlm providers (none →
      actionable 400); `listReceiptPhotos` → filter out media items already linked to an expense (the
      photo-ref cross-ref, D3) → per item: download → `getVlmProvider().extractReceipt` → `parseExtraction`
      → return `[{ photoId, draft, thumbnailUrl }]`; PERSIST NOTHING. A Photos transport failure → 502; a
      per-item VLM failure → that item's empty draft (not a batch fail). GUARD `receipt-drafts-route.test.ts`
      (HTTP harness, the `PhotosClient` fake + the adapter fetch stubbed): a clean multi-photo stage; the
      already-imported filter; no-provider 400; Photos 502; per-item VLM-failure → empty draft; PERSISTS
      NOTHING; unauth 401. The orchestration + its guard are fork-free (the fake stands in for the live read).

## Phase 2 — frontend (eyes-on tail, R9)
- [x] **T3 — `photos-import-api.ts` client (C545, FORK-FREE).** `photosImportApi.getReceiptDrafts() →
      ReceiptDraftItem[]` over the T2 GET route + `confirmDraft(photoId, input)` which maps the reviewed
      draft via `toBackendExpense` then POSTs /expenses with `clientId = photos:<photoId>` spread on (the
      offline-sync precedent — `toBackendExpense` does not carry the key; mirrors sync-manager.ts:240). Money
      stays dollars (cents convert at the route boundary). GUARD `photos-import-api.test.ts` (5 cases, mocked
      apiClient): the GET endpoint + drafts passthrough; the confirm POST endpoint + the draft→body mapping +
      the crux `clientId=photos:<id>` idempotency key; a different photo → a different clientId (no dedup
      collision); error propagation on both. FE validate:local GREEN (1433 vitest, +5).
- [ ] **T4 — The "Import from Photos" review surface (honors D5).** An entry point (settings storage card
      or the expenses header) → the sweep (loading) → a review CHECKLIST (per row: thumbnail + editable
      draft fields + a vehicle picker + a deselect checkbox; already-imported greyed/excluded) → a batch
      "Add N expenses" action firing N idempotent creates. Four-states + the D1 disclosure ("reads only the
      receipts VROOM uploaded to Photos, not your camera roll"). Eyes-on (boot + shot + Read the PNG).
- [x] **T5 — The OAuth scope expansion (C544, ARCC-cleared C543/§7 + Angelo D2 ACK).** Added
      `https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata` to the provider-connect scope
      list (`auth/routes.ts` `/providers/connect/google`, alongside `drive.file`). The NARROWEST Photos read
      scope (read-only + app-created-data only). Additive re-consent: the flow already sets `prompt=consent`
      + `access_type=offline`, so existing Drive/Photos users re-grant on next connect; the credential path
      (encrypted `{refreshToken}`) is UNCHANGED. Paired with T1 as the live-read enablement.
- [ ] **T6 — Round-trip e2e + DoD.** With a MOCKED Photos (`PhotosClient` fake) + a MOCKED VLM: sweep →
      review → confirm → assert N expenses + their photo links + that a re-run is a no-op (idempotency).
      The live Photos + VLM legs stay eyes-on-pending. Feature-DoD: both sides validate:local green, the
      e2e green, eyes-on the review surface, the disclosure present. Tick the feature done.

## Notes
- **NO schema migration in v1** — dedup reuses the `createIdempotent` (userId, clientId) index; the
  "already imported" mark reuses the `expense_receipts` photo-ref join. No new table.
- **App-created-only is the honest platform limit** (D1) — not a v1 cut. The copy says so plainly.
- **The OAuth scope (T1 live + T5) is ARCC-gated** — those slices wait on the §7 review + D2; T2/T3/T4
  (the orchestration + FE against the fake) are the fork-free work that proceeds first.
- WIP=1: this feature shares the queue with the LLM-assistant (whose FE tail is blocked on its own T0).
  Finish one before starting a third; if BOTH are gated, do the infra cadence or flag Angelo.
