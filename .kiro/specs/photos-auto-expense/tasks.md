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
- [ ] **T0 — Angelo rules D1–D5 + the ARCC precondition** (`requirements.md`). Each fork has a RECOMMENDED
      option; an "ACK" takes it. D1 app-created-only framing (recommend ship it honestly), D2 the OAuth
      read-scope expansion (recommend add `appcreateddata`; **ARCC-gated**), D3 dedup via the idempotency
      index + photo-ref join (recommend; no new table), D4 batch cap (recommend ≤25/run), D5 the per-draft
      checklist confirm UX (recommend). **ARCC PRECONDITION:** before T1/T5 build (the Photos read + the
      scope), run a fresh `search_arcc` on "expanding an OAuth read scope to a third party's photo library"
      + record it in design §7 (the standing google-photos-provider ARCC note). **T2 below is the only
      slice with NO dependency on T0/ARCC** (the stage-endpoint ORCHESTRATION can be built + unit-tested
      against the `PhotosClient` fake before the live scope exists); T1 (the real search) + T5 (the scope)
      wait on the ARCC clearance.

## Phase 1 — the Photos read capability + the stage endpoint
- [ ] **T1 — `searchMediaItems` on the Photos provider (honors D2 + the ARCC precondition).** Add
      `searchMediaItems(pageToken?)` to `PhotosClient` + `GooglePhotosService.listReceiptPhotos(maxItems)`
      (the `mediaItems:search` Library API over app-created data, paginated, bounded by the D4 cap) + a
      `searchMediaItems` capability flag on `GooglePhotosProvider`. GUARD: a zero-network `PhotosClient`
      fake returns scripted media items; the service paginates + stops at the cap. **Build only after the
      ARCC clearance + the D2 scope ACK** (the live call needs the read scope).
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
- [ ] **T3 — `photos-import-api.ts` client (FORK-FREE).** `getReceiptDrafts() → [{ photoId, draft,
      thumbnailUrl }]` over the T2 route; reuses `expenseApi.createExpense` per confirmed draft (with
      `clientId = photos:<mediaItemId>`). GUARD (mocked apiClient — endpoint + the create-per-draft mapping
      incl. the clientId + error propagation).
- [ ] **T4 — The "Import from Photos" review surface (honors D5).** An entry point (settings storage card
      or the expenses header) → the sweep (loading) → a review CHECKLIST (per row: thumbnail + editable
      draft fields + a vehicle picker + a deselect checkbox; already-imported greyed/excluded) → a batch
      "Add N expenses" action firing N idempotent creates. Four-states + the D1 disclosure ("reads only the
      receipts VROOM uploaded to Photos, not your camera roll"). Eyes-on (boot + shot + Read the PNG).
- [ ] **T5 — The OAuth scope expansion (ARCC-GATED, honors D2).** Add
      `photoslibrary.readonly.appcreateddata` to the provider-connect scope list (auth/routes.ts) — the
      google-photos-provider spec's pending Stage-6 step. Additive re-consent; credential path unchanged.
      **Ships ONLY after the §7 ARCC review clears + Angelo's D2 ACK.** (This + T1 are the live-scope-
      dependent slices; T2/T3/T4 build + test against the fake meanwhile.)
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
