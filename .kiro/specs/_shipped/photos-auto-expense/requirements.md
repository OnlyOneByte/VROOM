# Photos → Auto-Add Expenses — Requirements

> DRAFT (2026-06-30). **Greenlit-to-spec** (Angelo, decision 23 of the 2026-06-29 batch: "all features
> are open to spec"). BACKLOG BUILD-QUEUE item 10 (TODO #16). Authored while the LLM-assistant FE tail
> is blocked on its T0 ruling (the loop pivoted here per the gated-loop protocol). This feature is the
> natural CONVERGENCE of two shipped systems: the **VLM receipt-parsing** (image → fail-closed draft) and
> the **Google Photos storage provider** (the bring-your-own Photos integration). It turns "scan one
> receipt" into "sweep the receipts already in your VROOM Photos album into draft expenses."
>
> **Greenlit-to-spec is NOT a blank cheque on the forks inside.** SPEC authoring + the fork-free backend
> slices are pre-authorized. The genuine forks (D1–D5 below) — and especially the OAuth-scope expansion,
> which is independently ARCC-gated — are surfaced for an Angelo ruling before the slice that depends on
> them builds.
>
> **ARCC-grounded (the VLM + LLM precedent + the google-photos-provider spec's standing ARCC note).**
> Reading the user's photos from a third party touches credentials (SAX-03), PII egress + third-party
> data handling (SAX-06), and — critically — an OAuth SCOPE EXPANSION (the Photos read scope), which the
> google-photos-provider spec already flags as "query ARCC before implementing the connect/credential
> path." A fresh `search_arcc` on the read-scope + the auto-write-from-untrusted-source surface is a T0
> precondition (recorded in design §7).

## Problem
A user who photographs fuel + service receipts accumulates them in Google Photos. VROOM already lets them
scan ONE receipt at a time (the VLM "Scan receipt" button). But the bulk case — "I have a dozen receipts
from this month's road trip sitting in my photos" — is still one-at-a-time manual work. If VROOM could
pull those receipt images and pre-stage a draft expense per photo (parsed by the user's own VLM, confirmed
by the user before anything is written), the highest-friction bulk-entry path collapses to a review-and-tap.

## What VROOM is (constraints this feature MUST honor)
- **Privacy-first + bring-your-own provider** (NORTH_STAR). The photos come from the user's OWN Google
  Photos via their OWN connected provider; the parse uses their OWN VLM key. VROOM never holds a shared
  key and never reads photos the user has not granted.
- **Google Photos read is APP-CREATED-ONLY (the load-bearing platform constraint).** Google deprecated
  broad library-read; the only readable scope for a third-party app is
  `photoslibrary.readonly.appcreateddata` — VROOM can enumerate ONLY the media items IT uploaded (i.e.
  the receipts already in VROOM's own Photos album via the existing `expense_receipts` upload path). It
  CANNOT scan the user's whole camera roll. **This reframes the feature honestly:** it is "auto-draft the
  receipts VROOM already stored in Photos that are not yet linked to an expense," NOT "find receipts in
  your camera roll." (A camera-roll sweep would need a broad-library scope Google will not grant a
  non-Workspace app — out of scope, named in §Out.)
- **Data safety is sacred** (NORTH_STAR #1). The model output is UNTRUSTED. A pulled+parsed receipt is a
  DRAFT the user confirms — NEVER an auto-written expense. Idempotency keys on the photo id prevent the
  same photo from ever creating two expenses.

## Scope (v1)
**In:**
- Extend the Google Photos provider with a **`searchMediaItems`** capability (the app-created-data read)
  so VROOM can enumerate the receipt photos in its own album. Gated behind the new Photos read scope.
- A backend **batch-stage endpoint**: enumerate the user's app-created Photos media items not yet linked
  to an expense, download each (the existing `GooglePhotosService.download`), parse it through the user's
  VLM (`getVlmProvider().extractReceipt` → `parseExtraction`), and return a LIST of `{ photoId, draft }`
  — PERSISTING NOTHING. Bounded (a page cap + a per-run item cap).
- A frontend **"Import from Photos" review surface**: the staged drafts render as a checklist; the user
  reviews/edits each, deselects any, and confirms — each confirmed draft goes through the UNCHANGED
  `POST /expenses` create path with a `clientId` derived from the photo id (idempotent: re-import is a
  no-op). The photo is linked to the created expense via the existing `expense_receipts` photo mechanism.
- The OAuth-scope expansion (`photoslibrary.readonly.appcreateddata`) added to the provider-connect flow
  (the google-photos-provider spec's remaining Stage-6 work) — ARCC-gated.

**Out (deferred — name them so scope is honest):**
- **Reading the user's whole camera roll / any non-app-created photo** — Google will not grant the scope
  to a non-Workspace app; VROOM only reads what it uploaded. (The honest platform limit, not a v1 cut.)
- Auto-WRITING an expense without per-draft human confirmation (data-safety — every draft is confirmed).
- A background/scheduled auto-import (a cron that drafts new photos nightly) — v1 is user-initiated only;
  a scheduled sweep is a later spec (it compounds the cost + the untrusted-write surface).
- Pulling from non-Google photo sources (iCloud, S3-as-photos) — Google Photos only in v1.
- Re-parsing / OCR of non-receipt photos — the album is receipt-scoped by construction (only
  `expense_receipts`-category uploads), so no classifier is needed in v1.

## Decisions to surface (the genuine product/UX + architecture forks — ruled before the dependent slice)
- **D1 — The app-created-only framing (the headline product call).** RECOMMEND ship it AS the honest
  feature: "draft the receipts in your VROOM Photos album that are not yet logged." The settings/UI copy
  states plainly that it reads only VROOM-uploaded photos, not the camera roll. (Alternative: defer the
  whole feature until/unless a broad-library scope is viable — but that scope is not available to a
  non-Workspace app, so deferring = never. RECOMMEND ship the honest scoped version.)
- **D2 — The OAuth read-scope expansion.** RECOMMEND add `photoslibrary.readonly.appcreateddata` to the
  google-photos provider-connect flow (the spec's pending Stage-6 step). This is ADDITIVE (existing Drive
  + Photos-append users re-consent on next connect). **ARCC-gated:** a fresh `search_arcc` on the
  read-scope + token handling is a precondition (design §7). (Alternative: a separate read-only Photos
  provider type — more surface; RECOMMEND extend the existing one.)
- **D3 — Dedup / "already imported" tracking.** RECOMMEND key the create `clientId` off the photo's
  Google media-item id (`photos:<mediaItemId>`), so the existing `createIdempotent` (userId, clientId)
  unique index makes a re-import a perfect no-op — NO new table. To SHOW "already imported" in the review
  list, cross-reference the existing `expense_receipts` photo refs (the photo already linked to an
  expense) — also no new table. (Alternative: a new `imported_photos` ledger — more schema; RECOMMEND
  reuse the idempotency index + the photo-ref join.)
- **D4 — Batch caps + cost.** RECOMMEND a hard per-run cap (e.g. ≤25 photos/run) + the existing rate
  limit; each photo is one VLM call on the user's own key (cost is the user's), so the cap bounds a
  runaway sweep + the review-list size. Confirm the cap.
- **D5 — Confirm UX granularity.** RECOMMEND a per-draft checklist: each staged draft is editable + has a
  vehicle picker (the parse cannot know which vehicle), deselectable, and confirmed in one batch action
  that creates N expenses via N idempotent POSTs. (Alternative: one-at-a-time wizard — more taps;
  RECOMMEND the checklist.)

## Functional requirements
- **R1 — Enumerate app-created receipt photos.** Extend the Photos provider/service with
  `searchMediaItems` (the `mediaItems:search` Library API over app-created data, paginated, bounded).
  Returns the media items in VROOM's receipt album. Reuses the existing `PhotosClient` injectable seam
  (a zero-network fake for tests).
- **R2 — Stage drafts (PERSISTS NOTHING).** A `POST`/`GET` batch endpoint: list app-created media items
  NOT already linked to an expense (D3 cross-ref), download each (existing `download`), parse via the
  user's enabled `vlm` provider (`extractReceipt` → `parseExtraction`, the shipped fail-closed seam),
  and return `[{ photoId, draft, thumbnailUrl }]`. No VLM provider → the actionable 400 the parse route
  already returns. No Photos provider / scope → a clear actionable error.
- **R3 — Untrusted-output discipline (inherited).** Each draft is the SAME fail-closed `ReceiptDraft`
  the VLM route produces (bounded amount/date/odometer/category/vendor; bad fields dropped). The model
  output is never auto-written (R4).
- **R4 — Human confirmation before any write (NORTH_STAR #1).** The staged drafts pre-fill a review list;
  the user reviews/edits/deselects and confirms; each confirmed draft creates an expense through the
  UNCHANGED `POST /expenses` path (server-side re-validation) with `clientId = photos:<mediaItemId>`
  (idempotent). The photo links to the new expense via the existing `expense_receipts` mechanism.
- **R5 — Idempotency / no double-import (D3).** A re-import of the same photo is a no-op via the
  `(userId, clientId)` unique index (the shipped `createIdempotent`). The review list marks photos
  already linked to an expense as "imported" (the photo-ref cross-ref) and excludes/greys them.
- **R6 — Credentials at rest (SAX-03).** The Google refresh token + the VLM api key reuse the existing
  encrypted `user_providers` seam — no new secret storage. The Photos read happens with the user's own
  token; the VLM parse with the user's own key.
- **R7 — PII to a third party + scope (SAX-06 + the OAuth expansion).** The only photos read are
  VROOM-app-created (the narrowest scope); each is sent ONLY to the user's own VLM with their own key;
  no VROOM-side retention beyond the in-memory draft (the image already lives in the user's Photos +,
  on confirm, the existing receipt-photo path). The scope expansion is disclosed at connect + ARCC-
  reviewed (design §7).
- **R8 — Data safety / backup.** No new table in v1 (D3 reuses the idempotency index + the photo-ref
  join), so `validateReferentialIntegrity` + the backup round-trip are unchanged. The created expenses
  + their photo refs are already covered tables.
- **R9 — UI (eyes-on tail, NORTH_STAR #3).** An "Import from Photos" entry (settings or the expenses
  page) → the staged-draft review checklist (each editable, vehicle-pick, deselect) → batch confirm →
  the expenses appear. Four-states (loading the sweep / error / empty "no new receipts" / data). Then
  the FE→BE→stage→review→create e2e with a MOCKED Photos + VLM provider; the live legs stay eyes-on-pending.

## Non-goals / guardrails
- VROOM reads ONLY app-created photos (the narrowest Google scope) — never the camera roll (R7/D1).
- The model output is NEVER auto-written — every draft is human-confirmed (R3/R4).
- No new persistence in v1 — dedup rides the existing idempotency index + photo-ref join (D3/R8).
- The OAuth-scope expansion is ARCC-gated + disclosed; it does not ship until that review clears (D2/§7).
- No background/scheduled sweep in v1 — user-initiated only.
