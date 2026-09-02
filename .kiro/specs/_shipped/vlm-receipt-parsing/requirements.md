# VLM Receipt Parsing — Requirements

> DRAFT (2026-06-29). **Greenlit-to-spec** (Angelo, decision 23 of the 2026-06-29 batch: "all features
> are open to spec — mark all as greenlit to spec"). BACKLOG BUILD-QUEUE item 5 (TODO #11), the
> highest user-value of the six greenlit features. Design-first per the loop DoD: backend-first
> (schema/config → provider abstraction → route/validation → frontend eyes-on tail), exactly like
> trips / recurring / import / vehicle-sharing.
>
> **Greenlit-to-spec is NOT a blank cheque on the product/UX forks inside.** The SPEC authoring + the
> backend slices that carry no UX fork are pre-authorized. The genuine forks (D1–D5 below) are surfaced
> for an Angelo ruling before the slice that depends on them builds — each has a RECOMMENDED option, so
> the default path can proceed if he ACKs.
>
> **ARCC-grounded (2026-06-29, queried before any security design).** Sending a receipt image to an
> external vision model touches three governance domains — credentials (SAX-03), user-data/PII to a
> third party (SAX-06), and LLM untrusted-input handling (Bedrock guardrails). The findings shape R6/R7
> and §-design directly; see `design.md` §7 for the citation-by-citation mapping.

## Problem
Logging an expense at the pump or after a service is the primary mobile surface (NORTH_STAR), and it is
all manual typing: amount, date, odometer, category, vehicle. The user is holding a paper or emailed
receipt that already contains every one of those fields. "receipt OCR auto-fill" is on the NORTH_STAR
horizon. A vision-capable LLM (VLM) can read the receipt photo and pre-fill the expense form, turning a
30-second typing task into a tap-photo-then-confirm. This is the single largest friction reduction on
the most-used surface.

## What VROOM is (constraints this feature MUST honor)
- **Privacy-first + self-hostable + bring-your-own provider** (NORTH_STAR). The user already brings
  their own storage providers (Drive/Sheets/Photos/S3). A VLM is the same model: the user brings their
  OWN provider + OWN API key (or a self-hosted local model). VROOM never ships a shared/hosted key and
  never sends a user's receipt to a VROOM-operated endpoint.
- **Data safety is sacred; correctness for everyone** (NORTH_STAR #1/#2). A parsed value is a SUGGESTION,
  never a silent write. The model's output is untrusted and must be human-confirmed before it becomes a
  real cost record — a wrong amount auto-inserted is a silent data-integrity failure.

## Scope (v1)
**In:**
- A new provider **domain `vlm`** in the existing `user_providers` system: the user adds a VLM provider
  (provider type + API key + model name + optional base URL for self-hosted/compatible endpoints). The
  API key is stored ENCRYPTED at rest via the existing `utils/encryption.ts` seam, identical to how
  storage-provider credentials are handled today; it is NEVER returned to the frontend.
- A backend **parse endpoint** that takes a receipt image, calls the user's enabled VLM provider with a
  strict structured-extraction prompt, validates the model's JSON response against a tight schema, and
  returns a **DRAFT** (suggested expense fields) — it does NOT persist anything.
- A frontend **"Scan receipt"** affordance on the expense form: pick/take a photo → call parse → the
  returned draft PRE-FILLS the form fields → the user reviews/edits and submits through the EXISTING
  expense-create path. The image attaches via the EXISTING `photos(entityType='expense')` receipt
  mechanism (no new storage path).
- A one-time **privacy disclosure**: scanning sends the receipt image to the user's chosen provider;
  surface which provider, and the self-hosted option for the privacy-maximal user.

**Out (deferred — name them so scope is honest):**
- A VROOM-hosted/shared VLM key or any VROOM-operated inference endpoint (violates bring-your-own).
- Auto-insert / batch-import of receipts without per-receipt human confirmation (data-safety: every
  draft is confirmed).
- A persisted `sourceType:'receipt'` provenance link on the created expense (v1 keeps it a plain manual
  expense + the existing photo attach — see D4; avoids touching the `expenses` source-link schema and
  the #62/#145 forge class).
- The general LLM "assistant" feature (TODO #12, BACKLOG item 6 — a SEPARATE greenlit spec).
- Parsing non-receipt documents (insurance declarations, registration) — receipt → expense only in v1.
- Multi-receipt / PDF-with-many-pages batch; line-item itemization (one receipt → one expense draft).

## Decisions to surface (the genuine product/UX forks — each greenlit-to-spec but ruled before its slice)
- **D1 — Which VLM providers in v1?** RECOMMEND: an **OpenAI-compatible** type (one adapter covers
  OpenAI + the many OpenAI-API-compatible gateways), **Anthropic** (Claude vision), **Google Gemini**,
  and **Ollama / OpenAI-compatible-self-hosted** (the privacy-maximal local option, no data leaves the
  host). Rationale: one OpenAI-compatible adapter + two first-party adapters + a self-hosted path cover
  the spectrum with ~3 adapters. (Alternative: ship ONLY an OpenAI-compatible adapter in v1 and add the
  rest later — smaller, but no first-class Anthropic/Gemini.)
- **D2 — Self-hosted (Ollama) in v1 or deferred?** RECOMMEND: **in v1**, because it is the only path that
  sends NO receipt data off the user's host, which is the cleanest answer to the SAX-06 PII concern and
  the truest to "privacy-first, self-hostable." It is also low-cost (the OpenAI-compatible adapter +
  a configurable base URL covers Ollama's `/v1/chat/completions`).
- **D3 — Low-confidence handling.** RECOMMEND v1 keeps it SIMPLE: pre-fill every field the model
  returned, highlight NONE specially, and require the user to review the whole form before submit
  (the existing validation gates bad values). The model returns a per-field presence (a field it could
  not read is omitted → left blank for the user). (Alternative: a per-field confidence score + visual
  flagging — more UX surface; defer unless Angelo wants it now.)
- **D4 — Provenance tag on the confirmed expense.** RECOMMEND **defer**: v1 produces a plain manual
  expense (no `sourceType` link) + the receipt image attached via the existing photo mechanism. Tagging
  receipt-sourced expenses (`sourceType:'receipt'`) would touch the `expenses` source-link enum + the
  both-or-neither refine + the cascade hooks (#62/#109/#145 within-tenant integrity class) for marginal
  v1 value. (Alternative: add the tag now for future "show all receipt-scanned expenses" — a schema
  change; recommend a later spec if wanted.)
- **D5 — Cost/abuse guardrail.** RECOMMEND: reuse the existing rate-limit + body-size middleware on the
  parse route (a VLM call costs the USER money on their own key, so the guardrail is about runaway loops
  + oversized uploads, not multi-tenant fairness). Cap image size (e.g. ≤8 MB) + downscale server-side
  before send (data-minimization + cost). Confirm the cap.

## Functional requirements
- **R1 — Add a VLM provider.** The user creates a `domain:'vlm'` provider with a `providerType`
  (D1 set), an API key (→ encrypted credential), a model name, and an optional base URL (self-hosted /
  compatible). Reuses the existing `POST /api/v1/providers` generic CRUD + the per-type validation
  registry. The key is stripped from every response (the existing `formatProviderResponse` discipline).
- **R2 — Parse a receipt → draft.** `POST` an image → the backend resolves the user's enabled `vlm`
  provider, downscales the image, calls the provider with a strict structured-extraction prompt, and
  returns a DRAFT `{ amount?, date?, odometer?, category?, vehicleHint?, vendor?, rawText? }`. It
  PERSISTS NOTHING. If no `vlm` provider is configured → a clear actionable error (link to add one).
- **R3 — Untrusted-output discipline (the load-bearing safety rule).** The model response is parsed
  against a STRICT Zod schema and every field is bounded BEFORE it reaches the draft: amount must be a
  positive number, date must parse to a real date, category must be one of the 6 `EXPENSE_CATEGORIES`
  (else dropped/omitted, not guessed), odometer a non-negative int. Anything failing validation is
  DROPPED from the draft (fail-closed), never coerced. The receipt image content is treated as a
  prompt-injection vector — the parse never executes instructions found in the image; it only extracts
  to the fixed schema (design §7.3).
- **R4 — Human confirmation before any write (NORTH_STAR #1).** The draft NEVER auto-creates an expense.
  The frontend pre-fills the existing `ExpenseForm` with the draft; the user reviews/edits and submits
  through the UNCHANGED `POST /expenses` create path (which re-validates everything server-side). A
  parse failure or a partial draft still lets the user fill the rest by hand — the form is never blocked.
- **R5 — Receipt image storage reuses the existing path.** The scanned image attaches to the created
  expense via the EXISTING `photos(entityType='expense')` + storage-provider receipt mechanism
  (`expense_receipts` category). No new storage seam, no new upload route.
- **R6 — Credentials at rest (SAX-03).** The VLM API key is encrypted at rest (AES-256-GCM via
  `utils/encryption.ts`, the existing `PROVIDER_ENCRYPTION_KEY` seam), stored separate from code, never
  logged, never returned to the client. Fail-closed: a missing/invalid encryption key fails the
  operation (it already does for storage providers).
- **R7 — PII to a third party (SAX-06).** The receipt image (which may contain a card's last-4, a name,
  an address) is sent ONLY to the user's OWN chosen provider with their OWN key, over TLS, data-minimized
  (only the image + the extraction prompt — no other VROOM user data), with NO VROOM-side retention of
  the raw model response beyond the in-memory draft. The user is shown a clear one-time disclosure of
  what scanning sends and to whom, plus the self-hosted (no-data-leaves-host) option. Self-hosting is the
  recommended path for the privacy-maximal user.
- **R8 — Data safety / backup.** A `vlm` provider row round-trips through backup/restore like every other
  `user_providers` row (it already is a covered table). No new table in v1 (D4 defers the provenance
  column), so `validateReferentialIntegrity` is unchanged. If D4 is later ruled "tag now," that becomes
  its own additive-migration slice with a round-trip guard.
- **R9 — UI (eyes-on tail, NORTH_STAR #3).** A VLM-provider add/edit surface in settings (api key + model
  + base URL; key write-only). A "Scan receipt" button on the expense form (mobile-first: camera capture)
  with loading / error / empty / data four-states; a privacy disclosure on first use. Then the
  FE→BE→provider→draft→form→create e2e (or "code-complete, eyes-on pending" if the live VLM call is
  harness-blocked — a mocked-provider e2e still exercises the FE→BE→draft→form→create seam).

## Non-goals / guardrails
- VROOM NEVER operates inference or holds a shared key — bring-your-own only (NORTH_STAR privacy-first).
- The model's output is NEVER trusted as a write — it is always a human-confirmed draft (R3/R4).
- The parse route NEVER persists the image or the raw response server-side beyond the request; the image
  is persisted ONLY when the user confirms the expense (via the existing photo path, R5).
- No telemetry of receipt contents; no logging of the API key or the model response body.
